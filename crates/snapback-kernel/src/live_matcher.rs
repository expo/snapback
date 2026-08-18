use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::manifest::{
    FilterExpr, FilterOp, FunctionDefinition, FunctionRuntime, HandlerInput, HandlerPlan,
    OrderDirection, QueryOutput, QueryPlan, ValueExpr, effective_query_limit,
};
use crate::storage::{CapturedReadDependency, CapturedReadKind, ChangeOp, ChangedRow, DbRead};
use serde_json::{Value, json};
use std::cmp::Ordering;

pub type QueryDependencyMetadata =
    (Option<Value>, Option<usize>, Option<usize>, Option<Value>);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LiveMatchOutcome {
    Skip,
    Match,
    ConservativeFallback,
}

impl LiveMatchOutcome {
    #[allow(dead_code)]
    pub fn may_be_affected(self) -> bool {
        self != Self::Skip
    }
}

pub fn query_dependencies_from_plan(
    plan: &QueryPlan,
    input: &HandlerInput,
    output: &QueryOutput,
    db: &DbRead<'_>,
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
        // Pair the dependency with the exact row snapshot. A later table
        // cursor could include a concurrent authorization/data change that the
        // returned rows did not observe and make validation miss that change.
        version: Some(output.version),
        predicate: Some(predicate),
        rows,
        field: None,
        value: None,
        order,
        limit,
        result_count,
        boundary,
    });

    // LLP 0056 M3: a declaration-bound membership semi-join contributes an
    // ORDINARY snapshot-bound dependency over the membership table (never the
    // dead `Permission` kind), so the matcher wakes on membership writes —
    // including the empty-to-visible direction.
    for predicate in &plan.membership_filters {
        dependencies.extend(crate::membership_rules::query_membership_dependencies(
            db.schema(),
            input,
            predicate,
            db,
            output.version,
        )?);
    }
    if let Some(visibility) = &plan.table_visibility {
        for predicate in visibility.membership_predicates() {
            dependencies.extend(crate::membership_rules::query_membership_dependencies(
                db.schema(),
                input,
                &predicate,
                db,
                output.version,
            )?);
        }
    }

    Ok(dependencies)
}

pub fn query_dependency_metadata(
    plan: &QueryPlan,
    rows: &[Value],
) -> SnapbackResult<QueryDependencyMetadata> {
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
        Some(effective_query_limit(plan)),
        Some(rows.len()),
        query_boundary(plan, rows),
    ))
}

/// @ref LLP 0020#phase-4-upgrade-realtime-from-v0-outbox-to-app-grade-live-delivery — the realtime matcher reuses captured query dependencies and keeps a conservative replace fallback.
#[allow(dead_code)]
pub fn live_subscription_may_be_affected(
    definition: &FunctionDefinition,
    input: &HandlerInput,
    read_dependencies: &[CapturedReadDependency],
    changes: &[ChangedRow],
) -> bool {
    live_subscription_match_outcome(definition, input, read_dependencies, changes).may_be_affected()
}

pub fn live_subscription_match_outcome(
    definition: &FunctionDefinition,
    input: &HandlerInput,
    read_dependencies: &[CapturedReadDependency],
    changes: &[ChangedRow],
) -> LiveMatchOutcome {
    if changes.is_empty() {
        return LiveMatchOutcome::ConservativeFallback;
    }
    // @ref LLP 0240#d4-custom-function-mediated-authority-has-an-honest-declaration
    // — an opaque custom evaluator has no enforceable complete input set.
    // Every application-row change therefore wakes and reauthorizes; auth
    // context and generation activation travel their existing invalidation
    // lanes. Never consult the declared inputs as a precision claim.
    if definition.custom_authorization.is_some() {
        return LiveMatchOutcome::ConservativeFallback;
    }
    // @ref LLP 0231#d3--composed-into-the-plan-sized-by-a-plan-class-model
    // — policy dependencies are broader than the row dependencies these
    // carriers currently capture. Put the conservative posture ahead of the
    // generic dependency disjointness gate so a future captured Query cannot
    // accidentally suppress an authorization-driven replacement.
    let composed_multi_table_visibility = match &definition.runtime {
        FunctionRuntime::HostPlan(HandlerPlan::RelationalQuery(plan)) => {
            plan.root_table_visibility.is_some() || plan.joined_table_visibility.is_some()
        }
        FunctionRuntime::HostPlan(HandlerPlan::BoundedChildrenQuery(plan)) => {
            plan.parent_table_visibility.is_some() || plan.child_table_visibility.is_some()
        }
        FunctionRuntime::HostPlan(HandlerPlan::SnapshotBatch(plan)) => {
            plan.nodes.iter().any(|node| {
                node.parent_table_visibility.is_some() || node.child_table_visibility.is_some()
            })
        }
        FunctionRuntime::HostPlan(HandlerPlan::SnapshotBatchV2(plan)) => {
            plan.nodes.iter().any(|node| match node {
                crate::manifest::SnapshotBatchNodeV2::BoundedChildren(node) => {
                    node.parent_table_visibility.is_some() || node.child_table_visibility.is_some()
                }
                crate::manifest::SnapshotBatchNodeV2::RelationalQuery(node) => {
                    node.root_table_visibility.is_some() || node.joined_table_visibility.is_some()
                }
            })
        }
        _ => false,
    };
    if composed_multi_table_visibility {
        return LiveMatchOutcome::ConservativeFallback;
    }
    if let Some(matched) =
        live_subscription_may_be_affected_by_dependencies(input, read_dependencies, changes)
    {
        return matched;
    }
    match &definition.runtime {
        FunctionRuntime::HostPlan(HandlerPlan::Query(plan)) => changes
            .iter()
            .map(|change| query_plan_change_outcome(plan, input, change, None))
            .max_by_key(|outcome| match outcome {
                LiveMatchOutcome::Skip => 0,
                LiveMatchOutcome::Match => 1,
                LiveMatchOutcome::ConservativeFallback => 2,
            })
            .unwrap_or(LiveMatchOutcome::Skip),
        FunctionRuntime::IbexModule(_) => {
            let tables = &definition.read_set_summary.tables;
            let relevant = changes
                .iter()
                .filter(|change| tables.is_empty() || tables.contains(&change.table))
                .collect::<Vec<_>>();
            if relevant.is_empty() {
                return LiveMatchOutcome::Skip;
            }
            if definition.read_set_summary.auth_scope_field.as_deref() == Some("userId")
                && let Some(user_id) = input.auth.user_id.as_deref()
                && relevant.iter().all(|change| {
                    field_scope_change_is_disjoint(
                        change,
                        "userId",
                        &Value::String(user_id.to_owned()),
                    )
                })
            {
                return LiveMatchOutcome::Skip;
            }
            LiveMatchOutcome::ConservativeFallback
        }
        // @ref LLP 0080#4-live-and-retained-capability — v1 invalidation is
        //   deliberately table-granular: a commit touching either declared
        //   source causes an authoritative resnapshot; no proved-disjoint
        //   skip path is claimed for relational plans.
        FunctionRuntime::HostPlan(HandlerPlan::RelationalQuery(plan)) => {
            // @ref LLP 0231#d3--composed-into-the-plan-sized-by-a-plan-class-model
            // — policy-backed membership and ownership inputs can change a
            // relational result without a row change on either data table.
            // Until every policy dependency has a precise captured matcher,
            // replace conservatively on every commit.
            if plan.root_table_visibility.is_some() || plan.joined_table_visibility.is_some() {
                LiveMatchOutcome::ConservativeFallback
            } else {
                bool_outcome(
                    changes
                        .iter()
                        .any(|change| change.table == plan.root || change.table == plan.joined),
                )
            }
        }
        FunctionRuntime::HostPlan(HandlerPlan::BoundedChildrenQuery(plan)) => {
            if plan.parent_table_visibility.is_some() || plan.child_table_visibility.is_some() {
                LiveMatchOutcome::ConservativeFallback
            } else {
                bool_outcome(changes.iter().any(|change| {
                    change.table == plan.parent_table || change.table == plan.child_table
                }))
            }
        }
        // Unreachable while the static snapshot-batch carrier remains
        // support-false and whole-manifest admission refuses. Keep the
        // matcher conservative rather than accidentally claiming §2.5's
        // future live dependency implementation in this checkpoint.
        FunctionRuntime::HostPlan(HandlerPlan::SnapshotBatch(_)) => {
            LiveMatchOutcome::ConservativeFallback
        }
        // V2 keeps fixed table-granular whole-batch replacement over the
        // union of both owner dependency sets. A relevant change resnapshots
        // the complete tuple; an unrelated table does not wake it.
        FunctionRuntime::HostPlan(HandlerPlan::SnapshotBatchV2(plan)) => {
            let has_composed_visibility = plan.nodes.iter().any(|node| match node {
                crate::manifest::SnapshotBatchNodeV2::BoundedChildren(node) => {
                    node.parent_table_visibility.is_some() || node.child_table_visibility.is_some()
                }
                crate::manifest::SnapshotBatchNodeV2::RelationalQuery(node) => {
                    node.root_table_visibility.is_some() || node.joined_table_visibility.is_some()
                }
            });
            if has_composed_visibility {
                LiveMatchOutcome::ConservativeFallback
            } else {
                bool_outcome(changes.iter().any(|change| {
                    plan.nodes.iter().any(|node| match node {
                        crate::manifest::SnapshotBatchNodeV2::BoundedChildren(node) => {
                            change.table == node.parent_table || change.table == node.child_table
                        }
                        crate::manifest::SnapshotBatchNodeV2::RelationalQuery(node) => {
                            change.table == node.root || change.table == node.joined
                        }
                    })
                }))
            }
        }
        FunctionRuntime::HostPlan(HandlerPlan::SearchQuery(plan)) => {
            bool_outcome(changes.iter().any(|change| change.table == plan.table))
        }
        // VectorQuery cannot be declared live in v1. Keep a conservative
        // fallback for forged/in-memory values without claiming a matcher.
        FunctionRuntime::HostPlan(HandlerPlan::VectorQuery(_)) => {
            LiveMatchOutcome::ConservativeFallback
        }
        // Table-granular fallback for the declared job-status query: any job
        // lifecycle transition resnapshots it. The captured Row/MissingRow
        // dependency above already gives the per-job precise wake/skip.
        FunctionRuntime::HostPlan(HandlerPlan::JobStatusQuery(_)) => bool_outcome(
            changes
                .iter()
                .any(|change| change.table == crate::jobs::JOBS_STATUS_TABLE),
        ),
        // Push-ledger reads are query-only in v1, so this arm is exhaustive
        // defense rather than a live-subscription claim.
        FunctionRuntime::HostPlan(HandlerPlan::PushLedgerQuery(_)) => LiveMatchOutcome::Skip,
        FunctionRuntime::HostPlan(HandlerPlan::Mutation(_))
        | FunctionRuntime::HostPlan(HandlerPlan::WriteWithActivity(_))
        | FunctionRuntime::HostPlan(HandlerPlan::Action(_)) => {
            LiveMatchOutcome::ConservativeFallback
        }
    }
}

fn bool_outcome(value: bool) -> LiveMatchOutcome {
    if value {
        LiveMatchOutcome::Match
    } else {
        LiveMatchOutcome::Skip
    }
}

fn live_subscription_may_be_affected_by_dependencies(
    input: &HandlerInput,
    read_dependencies: &[CapturedReadDependency],
    changes: &[ChangedRow],
) -> Option<LiveMatchOutcome> {
    // Point reads participate in the disjointness proof alongside query
    // predicates: an Ibex handler that does `ctx.db.get` and folds the row
    // into its result captures a `Row`/`MissingRow` dependency the query
    // predicates know nothing about, so a change landing on that (table, id)
    // must wake the subscription even when no query predicate matches —
    // otherwise the subscription goes permanently stale (ENG-23420).
    //
    // @ref LLP 0020#remaining-phase-4-design-dependency-vocabulary-and-auth-epochs —
    // the matcher may skip only when every changed row is disjoint from every
    // captured dependency; Row/MissingRow facts serve skip decisions too.
    let mut saw_query_dependency = false;
    for dependency in read_dependencies {
        match dependency.kind {
            CapturedReadKind::Row | CapturedReadKind::MissingRow => {
                let (Some(table), Some(id)) =
                    (dependency.table.as_deref(), dependency.id.as_deref())
                else {
                    return Some(LiveMatchOutcome::ConservativeFallback);
                };
                if changes
                    .iter()
                    .any(|change| change.table == table && change.id == id)
                {
                    return Some(LiveMatchOutcome::Match);
                }
            }
            CapturedReadKind::Query => saw_query_dependency = true,
            CapturedReadKind::Auth | CapturedReadKind::Permission => {}
        }
    }
    if !saw_query_dependency {
        // Without a query dependency the captured reads do not summarize the
        // handler's full read set (e.g. a handler that never ran, or captured
        // nothing); fall back to the conservative read-set-summary arm.
        return None;
    }

    for dependency in read_dependencies
        .iter()
        .filter(|dependency| dependency.kind == CapturedReadKind::Query)
    {
        let Some(table) = dependency.table.as_deref() else {
            return Some(LiveMatchOutcome::ConservativeFallback);
        };
        let Some(predicate) = dependency.predicate.as_ref() else {
            return Some(LiveMatchOutcome::ConservativeFallback);
        };
        let Ok(plan) = serde_json::from_value::<QueryPlan>(predicate.clone()) else {
            return Some(LiveMatchOutcome::ConservativeFallback);
        };
        for change in changes.iter().filter(|change| change.table == table) {
            let outcome = query_plan_change_outcome(&plan, input, change, Some(dependency));
            if outcome != LiveMatchOutcome::Skip {
                return Some(outcome);
            }
        }
    }

    Some(LiveMatchOutcome::Skip)
}

fn query_plan_change_outcome(
    plan: &QueryPlan,
    input: &HandlerInput,
    change: &ChangedRow,
    dependency: Option<&CapturedReadDependency>,
) -> LiveMatchOutcome {
    if change.table != plan.table {
        return LiveMatchOutcome::Skip;
    }
    if plan
        .table_visibility
        .as_ref()
        .is_some_and(crate::manifest::TableVisibilityV1::contains_membership)
    {
        return LiveMatchOutcome::ConservativeFallback;
    }
    let Some(row) = change.row.as_ref() else {
        return LiveMatchOutcome::ConservativeFallback;
    };
    match row_matches_query_filters(plan, input, row) {
        None => LiveMatchOutcome::ConservativeFallback,
        Some(true) => {
            if plan.order.is_empty() {
                LiveMatchOutcome::Match
            } else {
                match matching_limited_row_may_affect_query(plan, dependency, change, row) {
                    Some(true) => LiveMatchOutcome::Match,
                    Some(false) => LiveMatchOutcome::Skip,
                    None => LiveMatchOutcome::ConservativeFallback,
                }
            }
        }
        // A captured result member that no longer passes the current filter or
        // visibility predicate is an exit, not a disjoint write. This check is
        // independently load-bearing for subscriptions established before the
        // delta lane began maintaining point-read dependencies.
        //
        // @ref LLP 0008#reactivity-and-read-sets — captured row ids are part of
        //   the dependency summary; false-negative skips are correctness bugs.
        Some(false)
            if dependency
                .is_some_and(|dependency| dependency.rows.iter().any(|id| id == &change.id)) =>
        {
            LiveMatchOutcome::Match
        }
        Some(false) if update_may_have_changed_query_membership(plan, change) => {
            LiveMatchOutcome::ConservativeFallback
        }
        Some(false) => LiveMatchOutcome::Skip,
    }
}

/// Whether a committed change may affect the query described by a captured
/// query read dependency. Reused by commit-time read-set validation (LLP 0032
/// E4) so a disjoint-row write that does not match the query's predicate stops
/// conflicting — the same predicate the live matcher uses to decide delivery.
///
/// @ref LLP 0020#phase-3-capture-read-sets-during-handler-execution — one extractor, three consumers.
pub fn query_dependency_change_may_affect(
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
pub fn row_matches_query_filters(
    plan: &QueryPlan,
    input: &HandlerInput,
    row: &Value,
) -> Option<bool> {
    if let Some(visibility) = &plan.table_visibility
        && !row_matches_table_visibility(visibility, input, row)?
    {
        return Some(false);
    }
    for filter in &plan.filters {
        if !filter_matches_row(filter, input, row)? {
            return Some(false);
        }
    }
    Some(true)
}

fn row_matches_table_visibility(
    visibility: &crate::manifest::TableVisibilityV1,
    input: &HandlerInput,
    row: &Value,
) -> Option<bool> {
    use crate::manifest::{TableVisibilityArmV1, TableVisibilityV1};
    let owner_matches = |field: &str| {
        let user_id = input.auth.user_id.as_deref()?;
        Some(row.get(field)?.as_str()? == user_id)
    };
    match visibility {
        TableVisibilityV1::PublicRead => Some(true),
        TableVisibilityV1::Owner { field } => owner_matches(field),
        TableVisibilityV1::Membership { .. } => None,
        TableVisibilityV1::AnyOf { arms } => {
            let mut unknown = false;
            for arm in arms {
                match arm {
                    TableVisibilityArmV1::Owner { field } => match owner_matches(field) {
                        Some(true) => return Some(true),
                        Some(false) => {}
                        None => unknown = true,
                    },
                    TableVisibilityArmV1::Membership { .. } => unknown = true,
                }
            }
            if unknown { None } else { Some(false) }
        }
    }
}

fn filter_matches_row(filter: &FilterExpr, input: &HandlerInput, row: &Value) -> Option<bool> {
    let actual = row.get(&filter.field)?;
    let expected = eval_match_expr(&filter.value, input)?;
    if !filter_matches_expected(&filter.op, actual, &expected)? {
        return Some(false);
    }
    if input.auth.authorization_is_delegated && filter.value.uses_actor_projection() {
        let mut direct = input.clone();
        direct.auth = input.auth.direct_authorization_baseline()?;
        let direct_expected = eval_match_expr(&filter.value, &direct)?;
        return filter_matches_expected(&filter.op, actual, &direct_expected);
    }
    Some(true)
}

fn filter_matches_expected(op: &FilterOp, actual: &Value, expected: &Value) -> Option<bool> {
    // SQL three-valued logic: a NULL operand makes any comparison UNKNOWN, and
    // a `WHERE` clause excludes UNKNOWN rows. The matcher MUST agree with the
    // SQL `WHERE` (`build_query_sql`) or op-log delta membership diverges from
    // a real query — a NULL `priority` row phantoms into a `priority < 3`
    // result because `scalar_rank(Null) = 0 < Number` reads as `Less` (DK-3
    // review finding A). None of the supported operators match a NULL column
    // value; `IS NULL` is not an expressible predicate here. A NULL literal on
    // the right (`x = NULL`, `x < NULL`) is likewise UNKNOWN → excluded; `In`
    // keeps per-element equality (a NULL element simply never equals a
    // non-NULL `actual`, matching `x IN (a, NULL)`).
    if actual.is_null() {
        return Some(false);
    }
    if expected.is_null() && op != &FilterOp::In {
        return Some(false);
    }
    match op {
        FilterOp::Eq => Some(values_equal(actual, expected)),
        FilterOp::In => {
            let values = expected.as_array()?;
            Some(values.iter().any(|value| values_equal(actual, value)))
        }
        FilterOp::Lt => json_value_cmp(actual, expected).map(|ordering| ordering == Ordering::Less),
        FilterOp::Lte => json_value_cmp(actual, expected)
            .map(|ordering| ordering == Ordering::Less || ordering == Ordering::Equal),
        FilterOp::Gt => {
            json_value_cmp(actual, expected).map(|ordering| ordering == Ordering::Greater)
        }
        FilterOp::Gte => json_value_cmp(actual, expected)
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
    let field_may_have_changed = |candidate: &str| {
        system_field_changes_on_update(candidate)
            || change.changed_fields.iter().any(|field| field == candidate)
    };
    if plan
        .filters
        .iter()
        .any(|filter| field_may_have_changed(&filter.field))
    {
        return true;
    }
    match plan.table_visibility.as_ref() {
        Some(crate::manifest::TableVisibilityV1::Owner { field }) => field_may_have_changed(field),
        Some(crate::manifest::TableVisibilityV1::AnyOf { arms }) => arms.iter().any(|arm| {
            matches!(
                arm,
                crate::manifest::TableVisibilityArmV1::Owner { field }
                    if field_may_have_changed(field)
            )
        }),
        Some(
            crate::manifest::TableVisibilityV1::PublicRead
            | crate::manifest::TableVisibilityV1::Membership { .. },
        )
        | None => false,
    }
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
    if change.op == ChangeOp::Update
        && (change.changed_fields.is_empty()
            || change.changed_fields.iter().any(|name| name == field))
    {
        return false;
    }
    true
}

fn query_boundary(plan: &QueryPlan, rows: &[Value]) -> Option<Value> {
    let limit = effective_query_limit(plan);
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

pub fn sort_key(plan: &QueryPlan, row: &Value) -> Option<Value> {
    let mut values = Vec::with_capacity(plan.order.len() + 1);
    for order in &plan.order {
        // Optional fields omitted from a buffered insert are the same logical
        // NULL that storage materializes after commit. Normalizing here keeps
        // read-your-writes ordering identical on both sides of that commit.
        values.push(row.get(&order.field).cloned().unwrap_or(Value::Null));
    }
    // @ref LLP 0007#query-semantics — every explicit order ends with the portable,
    // ascending `_id` tie-break, including captured top-N boundary keys.
    values.push(Value::String(row.get("_id")?.as_str()?.to_owned()));
    Some(Value::Array(values))
}

pub fn compare_sort_keys(plan: &QueryPlan, left: &Value, right: &Value) -> Option<Ordering> {
    let left = left.as_array()?;
    let right = right.as_array()?;
    if left.len() != plan.order.len() + 1 || right.len() != plan.order.len() + 1 {
        return None;
    }
    for ((left_value, right_value), order) in left.iter().zip(right.iter()).zip(plan.order.iter()) {
        // LLP 0007 fixes NULL last independently of direction. Reversing the
        // whole scalar comparator would put NULL first for DESC, so only
        // present-value ordering follows the requested direction.
        let ordering = match (left_value.is_null(), right_value.is_null()) {
            (true, true) => Ordering::Equal,
            (true, false) => Ordering::Greater,
            (false, true) => Ordering::Less,
            (false, false) => {
                let ordering = json_value_cmp(left_value, right_value)?;
                if order.direction == OrderDirection::Desc {
                    ordering.reverse()
                } else {
                    ordering
                }
            }
        };
        if ordering != Ordering::Equal {
            return Some(ordering);
        }
    }
    Some(left.last()?.as_str()?.cmp(right.last()?.as_str()?))
}

// Delegates to the shared profile evaluator (LLP 0051 D2's analyzability
// invariant: matcher and SQL evaluate filter values through one code path).
// The environment deliberately has no bindings, clock, or id source —
// expressions needing them (and any evaluation failure) are unanalyzable
// here, and the affected query falls back to `live_replace`, the honest
// default.
fn eval_match_expr(expr: &ValueExpr, input: &HandlerInput) -> Option<Value> {
    let env = crate::value_expr::ExprEnv {
        args: &input.args,
        auth_user_id: input.auth.user_id.as_deref(),
        auth_kind: input.auth.authorization_kind.as_deref(),
        auth_actor_kind: input.auth.authorization_actor_kind.as_deref(),
        auth_activity_actor_kind: input.auth.authorization_activity_actor_kind.as_deref(),
        auth_actor_user_id: input.auth.authorization_actor_user_id.as_deref(),
        auth_grant_id: input.auth.authorization_grant_id.as_deref(),
        client_mutation_digest: input.auth.client_mutation_digest.as_deref(),
        auth_is_delegated: input.auth.authorization_is_delegated,
        bindings: None,
        now_ms: None,
        runtime_id: None,
    };
    crate::value_expr::eval_value_expr(expr, &env).ok()
}

fn values_equal(actual: &Value, expected: &Value) -> bool {
    match (actual, expected) {
        (Value::Number(a), Value::Number(b)) => json_number_cmp(a, b) == Some(Ordering::Equal),
        _ => actual == expected,
    }
}

fn json_value_cmp(left: &Value, right: &Value) -> Option<Ordering> {
    match (left, right) {
        (Value::Null, Value::Null) => Some(Ordering::Equal),
        (Value::Bool(left), Value::Bool(right)) => Some(left.cmp(right)),
        (Value::Number(left), Value::Number(right)) => json_number_cmp(left, right),
        (Value::String(left), Value::String(right)) => Some(left.cmp(right)),
        _ => {
            let left_rank = scalar_rank(left)?;
            let right_rank = scalar_rank(right)?;
            Some(left_rank.cmp(&right_rank))
        }
    }
}

fn system_field_changes_on_update(field: &str) -> bool {
    matches!(field, "_updatedAt" | "_version")
}

fn json_number_cmp(left: &serde_json::Number, right: &serde_json::Number) -> Option<Ordering> {
    if let (Some(left), Some(right)) = (integer_value(left), integer_value(right)) {
        return Some(left.cmp(&right));
    }
    left.as_f64()?.partial_cmp(&right.as_f64()?)
}

fn integer_value(number: &serde_json::Number) -> Option<i128> {
    if let Some(value) = number.as_i64() {
        return Some(value as i128);
    }
    if let Some(value) = number.as_u64() {
        return Some(value as i128);
    }
    None
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

// ---------------------------------------------------------------------------
// DK-3 op-log delta core (LLP 0032 M3 armed the trigger; this is the
// shape-agnostic server half — computes membership transitions, not a wire
// payload). Wiring into the fan-out path + the `live_delta` wire kind + the
// client apply are the coordinated Phase-2 step (LLP 0034 delivery surface).
// ---------------------------------------------------------------------------

/// One row-level membership transition a commit produces for a subscription.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LiveDeltaKind {
    /// The row newly enters the result (an insert that matches, or an update
    /// that moves a row into the predicate). The client upserts it.
    Add,
    /// The row was already in the result and changed in place. The client
    /// replaces it by id.
    Update,
    /// The row leaves the result (a delete of a member, or an update that
    /// moves it out of the predicate). The client drops it by id.
    Remove,
}

/// A single delta op: the transition, the row id, and the current row (present
/// for `Add`/`Update`, absent for `Remove`).
#[derive(Clone, Debug, PartialEq)]
pub struct LiveDeltaOp {
    pub kind: LiveDeltaKind,
    pub id: String,
    pub row: Option<Value>,
}

/// The outcome of classifying a commit against one subscription's predicate.
#[derive(Clone, Debug, PartialEq)]
pub enum LiveDeltaOutcome {
    /// The query is analyzable; these are the transitions to ship as a
    /// `live_delta`. An empty vec means the commit touched the table but did
    /// not change this subscription's result (ship nothing — still cheaper
    /// than a re-query, and the matcher's affected-gate should already have
    /// skipped most of these).
    Delta(Vec<LiveDeltaOp>),
    /// The query cannot be delta'd safely — an ordered/limited window whose
    /// boundary a change may shift using rows outside the known membership, or
    /// a predicate the matcher cannot evaluate. The caller falls back to the
    /// honest whole-result `replace` (LLP 0008 §Reactivity keeps that path as
    /// the fallback for un-analyzable queries).
    Replace,
}

/// Compute the op-log delta for one live subscription from a commit's changed
/// rows, without re-running the query (the DK-3 lever; LLP 0035 §M3's
/// original ~5 200× figure came from fixtures later corrected in `37f1a2f`
/// as understating affected-delivery cost — the corrected ratio is
/// unmeasured, and the bench smoke gate asserts only a ≥2× margin per run).
///
/// Inputs:
/// - `plan` + `input`: the subscription's captured analyzable predicate (from
///   its `CapturedReadKind::Query` dependency) and the args/auth to evaluate it.
/// - `prior_ids`: the ids currently in the subscription's result (the captured
///   dependency's `rows`). **Caller contract:** keep this in sync by applying
///   the returned ops — the delta path must not re-query to refresh membership,
///   or it defeats the lever.
/// - `changes`: the commit's `ChangedRow` set.
///
/// Only changes to `plan.table` are considered; the caller's affected-gate
/// (`live_subscription_may_be_affected`) has typically already decided this
/// subscription is affected, but the function is self-contained and re-checks.
/// Permission/auth-scope transitions are **not** handled here — the fan-out
/// caller gates stale permissions and emits permission resyncs separately.
///
/// @ref LLP 0008#decision-dk-3--delta-shape-and-read-lane-2026-07-01 — op-log
/// deltas for the analyzable syncable-live subset, the lever LLP 0035 §M3 armed.
pub fn compute_live_delta(
    plan: &QueryPlan,
    input: &HandlerInput,
    prior_ids: &std::collections::BTreeSet<String>,
    changes: &[ChangedRow],
) -> LiveDeltaOutcome {
    // Ordered/limited (top-N) queries: a change can shift the window using rows
    // outside the current membership, which a commit's changed-row set alone
    // cannot resolve. The honest `replace` path handles these correctly;
    // extending deltas to windowed queries (the matcher already has
    // `matching_limited_row_may_affect_query`/`query_boundary`) is future DK-3
    // work, deliberately not attempted here.
    // Every query now has a finite effective limit, including an omitted
    // `take`. An unordered result that is still below that cap is known
    // complete and can keep using exact row deltas; once membership reaches
    // the cap, an unseen row may occupy the window and replacement is the
    // only honest answer.
    if !plan.order.is_empty() || prior_ids.len() >= effective_query_limit(plan) {
        return LiveDeltaOutcome::Replace;
    }

    // Membership-gated (semi-join) queries: row classification below evaluates
    // only `plan.filters` — never the membership predicate — and changes to
    // the membership table itself are skipped by the `plan.table` check, so a
    // delta can both over-deliver (a row the subscriber's membership excludes)
    // and freeze visibility transitions (a membership-only commit nets zero
    // ops). The conservative lane is the only honest answer until a certified
    // semi-join evaluator exists. Belt-and-suspenders with the candidacy gate
    // in `notify_live_subscriptions`.
    // @ref LLP 0056#what-exists-what-this-adds — semi-join queries ride the
    // conservative re-query/`live_replace` lane (LLP 0067 §F2a).
    if !plan.membership_filters.is_empty()
        || plan
            .table_visibility
            .as_ref()
            .is_some_and(crate::manifest::TableVisibilityV1::contains_membership)
    {
        return LiveDeltaOutcome::Replace;
    }

    // A commit can touch the same row more than once — a mutation plan may
    // `Insert(bind_id_as x)` then `Delete(x)`, so `changes` holds two entries
    // for one id. Only the LAST entry reflects the row's final committed
    // state; classifying each entry independently would net an `Add` for a
    // created-then-deleted row (`was_member` reads pre-commit membership for
    // both — DK-3 review finding B). Collapse to the last change per id,
    // preserving first-seen order for a stable op sequence.
    let mut order: Vec<&str> = Vec::new();
    let mut last: std::collections::HashMap<&str, &ChangedRow> = std::collections::HashMap::new();
    for change in changes {
        if change.table != plan.table {
            continue;
        }
        if !last.contains_key(change.id.as_str()) {
            order.push(change.id.as_str());
        }
        last.insert(change.id.as_str(), change);
    }

    let mut ops = Vec::new();
    for id in order {
        let change = last[id];
        let was_member = prior_ids.contains(id);
        match change.op {
            ChangeOp::Insert => {
                let Some(row) = change.row.as_ref() else {
                    // An insert with no row snapshot is not something we can
                    // classify; fall back rather than guess.
                    return LiveDeltaOutcome::Replace;
                };
                match row_matches_query_filters(plan, input, row) {
                    Some(true) => ops.push(LiveDeltaOp {
                        kind: LiveDeltaKind::Add,
                        id: change.id.clone(),
                        row: Some(row.clone()),
                    }),
                    Some(false) => {}
                    None => return LiveDeltaOutcome::Replace,
                }
            }
            ChangeOp::Update => {
                let Some(row) = change.row.as_ref() else {
                    return LiveDeltaOutcome::Replace;
                };
                match row_matches_query_filters(plan, input, row) {
                    Some(true) => ops.push(LiveDeltaOp {
                        // Was already in the result → in-place Update; newly
                        // matching (moved into the predicate) → Add.
                        kind: if was_member {
                            LiveDeltaKind::Update
                        } else {
                            LiveDeltaKind::Add
                        },
                        id: change.id.clone(),
                        row: Some(row.clone()),
                    }),
                    Some(false) => {
                        // No longer matches: a member leaves; a non-member is
                        // unaffected.
                        if was_member {
                            ops.push(LiveDeltaOp {
                                kind: LiveDeltaKind::Remove,
                                id: change.id.clone(),
                                row: None,
                            });
                        }
                    }
                    None => return LiveDeltaOutcome::Replace,
                }
            }
            ChangeOp::Delete => {
                if was_member {
                    ops.push(LiveDeltaOp {
                        kind: LiveDeltaKind::Remove,
                        id: change.id.clone(),
                        row: None,
                    });
                }
            }
        }
    }
    LiveDeltaOutcome::Delta(ops)
}

#[cfg(test)]
mod dependency_gate_tests {
    use super::*;
    use crate::contract_types::{
        BoundedParentVisibility, BoundedProjectionField, JoinEquality, JoinKind,
    };
    use crate::manifest::{
        AuthInput, BoundedChildrenQueryPlan, CustomAuthorizationPolicyInputV1,
        CustomAuthorizationV1, FunctionDefinition, FunctionKind, IbexModule, RelationalQueryPlan,
        SnapshotBatchNodeV2, SnapshotBatchPlanV1, SnapshotBatchPlanV2, TableVisibilityV1,
    };

    fn input() -> HandlerInput {
        HandlerInput {
            args: json!({}),
            auth: AuthInput::default(),
            read_set: Vec::new(),
            correlation: None,
            ctx_ledger: None,
        }
    }

    fn ibex_live_query() -> FunctionDefinition {
        let mut definition = FunctionDefinition::new(
            "listTodos",
            FunctionKind::LiveQuery,
            FunctionRuntime::IbexModule(IbexModule {
                source: "unused".to_owned(),
                export: "listTodos".to_owned(),
            }),
        );
        definition.read_set_summary.tables = vec!["todos".to_owned()];
        definition
    }

    fn empty_dependency(kind: CapturedReadKind) -> CapturedReadDependency {
        CapturedReadDependency {
            kind,
            table: None,
            id: None,
            version: None,
            predicate: None,
            rows: Vec::new(),
            field: None,
            value: None,
            order: None,
            limit: None,
            result_count: None,
            boundary: None,
        }
    }

    fn point_dependency(kind: CapturedReadKind, table: &str, id: &str) -> CapturedReadDependency {
        CapturedReadDependency {
            table: Some(table.to_owned()),
            id: Some(id.to_owned()),
            version: Some(1),
            ..empty_dependency(kind)
        }
    }

    /// A captured query on `todos` filtered to `completed = true`.
    fn completed_todos_query_dependency() -> CapturedReadDependency {
        let plan = QueryPlan {
            table_visibility: None,
            table: "todos".to_owned(),
            filters: vec![FilterExpr {
                field: "completed".to_owned(),
                op: FilterOp::Eq,
                value: ValueExpr::Literal(Value::Bool(true)),
            }],
            order: Vec::new(),
            limit: None,
            membership_filters: Vec::new(),
            indexed_by: None,
        };
        CapturedReadDependency {
            table: Some("todos".to_owned()),
            version: Some(1),
            predicate: Some(serde_json::to_value(&plan).expect("serialize plan")),
            ..empty_dependency(CapturedReadKind::Query)
        }
    }

    fn update(table: &str, id: &str, row: Value, changed_fields: &[&str]) -> ChangedRow {
        ChangedRow {
            table: table.to_owned(),
            id: id.to_owned(),
            op: ChangeOp::Update,
            row: Some(row),
            changed_fields: changed_fields.iter().map(|s| s.to_string()).collect(),
        }
    }

    fn owner_visible_plan() -> QueryPlan {
        QueryPlan {
            table_visibility: Some(crate::manifest::TableVisibilityV1::Owner {
                field: "ownerId".to_owned(),
            }),
            table: "documents".to_owned(),
            filters: Vec::new(),
            order: Vec::new(),
            limit: None,
            membership_filters: Vec::new(),
            indexed_by: None,
        }
    }

    fn owner_input() -> HandlerInput {
        HandlerInput {
            auth: AuthInput {
                user_id: Some("ada".to_owned()),
                ..AuthInput::default()
            },
            ..input()
        }
    }

    #[test]
    fn composed_multi_table_visibility_uses_conservative_authorization_invalidation() {
        let restricted = Some(TableVisibilityV1::Owner {
            field: "ownerId".to_owned(),
        });
        let relational = RelationalQueryPlan {
            root: "documents".to_owned(),
            root_alias: "document".to_owned(),
            joined: "profiles".to_owned(),
            joined_alias: "profile".to_owned(),
            join_kind: JoinKind::Left,
            join_on: vec![JoinEquality {
                root_field: "profileId".to_owned(),
                joined_field: "_id".to_owned(),
            }],
            root_filters: Vec::new(),
            root_visibility: Vec::new(),
            root_table_visibility: restricted.clone(),
            joined_visibility: Vec::new(),
            joined_table_visibility: None,
            projection: Vec::new(),
            order: Vec::new(),
            take: 10,
            root_index: "by_id".to_owned(),
            joined_index: "by_id".to_owned(),
        };
        let bounded = BoundedChildrenQueryPlan {
            profile: "bounded-children.v1".to_owned(),
            required_capability: "bounded_children_v1".to_owned(),
            parent_table: "boards".to_owned(),
            parent_id_arg: "boardId".to_owned(),
            parent_visibility: BoundedParentVisibility::PublicRead,
            parent_table_visibility: None,
            parent_projection: vec![BoundedProjectionField {
                name: "id".to_owned(),
                field: "_id".to_owned(),
            }],
            child_table: "cards".to_owned(),
            child_table_visibility: restricted,
            child_foreign_key: "boardId".to_owned(),
            child_relation_incarnation: "boardIncarnation".to_owned(),
            child_index: "by_board".to_owned(),
            order: Vec::new(),
            take: 10,
            child_projection: Vec::new(),
            parent_deletion: "hide-orphans.v1".to_owned(),
        };
        let unrelated = [update("unrelated", "row-1", json!({ "_id": "row-1" }), &[])];
        let disjoint_dependencies = [completed_todos_query_dependency()];
        let cases = [
            HandlerPlan::RelationalQuery(relational.clone()),
            HandlerPlan::BoundedChildrenQuery(bounded.clone()),
            HandlerPlan::SnapshotBatch(SnapshotBatchPlanV1 {
                profile: "snapshot-batch.v1".to_owned(),
                nodes: vec![bounded.clone()],
                normalized_composite_plan: Value::Null,
                plan_hash: "fixture".to_owned(),
            }),
            HandlerPlan::SnapshotBatchV2(SnapshotBatchPlanV2 {
                profile: "snapshot-batch.v2".to_owned(),
                nodes: vec![
                    SnapshotBatchNodeV2::RelationalQuery(relational),
                    SnapshotBatchNodeV2::BoundedChildren(bounded),
                ],
                normalized_composite_plan: Value::Null,
                plan_hash: "fixture".to_owned(),
            }),
        ];
        for plan in cases {
            let definition = FunctionDefinition::new(
                "composed",
                FunctionKind::LiveQuery,
                FunctionRuntime::HostPlan(plan),
            );
            assert_eq!(
                live_subscription_match_outcome(
                    &definition,
                    &owner_input(),
                    &disjoint_dependencies,
                    &unrelated,
                ),
                LiveMatchOutcome::ConservativeFallback,
                "policy-composed multi-table surfaces must resnapshot before dependency disjointness",
            );
        }
    }

    #[test]
    fn coarse_custom_authorization_wakes_on_every_application_change() {
        let mut definition = ibex_live_query();
        definition.custom_authorization = Some(CustomAuthorizationV1 {
            offline: "none".to_owned(),
            sync: "coarse-global".to_owned(),
            inputs: vec![CustomAuthorizationPolicyInputV1 {
                kind: "table".to_owned(),
                table: "documentAccess".to_owned(),
                subject: "ctx.auth.userId".to_owned(),
                key: vec!["documentId".to_owned(), "userId".to_owned()],
            }],
            input_completeness: "unproven".to_owned(),
            pushdown: "none".to_owned(),
            retention: "none".to_owned(),
            precise_invalidation: false,
            coarse_global_wake_universe: vec![
                "membership-relation-insert-update-delete".to_owned(),
                "protected-resource-row-insert-update-delete".to_owned(),
                "effective-principal-or-auth-context-change".to_owned(),
                "authority-profile-generation-activation".to_owned(),
            ],
            evaluator_identity: format!("sha256:{}", "1".repeat(64)),
        });
        let unrelated = [update("unrelated", "row-1", json!({ "_id": "row-1" }), &[])];
        assert_eq!(
            live_subscription_match_outcome(&definition, &input(), &[], &unrelated),
            LiveMatchOutcome::ConservativeFallback,
            "declared inputs are never used to make a precision claim",
        );
    }

    #[test]
    fn captured_query_member_visibility_exit_is_not_skipped() {
        let plan = owner_visible_plan();
        let dependency = CapturedReadDependency {
            kind: CapturedReadKind::Query,
            table: Some("documents".to_owned()),
            version: Some(1),
            predicate: Some(serde_json::to_value(&plan).expect("serialize plan")),
            rows: vec!["doc_1".to_owned()],
            ..empty_dependency(CapturedReadKind::Query)
        };
        let change = update(
            "documents",
            "doc_1",
            json!({ "_id": "doc_1", "ownerId": "bob" }),
            &["ownerId"],
        );

        assert_eq!(
            query_plan_change_outcome(&plan, &owner_input(), &change, Some(&dependency)),
            LiveMatchOutcome::Match,
            "a retained result member leaving owner visibility must wake even without a Row dependency"
        );
    }

    #[test]
    fn owner_visibility_field_update_falls_back_when_prior_membership_is_unknown() {
        let plan = owner_visible_plan();
        let dependency = CapturedReadDependency {
            kind: CapturedReadKind::Query,
            table: Some("documents".to_owned()),
            version: Some(1),
            predicate: Some(serde_json::to_value(&plan).expect("serialize plan")),
            ..empty_dependency(CapturedReadKind::Query)
        };
        let change = update(
            "documents",
            "doc_2",
            json!({ "_id": "doc_2", "ownerId": "bob" }),
            &["ownerId"],
        );

        assert_eq!(
            query_plan_change_outcome(&plan, &owner_input(), &change, Some(&dependency)),
            LiveMatchOutcome::ConservativeFallback,
            "owner visibility fields participate in membership-change detection like filters"
        );
    }

    // ENG-23420: a change landing on a `Row` point-read dependency must wake
    // the subscription even when no query predicate matches the change —
    // previously the gate consulted only `Query` dependencies and returned a
    // skip verdict, leaving the subscription permanently stale.
    #[test]
    fn cross_table_row_dependency_hit_wakes_subscription() {
        let definition = ibex_live_query();
        let dependencies = vec![
            point_dependency(CapturedReadKind::Row, "users", "u1"),
            completed_todos_query_dependency(),
        ];
        let changes = vec![update(
            "users",
            "u1",
            json!({ "_id": "u1", "name": "Ada v2" }),
            &["name"],
        )];
        assert!(live_subscription_may_be_affected(
            &definition,
            &input(),
            &dependencies,
            &changes,
        ));
    }

    #[test]
    fn missing_row_dependency_hit_wakes_subscription() {
        let definition = ibex_live_query();
        let dependencies = vec![
            point_dependency(CapturedReadKind::MissingRow, "users", "u2"),
            completed_todos_query_dependency(),
        ];
        let changes = vec![ChangedRow {
            table: "users".to_owned(),
            id: "u2".to_owned(),
            op: ChangeOp::Insert,
            row: Some(json!({ "_id": "u2", "name": "New" })),
            changed_fields: Vec::new(),
        }];
        assert!(live_subscription_may_be_affected(
            &definition,
            &input(),
            &dependencies,
            &changes,
        ));
    }

    // The same-table variant: a point-read row that fails the query filter is
    // still a dependency; an update to its non-filter fields must wake the
    // subscription.
    #[test]
    fn same_table_point_read_outside_predicate_wakes_subscription() {
        let definition = ibex_live_query();
        let dependencies = vec![
            point_dependency(CapturedReadKind::Row, "todos", "pinned"),
            completed_todos_query_dependency(),
        ];
        let changes = vec![update(
            "todos",
            "pinned",
            json!({ "_id": "pinned", "completed": false, "title": "v2" }),
            &["title"],
        )];
        assert!(live_subscription_may_be_affected(
            &definition,
            &input(),
            &dependencies,
            &changes,
        ));
    }

    // The skip lever stays armed: changes disjoint from every captured
    // dependency — point reads and query predicates alike — are still skipped.
    #[test]
    fn changes_disjoint_from_point_reads_and_predicates_still_skip() {
        let definition = ibex_live_query();
        let dependencies = vec![
            point_dependency(CapturedReadKind::Row, "users", "u1"),
            point_dependency(CapturedReadKind::MissingRow, "users", "u2"),
            completed_todos_query_dependency(),
        ];
        let changes = vec![
            update(
                "users",
                "u9",
                json!({ "_id": "u9", "name": "x" }),
                &["name"],
            ),
            update(
                "todos",
                "other",
                json!({ "_id": "other", "completed": false, "title": "t" }),
                &["title"],
            ),
        ];
        assert!(!live_subscription_may_be_affected(
            &definition,
            &input(),
            &dependencies,
            &changes,
        ));
    }

    // A malformed point-read dependency (missing table/id) cannot prove
    // disjointness, so the gate goes conservative.
    #[test]
    fn point_read_dependency_without_identity_is_conservative() {
        let definition = ibex_live_query();
        let dependencies = vec![
            empty_dependency(CapturedReadKind::Row),
            completed_todos_query_dependency(),
        ];
        let changes = vec![update(
            "todos",
            "other",
            json!({ "_id": "other", "completed": false, "title": "t" }),
            &["title"],
        )];
        assert!(live_subscription_may_be_affected(
            &definition,
            &input(),
            &dependencies,
            &changes,
        ));
    }
}

#[cfg(test)]
mod delta_tests {
    use super::*;
    use crate::manifest::{
        AuthInput, HandlerInput, MembershipPredicate, MembershipResourceRef, OrderExpr, ValueExpr,
    };
    use std::collections::BTreeSet;

    fn input(args: Value) -> HandlerInput {
        HandlerInput {
            args,
            auth: AuthInput::default(),
            read_set: Vec::new(),
            correlation: None,
            ctx_ledger: None,
        }
    }

    fn unfiltered_plan() -> QueryPlan {
        QueryPlan {
            table_visibility: None,
            table: "todos".to_owned(),
            filters: Vec::new(),
            order: Vec::new(),
            limit: None,
            membership_filters: Vec::new(),
            indexed_by: None,
        }
    }

    #[test]
    fn numeric_equality_keeps_large_integers_exact() {
        let plan = QueryPlan {
            table_visibility: None,
            table: "todos".to_owned(),
            filters: vec![FilterExpr {
                field: "seq".to_owned(),
                op: FilterOp::Eq,
                value: ValueExpr::Literal(json!(9_007_199_254_740_993_u64)),
            }],
            order: Vec::new(),
            limit: None,
            membership_filters: Vec::new(),
            indexed_by: None,
        };

        assert_eq!(
            row_matches_query_filters(
                &plan,
                &input(json!({})),
                &json!({ "seq": 9_007_199_254_740_992_u64 })
            ),
            Some(false),
            "distinct integers above the f64 safe range must not collapse"
        );
        assert_eq!(
            row_matches_query_filters(
                &plan,
                &input(json!({})),
                &json!({ "seq": 9_007_199_254_740_993_u64 })
            ),
            Some(true)
        );
    }

    #[test]
    fn arg_filters_follow_the_same_dotted_paths_as_storage() {
        let plan = QueryPlan {
            table_visibility: None,
            table: "todos".to_owned(),
            filters: vec![FilterExpr {
                field: "userId".to_owned(),
                op: FilterOp::Eq,
                value: ValueExpr::Arg("filter.userId".to_owned()),
            }],
            order: Vec::new(),
            limit: None,
            membership_filters: Vec::new(),
            indexed_by: None,
        };

        assert_eq!(
            row_matches_query_filters(
                &plan,
                &input(json!({ "filter": { "userId": "ada" } })),
                &json!({ "userId": "ada" })
            ),
            Some(true)
        );
        assert_eq!(
            row_matches_query_filters(
                &plan,
                &input(json!({ "filter": { "userId": "grace" } })),
                &json!({ "userId": "ada" })
            ),
            Some(false)
        );
    }

    #[test]
    fn delegated_live_matching_reapplies_the_direct_authorization_baseline() {
        let delegated = HandlerInput {
            auth: AuthInput {
                user_id: Some("effective-user".to_owned()),
                ..AuthInput::default()
            }
            .with_authorization_projection(Some("human"), Some("agent"), true),
            ..HandlerInput::default()
        };
        let plan = QueryPlan {
            table_visibility: None,
            table: "todos".to_owned(),
            filters: vec![FilterExpr {
                field: "title".to_owned(),
                op: FilterOp::Eq,
                value: ValueExpr::If {
                    cond: Box::new(ValueExpr::AuthIsDelegated),
                    then: Box::new(ValueExpr::Literal(json!("delegated"))),
                    r#else: Box::new(ValueExpr::Literal(json!("direct"))),
                },
            }],
            ..unfiltered_plan()
        };
        let widened = json!({ "_id": "widened", "title": "delegated" });
        assert_eq!(
            row_matches_query_filters(&plan, &delegated, &widened),
            Some(false),
            "an incremental row cannot bypass the direct projection"
        );
        assert_eq!(
            compute_live_delta(
                &plan,
                &delegated,
                &BTreeSet::new(),
                &[ChangedRow {
                    table: "todos".to_owned(),
                    id: "widened".to_owned(),
                    op: ChangeOp::Insert,
                    row: Some(widened),
                    changed_fields: vec!["title".to_owned()],
                }],
            ),
            LiveDeltaOutcome::Delta(Vec::new()),
            "the op-log delta path must not add a delegated-only row"
        );
    }

    #[test]
    fn sort_keys_keep_null_last_independent_of_direction() {
        for direction in [OrderDirection::Asc, OrderDirection::Desc] {
            let plan = QueryPlan {
                table_visibility: None,
                table: "todos".to_owned(),
                filters: Vec::new(),
                order: vec![OrderExpr {
                    field: "rank".to_owned(),
                    direction: direction.clone(),
                    max_encoded_bytes: None,
                }],
                limit: Some(2),
                membership_filters: Vec::new(),
                indexed_by: None,
            };
            assert_eq!(
                compare_sort_keys(&plan, &json!([null, "a"]), &json!([1, "b"])),
                Some(Ordering::Greater),
                "NULL must sort after a present value for {direction:?}"
            );
            assert_eq!(
                compare_sort_keys(&plan, &json!([1, "a"]), &json!([null, "b"])),
                Some(Ordering::Less),
                "a present value must sort before NULL for {direction:?}"
            );
            assert_eq!(
                compare_sort_keys(&plan, &json!([1, "a"]), &json!([1, "b"])),
                Some(Ordering::Less),
                "_id is the final ascending tie-break for {direction:?}"
            );
            assert_eq!(
                sort_key(&plan, &json!({ "_id": "missing-rank" })),
                Some(json!([null, "missing-rank"])),
                "an omitted optional field is the same ordering key as stored NULL",
            );
        }
    }

    #[test]
    fn limited_query_boundaries_include_id_and_use_it_for_membership() {
        let plan = QueryPlan {
            table_visibility: None,
            table: "todos".to_owned(),
            filters: Vec::new(),
            order: vec![OrderExpr {
                field: "rank".to_owned(),
                direction: OrderDirection::Asc,
                max_encoded_bytes: None,
            }],
            limit: Some(2),
            membership_filters: Vec::new(),
            indexed_by: None,
        };
        let rows = [
            json!({ "_id": "a", "rank": 1 }),
            json!({ "_id": "b", "rank": 1 }),
        ];
        let boundary = query_boundary(&plan, &rows).expect("limited boundary");
        assert_eq!(boundary["first"], json!([1, "a"]));
        assert_eq!(boundary["last"], json!([1, "b"]));

        let dependency = CapturedReadDependency {
            kind: CapturedReadKind::Query,
            table: Some("todos".to_owned()),
            id: None,
            version: Some(1),
            predicate: None,
            rows: vec!["a".to_owned(), "b".to_owned()],
            field: None,
            value: None,
            order: None,
            limit: Some(2),
            result_count: Some(2),
            boundary: Some(boundary),
        };
        let after = ChangedRow {
            table: "todos".to_owned(),
            id: "c".to_owned(),
            op: ChangeOp::Insert,
            row: Some(json!({ "_id": "c", "rank": 1 })),
            changed_fields: Vec::new(),
        };
        assert_eq!(
            matching_limited_row_may_affect_query(
                &plan,
                Some(&dependency),
                &after,
                after.row.as_ref().expect("after row"),
            ),
            Some(false),
            "a same-rank id after the captured boundary cannot enter top N",
        );
        let before = ChangedRow {
            table: "todos".to_owned(),
            id: "aa".to_owned(),
            op: ChangeOp::Insert,
            row: Some(json!({ "_id": "aa", "rank": 1 })),
            changed_fields: Vec::new(),
        };
        assert_eq!(
            matching_limited_row_may_affect_query(
                &plan,
                Some(&dependency),
                &before,
                before.row.as_ref().expect("before row"),
            ),
            Some(true),
            "a same-rank id before the captured boundary can enter top N",
        );
    }

    /// v1 profile expressions in filter values evaluate through the shared
    /// evaluator, so pure forms (arithmetic, calls into the pinned library,
    /// null-propagating Field access) are newly analyzable for delta
    /// maintenance, while binding/clock/id-dependent forms stay unanalyzable
    /// (None -> live_replace, the honest default). LLP 0051 D2's
    /// analyzability invariant: matcher and SQL share one evaluation.
    #[test]
    fn extended_pure_filter_values_are_analyzable_and_match_sql_semantics() {
        let clamped = QueryPlan {
            table_visibility: None,
            table: "todos".to_owned(),
            filters: vec![FilterExpr {
                field: "rank".to_owned(),
                op: FilterOp::Lte,
                value: ValueExpr::Call {
                    func: "min".to_owned(),
                    args: vec![
                        ValueExpr::Literal(json!(10)),
                        ValueExpr::Binary {
                            op: crate::manifest::BinaryOp::Add,
                            left: Box::new(ValueExpr::Arg("base".to_owned())),
                            right: Box::new(ValueExpr::Literal(json!(2))),
                        },
                    ],
                },
            }],
            order: Vec::new(),
            limit: None,
            membership_filters: Vec::new(),
            indexed_by: None,
        };
        // min(10, 3 + 2) = 5
        let args = input(json!({ "base": 3 }));
        assert_eq!(
            row_matches_query_filters(&clamped, &args, &json!({ "rank": 5 })),
            Some(true)
        );
        assert_eq!(
            row_matches_query_filters(&clamped, &args, &json!({ "rank": 6 })),
            Some(false)
        );

        let binding_dependent = QueryPlan {
            table_visibility: None,
            table: "todos".to_owned(),
            filters: vec![FilterExpr {
                field: "rank".to_owned(),
                op: FilterOp::Eq,
                value: ValueExpr::Binding("bound".to_owned()),
            }],
            order: Vec::new(),
            limit: None,
            membership_filters: Vec::new(),
            indexed_by: None,
        };
        assert_eq!(
            row_matches_query_filters(&binding_dependent, &args, &json!({ "rank": 5 })),
            None,
            "binding-dependent filters stay unanalyzable"
        );
    }

    fn user_filtered_plan() -> QueryPlan {
        QueryPlan {
            table_visibility: None,
            table: "todos".to_owned(),
            filters: vec![FilterExpr {
                field: "userId".to_owned(),
                op: FilterOp::Eq,
                value: ValueExpr::Arg("userId".to_owned()),
            }],
            order: Vec::new(),
            limit: None,
            membership_filters: Vec::new(),
            indexed_by: None,
        }
    }

    fn row(id: &str, user: &str) -> Value {
        json!({ "_id": id, "_version": 1, "title": "t", "userId": user })
    }

    fn change(id: &str, op: ChangeOp, row: Option<Value>) -> ChangedRow {
        ChangedRow {
            table: "todos".to_owned(),
            id: id.to_owned(),
            op,
            row,
            changed_fields: Vec::new(),
        }
    }

    fn ids(list: &[&str]) -> BTreeSet<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    fn delta(outcome: LiveDeltaOutcome) -> Vec<LiveDeltaOp> {
        match outcome {
            LiveDeltaOutcome::Delta(ops) => ops,
            LiveDeltaOutcome::Replace => panic!("expected a delta, got Replace"),
        }
    }

    #[test]
    fn unfiltered_insert_update_delete_map_to_add_update_remove() {
        let plan = unfiltered_plan();
        let input = input(json!({}));

        let add = delta(compute_live_delta(
            &plan,
            &input,
            &ids(&[]),
            &[change("a", ChangeOp::Insert, Some(row("a", "u1")))],
        ));
        assert_eq!(
            add,
            vec![LiveDeltaOp {
                kind: LiveDeltaKind::Add,
                id: "a".to_owned(),
                row: Some(row("a", "u1")),
            }]
        );

        let update = delta(compute_live_delta(
            &plan,
            &input,
            &ids(&["a"]),
            &[change("a", ChangeOp::Update, Some(row("a", "u1")))],
        ));
        assert_eq!(update[0].kind, LiveDeltaKind::Update);

        let remove = delta(compute_live_delta(
            &plan,
            &input,
            &ids(&["a"]),
            &[change("a", ChangeOp::Delete, None)],
        ));
        assert_eq!(
            remove,
            vec![LiveDeltaOp {
                kind: LiveDeltaKind::Remove,
                id: "a".to_owned(),
                row: None,
            }]
        );
    }

    #[test]
    fn filtered_insert_matching_adds_nonmatching_skips() {
        let plan = user_filtered_plan();
        let input = input(json!({ "userId": "u-match" }));

        let matching = delta(compute_live_delta(
            &plan,
            &input,
            &ids(&[]),
            &[change("a", ChangeOp::Insert, Some(row("a", "u-match")))],
        ));
        assert_eq!(matching.len(), 1);
        assert_eq!(matching[0].kind, LiveDeltaKind::Add);

        let nonmatching = delta(compute_live_delta(
            &plan,
            &input,
            &ids(&[]),
            &[change(
                "b",
                ChangeOp::Insert,
                Some(row("b", "someone-else")),
            )],
        ));
        assert!(
            nonmatching.is_empty(),
            "a non-matching insert yields no delta"
        );
    }

    #[test]
    fn filtered_update_moving_into_and_out_of_the_predicate() {
        let plan = user_filtered_plan();
        let input = input(json!({ "userId": "u-match" }));

        // Was not a member; now matches → Add (moved in).
        let moved_in = delta(compute_live_delta(
            &plan,
            &input,
            &ids(&[]),
            &[change("a", ChangeOp::Update, Some(row("a", "u-match")))],
        ));
        assert_eq!(moved_in[0].kind, LiveDeltaKind::Add);

        // Was a member; now does not match → Remove (moved out).
        let moved_out = delta(compute_live_delta(
            &plan,
            &input,
            &ids(&["a"]),
            &[change(
                "a",
                ChangeOp::Update,
                Some(row("a", "someone-else")),
            )],
        ));
        assert_eq!(
            moved_out,
            vec![LiveDeltaOp {
                kind: LiveDeltaKind::Remove,
                id: "a".to_owned(),
                row: None,
            }]
        );

        // Member, still matches → in-place Update.
        let stayed = delta(compute_live_delta(
            &plan,
            &input,
            &ids(&["a"]),
            &[change("a", ChangeOp::Update, Some(row("a", "u-match")))],
        ));
        assert_eq!(stayed[0].kind, LiveDeltaKind::Update);
    }

    #[test]
    fn delete_of_nonmember_and_change_to_other_table_yield_nothing() {
        let plan = user_filtered_plan();
        let input = input(json!({ "userId": "u-match" }));

        let del_nonmember = delta(compute_live_delta(
            &plan,
            &input,
            &ids(&[]),
            &[change("a", ChangeOp::Delete, None)],
        ));
        assert!(del_nonmember.is_empty());

        let other_table = ChangedRow {
            table: "others".to_owned(),
            id: "x".to_owned(),
            op: ChangeOp::Insert,
            row: Some(json!({ "_id": "x" })),
            changed_fields: Vec::new(),
        };
        let cross = delta(compute_live_delta(&plan, &input, &ids(&[]), &[other_table]));
        assert!(
            cross.is_empty(),
            "a change to another table is not this query's delta"
        );
    }

    #[test]
    fn ordered_or_full_limited_queries_fall_back_to_replace() {
        let input = input(json!({}));
        let mut limited = unfiltered_plan();
        limited.limit = Some(10);

        assert!(matches!(
            compute_live_delta(
                &limited,
                &input,
                &ids(&["existing"]),
                &[change("a", ChangeOp::Insert, Some(row("a", "u1")))]
            ),
            LiveDeltaOutcome::Delta(_)
        ));

        assert_eq!(
            compute_live_delta(
                &limited,
                &input,
                &ids(&["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]),
                &[change("a", ChangeOp::Insert, Some(row("a", "u1")))]
            ),
            LiveDeltaOutcome::Replace
        );

        let mut ordered = unfiltered_plan();
        ordered.order = vec![OrderExpr {
            field: "_createdAt".to_owned(),
            direction: OrderDirection::Asc,
            max_encoded_bytes: None,
        }];
        assert_eq!(
            compute_live_delta(
                &ordered,
                &input,
                &ids(&[]),
                &[change("a", ChangeOp::Insert, Some(row("a", "u1")))]
            ),
            LiveDeltaOutcome::Replace
        );
    }

    // @ref LLP 0056#what-exists-what-this-adds — semi-join queries ride the
    // conservative re-query/`live_replace` lane, never incremental deltas.
    // LLP 0067 §F2a recorded the pair of failures this guard closes: the delta
    // classifier evaluates only ordinary filters (over-delivery to subscribers
    // the membership predicate excludes) and skips membership-table changes
    // (visibility transitions — including revocation — swallowed as zero ops).
    #[test]
    fn membership_gated_queries_fall_back_to_replace() {
        let input = input(json!({}));
        let mut gated = unfiltered_plan();
        gated.membership_filters = vec![MembershipPredicate {
            declaration: "todo_members".to_owned(),
            resource: MembershipResourceRef::RowField("projectId".to_owned()),
            roles: None,
        }];

        // The shape that previously slipped onto the delta lane: unordered,
        // far below the cap, with a main-table change that matches the
        // ordinary filters. Must fall back — classification cannot evaluate
        // the membership predicate.
        assert_eq!(
            compute_live_delta(
                &gated,
                &input,
                &ids(&[]),
                &[change("a", ChangeOp::Insert, Some(row("a", "u1")))]
            ),
            LiveDeltaOutcome::Replace
        );

        // A membership-table-only commit (no main-table rows) previously
        // netted zero ops and settled as `NoChange`, freezing both visibility
        // directions. It must also land on the conservative lane.
        assert_eq!(
            compute_live_delta(
                &gated,
                &input,
                &ids(&["existing"]),
                &[ChangedRow {
                    table: "todo_members".to_owned(),
                    id: "m1".to_owned(),
                    op: ChangeOp::Delete,
                    row: None,
                    changed_fields: Vec::new(),
                }]
            ),
            LiveDeltaOutcome::Replace
        );
    }

    #[test]
    fn table_visibility_membership_changes_replace_on_insert_and_delete() {
        let input = input(json!({}));
        let mut gated = unfiltered_plan();
        gated.table_visibility = Some(crate::manifest::TableVisibilityV1::AnyOf {
            arms: vec![
                crate::manifest::TableVisibilityArmV1::Owner {
                    field: "userId".to_owned(),
                },
                crate::manifest::TableVisibilityArmV1::Membership {
                    declaration: "todo_followers".to_owned(),
                    resource_field: "projectId".to_owned(),
                    roles: Some(vec!["follower".to_owned()]),
                },
            ],
        });

        for op in [ChangeOp::Insert, ChangeOp::Delete] {
            assert_eq!(
                compute_live_delta(
                    &gated,
                    &input,
                    &ids(&["existing"]),
                    &[ChangedRow {
                        table: "todo_followers".to_owned(),
                        id: "follow-1".to_owned(),
                        op,
                        row: None,
                        changed_fields: Vec::new(),
                    }],
                ),
                LiveDeltaOutcome::Replace
            );
        }
    }

    #[test]
    fn a_multi_row_commit_produces_one_op_per_relevant_row() {
        let plan = user_filtered_plan();
        let input = input(json!({ "userId": "u-match" }));
        let outcome = delta(compute_live_delta(
            &plan,
            &input,
            &ids(&["old"]),
            &[
                change("new", ChangeOp::Insert, Some(row("new", "u-match"))),
                change("old", ChangeOp::Delete, None),
                change("other", ChangeOp::Insert, Some(row("other", "nope"))),
            ],
        ));
        assert_eq!(outcome.len(), 2);
        assert_eq!(outcome[0].kind, LiveDeltaKind::Add);
        assert_eq!(outcome[1].kind, LiveDeltaKind::Remove);
    }
}
