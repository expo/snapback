//! Snapshot-pinned evaluator for admitted `graph_query_v1` plans.
//!
//! This module deliberately has no serving dispatch. G2-A exposes the
//! evaluator as an engine primitive so the frozen corpus can execute it; the
//! matcher and serving integration remain later slices.

use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::manifest::{
    AuthInput, FilterExpr, FilterOp, GraphChildPageV1, GraphCompletenessLabelV1,
    GraphCompositionProofV1, GraphDataNodeKindV1, GraphEvaluationCutV1, GraphExistsModeV1,
    GraphIntervalEndV1, GraphLiteralPageV1, GraphMaterializedRefusalReasonV1,
    GraphNodeCompletenessProofClassV1, GraphNodeCompletenessProofV1, GraphNodeKindV1, GraphNodeV1,
    GraphNodeWindowIdentityV1, GraphProjectionLiteralV1, GraphProjectionObjectV1,
    GraphProjectionValueV1, GraphQueryPlanV1, GraphRowKeyV1, GraphToOnePresenceV1,
    GraphWindowIdentityV1, HandlerInput, OrderExpr, QueryPlan, Sha256V1, TableVisibilityV1,
    ValueExpr,
};
use crate::storage::DbRead;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use sha2::{Digest as _, Sha256};
use std::collections::BTreeMap;

/// Authorization inputs already resolved by the engine's authority boundary.
///
/// Class-2 permission-backing predicates are represented as exact allowed
/// values for one declared field. They are lowered into the same kernel query
/// as the node's visibility and data predicates, before ordering and limiting.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphEvaluationAuthorityV1 {
    pub auth: AuthInput,
    #[serde(default)]
    pub permission_values_by_table: BTreeMap<String, GraphPermissionValuesV1>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphPermissionValuesV1 {
    pub field: String,
    pub allowed_values: Vec<Value>,
}

/// One already-validated graph demand at one materialization tuple.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphEvaluationRequestV1 {
    pub args: Value,
    pub windows: Vec<GraphNodeWindowIdentityV1>,
    pub materialization_hash: Sha256V1,
    pub partition_hash: Sha256V1,
    pub authorization_version: crate::storage::AuthorizationVersion,
    pub evaluation_cut: GraphEvaluationCutV1,
    pub authority: GraphEvaluationAuthorityV1,
    #[serde(default)]
    pub prior_window_ledgers: Vec<GraphWindowLedgerV1>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphWindowLedgerV1 {
    pub node_id: String,
    pub pages: u64,
    pub root_rows: u64,
    pub scanned_rows: u64,
    pub result_rows: u64,
    pub result_bytes: u64,
    pub index_ranges: u64,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StructuralWorkV1 {
    pub root_rows_by_node: Vec<GraphObservedNodeWorkV1>,
    pub examined_entries_by_node: Vec<GraphObservedNodeWorkV1>,
    pub relationship_lookups_by_node: Vec<GraphObservedNodeWorkV1>,
    pub max_fanout_by_node: Vec<GraphObservedNodeWorkV1>,
    pub argument_items_by_argument: Vec<GraphObservedArgumentWorkV1>,
    pub argument_items: u64,
    pub argument_expansion_by_node: Vec<GraphObservedNodeWorkV1>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphObservedNodeWorkV1 {
    pub node_id: String,
    pub observed: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphObservedArgumentWorkV1 {
    pub argument_id: String,
    pub observed: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NodeCompletenessV1 {
    pub node_id: String,
    pub node_kind: GraphNodeKindV1,
    pub label: GraphCompletenessLabelV1,
    pub proof_class: GraphNodeCompletenessProofClassV1,
    pub proof: Value,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum GraphCompletenessProofClassV1 {
    Refusal,
    AllComplete,
    OrderedPrefix,
    NamedWindow,
    MixedUnknown,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphCompletenessV1 {
    pub materialization_hash: Sha256V1,
    pub partition_hash: Sha256V1,
    pub authorization_version: crate::storage::AuthorizationVersion,
    pub evaluation_cut: GraphEvaluationCutV1,
    pub label: GraphCompletenessLabelV1,
    pub proof_class: GraphCompletenessProofClassV1,
    pub proof: Value,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphEvaluationOutputV1 {
    pub kind: String,
    pub label: GraphCompletenessLabelV1,
    #[serde(deserialize_with = "deserialize_required_option")]
    pub result_bytes: Option<String>,
    pub ordered_root_ids: Vec<String>,
    pub result_length: u64,
    pub node_completeness: Vec<NodeCompletenessV1>,
    pub graph_completeness: GraphCompletenessV1,
    #[serde(deserialize_with = "deserialize_required_option")]
    pub refusal_reason: Option<GraphMaterializedRefusalReasonV1>,
    pub structural_work: StructuralWorkV1,
    pub window_ledgers: Vec<GraphWindowLedgerV1>,
}

fn deserialize_required_option<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

#[derive(Default)]
struct Work {
    root: BTreeMap<String, u64>,
    examined: BTreeMap<String, u64>,
    lookups: BTreeMap<String, u64>,
    fanout: BTreeMap<String, u64>,
    argument_items: BTreeMap<String, u64>,
    expansion: BTreeMap<String, u64>,
    ranges: BTreeMap<String, u64>,
}

impl Work {
    fn observation(&self) -> StructuralWorkV1 {
        fn nodes(values: &BTreeMap<String, u64>) -> Vec<GraphObservedNodeWorkV1> {
            values
                .iter()
                .map(|(node_id, observed)| GraphObservedNodeWorkV1 {
                    node_id: node_id.clone(),
                    observed: *observed,
                })
                .collect()
        }
        StructuralWorkV1 {
            root_rows_by_node: nodes(&self.root),
            examined_entries_by_node: nodes(&self.examined),
            relationship_lookups_by_node: nodes(&self.lookups),
            max_fanout_by_node: nodes(&self.fanout),
            argument_items_by_argument: self
                .argument_items
                .iter()
                .map(|(argument_id, observed)| GraphObservedArgumentWorkV1 {
                    argument_id: argument_id.clone(),
                    observed: *observed,
                })
                .collect(),
            argument_items: self.argument_items.values().sum(),
            argument_expansion_by_node: nodes(&self.expansion),
        }
    }
}

#[derive(Clone)]
struct RowInstance {
    row: Value,
    key: GraphRowKeyV1,
    root_key: GraphRowKeyV1,
    root_id: String,
}

#[derive(Default)]
struct EvaluationState {
    roots: Vec<RowInstance>,
    by_node: BTreeMap<String, Vec<RowInstance>>,
    children: BTreeMap<(String, String, String), Vec<RowInstance>>,
    exists: BTreeMap<(String, String, String), bool>,
    has_more: BTreeMap<(String, String), bool>,
    continuations: BTreeMap<(String, String), Value>,
    node_proofs: Vec<NodeCompletenessV1>,
    materialized_refusal: Option<GraphMaterializedRefusalReasonV1>,
    work: Work,
}

fn tuple_json(request: &GraphEvaluationRequestV1) -> Value {
    json!({
        "materializationHash": request.materialization_hash,
        "partitionHash": request.partition_hash,
        "authorizationVersion": request.authorization_version,
        "evaluationCut": request.evaluation_cut,
    })
}

fn node_kind(node: &GraphNodeV1) -> GraphNodeKindV1 {
    match node {
        GraphNodeV1::RootWindow { .. } => GraphNodeKindV1::RootWindow,
        GraphNodeV1::EqualityToOne { .. } => GraphNodeKindV1::EqualityToOne,
        GraphNodeV1::BoundedToMany { .. } => GraphNodeKindV1::BoundedToMany,
        GraphNodeV1::ExistsSemiJoin { .. } => GraphNodeKindV1::ExistsSemiJoin,
        GraphNodeV1::PrincipalBound { .. } => GraphNodeKindV1::PrincipalBound,
        GraphNodeV1::SearchMembership { .. } => GraphNodeKindV1::SearchMembership,
        GraphNodeV1::ClosedProjection { .. } => GraphNodeKindV1::ClosedProjection,
    }
}

fn data_node_kind(node: &GraphNodeV1) -> Option<GraphDataNodeKindV1> {
    Some(match node {
        GraphNodeV1::RootWindow { .. } => GraphDataNodeKindV1::RootWindow,
        GraphNodeV1::EqualityToOne { .. } => GraphDataNodeKindV1::EqualityToOne,
        GraphNodeV1::BoundedToMany { .. } => GraphDataNodeKindV1::BoundedToMany,
        GraphNodeV1::ExistsSemiJoin { .. } => GraphDataNodeKindV1::ExistsSemiJoin,
        GraphNodeV1::PrincipalBound { .. } => GraphDataNodeKindV1::PrincipalBound,
        GraphNodeV1::SearchMembership { .. } => GraphDataNodeKindV1::SearchMembership,
        GraphNodeV1::ClosedProjection { .. } => return None,
    })
}

fn application_id(row: &Value) -> SnapbackResult<String> {
    for field in ["id", "sourceIssueID", "_id"] {
        if let Some(value) = row.get(field).and_then(Value::as_str) {
            return Ok(value.to_owned());
        }
    }
    Err(SnapbackError::error(
        "SNAPBACK_STORAGE_VERSION_CORRUPT",
        "storage",
        "graph row has no stable string identity",
    ))
}

fn storage_id(row: &Value) -> SnapbackResult<&str> {
    row.get("_id").and_then(Value::as_str).ok_or_else(|| {
        SnapbackError::error(
            "SNAPBACK_STORAGE_VERSION_CORRUPT",
            "storage",
            "graph row has no storage _id",
        )
    })
}

fn row_key(table: &str, row: &Value) -> SnapbackResult<GraphRowKeyV1> {
    Ok(GraphRowKeyV1 {
        table: table.to_owned(),
        // @ref LLP 0209#4-completeness-vocabulary — GraphRowKeyV1 is a
        // physical storage-row identity, including in child demand and proof
        // parent records; application ids remain projection/output values.
        id: storage_id(row)?.to_owned(),
    })
}

fn input_for(
    plan: &GraphQueryPlanV1,
    request: &GraphEvaluationRequestV1,
) -> SnapbackResult<HandlerInput> {
    let supplied = request.args.as_object().ok_or_else(|| {
        SnapbackError::error(
            "SNAPBACK_GRAPH_ARGUMENT_INVALID",
            "query",
            "graph arguments must be an object",
        )
    })?;
    let mut args = Map::new();
    for argument in &plan.arguments {
        let value = supplied
            .get(&argument.name)
            .or_else(|| supplied.get(&argument.argument_id))
            .cloned()
            .ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_GRAPH_ARGUMENT_INVALID",
                    "query",
                    format!("missing graph argument {}", argument.name),
                )
            })?;
        args.insert(argument.argument_id.clone(), value);
    }
    Ok(HandlerInput {
        args: Value::Object(args),
        auth: request.authority.auth.clone(),
        ..HandlerInput::default()
    })
}

fn authorized_filters(
    table: &str,
    declared: &[FilterExpr],
    request: &GraphEvaluationRequestV1,
) -> Vec<FilterExpr> {
    let mut filters = declared.to_vec();
    if let Some(permission) = request.authority.permission_values_by_table.get(table) {
        filters.push(FilterExpr {
            field: permission.field.clone(),
            op: FilterOp::In,
            value: ValueExpr::Literal(Value::Array(permission.allowed_values.clone())),
        });
    }
    filters
}

fn query_plan(
    table: &str,
    visibility: &TableVisibilityV1,
    filters: Vec<FilterExpr>,
    order: Vec<OrderExpr>,
    limit: usize,
    index: &str,
) -> QueryPlan {
    QueryPlan {
        table: table.to_owned(),
        table_visibility: (!matches!(visibility, TableVisibilityV1::PublicRead))
            .then(|| visibility.clone()),
        filters,
        membership_filters: Vec::new(),
        order,
        limit: Some(limit),
        // `by_id` names the kernel-owned `_id` primary-key access path; user
        // schemas cannot redeclare `_id` as an authored index field.
        indexed_by: (index != "by_id").then(|| index.to_owned()),
    }
}

fn relation_filters(
    parent: &Value,
    join: &[crate::manifest::JoinEquality],
) -> Option<Vec<FilterExpr>> {
    let mut filters = Vec::with_capacity(join.len());
    for equality in join {
        let value = parent
            .get(&equality.root_field)
            .cloned()
            .unwrap_or(Value::Null);
        if value.is_null() {
            return None;
        }
        filters.push(FilterExpr {
            field: equality.joined_field.clone(),
            op: FilterOp::Eq,
            value: ValueExpr::Literal(value),
        });
    }
    Some(filters)
}

fn window_for(
    request: &GraphEvaluationRequestV1,
    node_id: &str,
    parent_key: Option<&GraphRowKeyV1>,
    literal: Option<&GraphLiteralPageV1>,
) -> SnapbackResult<GraphWindowIdentityV1> {
    if let Some(literal) = literal {
        return Ok(GraphWindowIdentityV1 {
            order: Vec::new(),
            direction: literal.direction,
            lower: literal.lower.clone(),
            upper: literal.upper.clone(),
            take: literal.take,
        });
    }
    request
        .windows
        .iter()
        .find(|window| window.node_id == node_id)
        .and_then(|window| {
            window
                .intervals
                .iter()
                .find(|interval| match (&interval.parent_key, parent_key) {
                    (None, None) => true,
                    (Some(left), Some(right)) => left == right,
                    _ => false,
                })
        })
        .map(|interval| interval.window.clone())
        .ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_GRAPH_WINDOW_VECTOR_INVALID",
                "query",
                format!("missing demand interval for graph node {node_id}"),
            )
        })
}

fn unbounded(window: &GraphWindowIdentityV1) -> bool {
    matches!(window.lower, GraphIntervalEndV1::Unbounded)
        && matches!(window.upper, GraphIntervalEndV1::Unbounded)
}

fn keyset_for(row: &Value, order: &[OrderExpr]) -> SnapbackResult<Value> {
    let entries = order
        .iter()
        .map(|order| {
            Ok(Value::Array(vec![
                Value::String(order.field.clone()),
                row.get(&order.field).cloned().unwrap_or(Value::Null),
            ]))
        })
        .collect::<SnapbackResult<Vec<_>>>()?;
    Ok(json!({"entries": entries, "id": storage_id(row)?}))
}

fn insert_child(
    state: &mut EvaluationState,
    parent_node_id: &str,
    parent: &RowInstance,
    child_node_id: &str,
    rows: Vec<RowInstance>,
) -> SnapbackResult<()> {
    state.children.insert(
        (
            parent_node_id.to_owned(),
            storage_id(&parent.row)?.to_owned(),
            child_node_id.to_owned(),
        ),
        rows,
    );
    Ok(())
}

fn children<'a>(
    state: &'a EvaluationState,
    parent_node_id: &str,
    parent: &Value,
    child_node_id: &str,
) -> &'a [RowInstance] {
    let Some(parent_id) = parent.get("_id").and_then(Value::as_str) else {
        return &[];
    };
    state
        .children
        .get(&(
            parent_node_id.to_owned(),
            parent_id.to_owned(),
            child_node_id.to_owned(),
        ))
        .map(Vec::as_slice)
        .unwrap_or(&[])
}

fn proof_entry(
    node_id: &str,
    kind: GraphNodeKindV1,
    label: GraphCompletenessLabelV1,
    proof_class: GraphNodeCompletenessProofClassV1,
    proof: Value,
) -> SnapbackResult<NodeCompletenessV1> {
    serde_json::from_value::<GraphNodeCompletenessProofV1>(proof.clone()).map_err(|error| {
        SnapbackError::error(
            "SNAPBACK_QUERY_COST_EVIDENCE_REQUIRED",
            "query",
            format!("graph node completeness proof is invalid: {error}"),
        )
    })?;
    Ok(NodeCompletenessV1 {
        node_id: node_id.to_owned(),
        node_kind: kind,
        label,
        proof_class,
        proof,
    })
}

fn merge_json(left: Value, right: Value) -> Value {
    let mut object = left.as_object().cloned().unwrap_or_default();
    object.extend(right.as_object().cloned().unwrap_or_default());
    Value::Object(object)
}

fn parent_instances<'a>(state: &'a EvaluationState, node_id: &str) -> &'a [RowInstance] {
    state.by_node.get(node_id).map(Vec::as_slice).unwrap_or(&[])
}

fn sort_parent_proof_rows(rows: &mut [Value]) {
    rows.sort_by_key(|row| {
        snapback_types::rqs_contract::jcs(&row["parentKey"])
            .expect("physical graph parent key canonicalizes")
    });
}

fn evaluate_root(
    read: &DbRead<'_>,
    plan: &GraphQueryPlanV1,
    request: &GraphEvaluationRequestV1,
    input: &HandlerInput,
    state: &mut EvaluationState,
    node: &GraphNodeV1,
) -> SnapbackResult<()> {
    let GraphNodeV1::RootWindow {
        node_id,
        table,
        visibility,
        filters,
        access_index,
        order,
        ..
    } = node
    else {
        unreachable!()
    };
    let window = window_for(request, node_id, None, None)?;
    if window.order != *order {
        return Err(SnapbackError::error(
            "SNAPBACK_GRAPH_WINDOW_VECTOR_INVALID",
            "query",
            "root window order does not equal the admitted node order",
        ));
    }
    let take = usize::try_from(window.take).unwrap_or(usize::MAX);
    let query = query_plan(
        table,
        visibility,
        authorized_filters(table, filters, request),
        order.clone(),
        take,
        access_index,
    );
    let output = read.query_graph_window_with_lookahead(
        &query,
        input,
        window.direction,
        &window.lower,
        &window.upper,
    )?;
    let mut rows = output.rows;
    let has_more = rows.len() > take;
    rows.truncate(take);
    state.work.root.insert(node_id.clone(), rows.len() as u64);
    state
        .work
        .examined
        .insert(node_id.clone(), (rows.len() + usize::from(has_more)) as u64);
    state.work.ranges.insert(node_id.clone(), 1);
    let instances = rows
        .into_iter()
        .map(|row| {
            let key = row_key(table, &row)?;
            Ok(RowInstance {
                root_id: application_id(&row)?,
                root_key: key.clone(),
                key,
                row,
            })
        })
        .collect::<SnapbackResult<Vec<_>>>()?;
    state.roots = instances.clone();
    state.by_node.insert(node_id.clone(), instances);
    state
        .has_more
        .insert((node_id.clone(), String::new()), has_more);
    if has_more {
        let last = state
            .roots
            .last()
            .expect("lookahead implies a consumed root");
        state.continuations.insert(
            (node_id.clone(), String::new()),
            keyset_for(&last.row, order)?,
        );
    }

    let tuple = tuple_json(request);
    let consumed = state.roots.len() as u64;
    let (label, class, evidence) = if has_more && unbounded(&window) {
        (
            GraphCompletenessLabelV1::Prefix,
            GraphNodeCompletenessProofClassV1::OrderedPrefix,
            json!({
                "kind":"root-window", "label":"prefix", "order":order,
                "continuation":state.continuations[&(node_id.clone(), String::new())],
                "stableOrderProof":"declared-order-with-id-tiebreak",
                "take":window.take, "consumed":consumed, "hasMore":true,
            }),
        )
    } else if unbounded(&window) {
        (
            GraphCompletenessLabelV1::Complete,
            GraphNodeCompletenessProofClassV1::WholeSource,
            json!({
                "kind":"root-window", "label":"complete",
                "interval":{"lower":{"kind":"unbounded"},"upper":{"kind":"unbounded"}},
                "consumed":consumed, "hasMore":false, "sourceExhausted":true,
            }),
        )
    } else {
        (
            GraphCompletenessLabelV1::Window,
            GraphNodeCompletenessProofClassV1::NamedWindow,
            json!({
                "kind":"root-window", "label":"window",
                "interval":{"lower":window.lower,"upper":window.upper},
                "take":window.take, "consumed":consumed, "hasMore":false,
            }),
        )
    };
    state.node_proofs.push(proof_entry(
        node_id,
        node_kind(node),
        label,
        class,
        merge_json(tuple, evidence),
    )?);
    let _ = plan;
    Ok(())
}

fn evaluate_to_one(
    read: &DbRead<'_>,
    request: &GraphEvaluationRequestV1,
    input: &HandlerInput,
    state: &mut EvaluationState,
    node: &GraphNodeV1,
) -> SnapbackResult<()> {
    let GraphNodeV1::EqualityToOne {
        node_id,
        parent_node_id,
        table,
        visibility,
        join_on,
        access_index,
        presence,
        filters,
        ..
    } = node
    else {
        unreachable!()
    };
    let parents = parent_instances(state, parent_node_id).to_vec();
    let mut output = Vec::new();
    let mut proof_rows = Vec::new();
    let mut lookups = 0_u64;
    for parent in &parents {
        let Some(mut relation) = relation_filters(&parent.row, join_on) else {
            insert_child(state, parent_node_id, parent, node_id, Vec::new())?;
            proof_rows.push(json!({"parentKey":parent.key,"found":false}));
            if matches!(presence, GraphToOnePresenceV1::Required) {
                // @ref LLP 0209#23-closure-admission-demand-time-evaluation-time-and-qualification-registers —
                // a required-edge point miss is a materialized evaluation-time
                // refusal, never a successful null projection or host error.
                state.materialized_refusal =
                    Some(GraphMaterializedRefusalReasonV1::GraphRequiredEdgeMissing);
                break;
            }
            continue;
        };
        relation.extend(filters.clone().unwrap_or_default());
        lookups += 1;
        let query = query_plan(
            table,
            visibility,
            authorized_filters(table, &relation, request),
            Vec::new(),
            1,
            access_index,
        );
        let rows = read.query(&query, input)?.rows;
        let found = !rows.is_empty();
        if !found && matches!(presence, GraphToOnePresenceV1::Required) {
            // Same register as the null-key path above; both physical miss
            // shapes produce the one additive stable diagnostic.
            state.materialized_refusal =
                Some(GraphMaterializedRefusalReasonV1::GraphRequiredEdgeMissing);
        }
        let children = rows
            .into_iter()
            .map(|row| {
                Ok(RowInstance {
                    key: row_key(table, &row)?,
                    row,
                    root_key: parent.root_key.clone(),
                    root_id: parent.root_id.clone(),
                })
            })
            .collect::<SnapbackResult<Vec<_>>>()?;
        output.extend(children.iter().cloned());
        insert_child(state, parent_node_id, parent, node_id, children)?;
        proof_rows.push(json!({"parentKey":parent.key,"found":found}));
        if state.materialized_refusal.is_some() {
            break;
        }
    }
    state.by_node.insert(node_id.clone(), output);
    state.work.lookups.insert(node_id.clone(), lookups);
    state.work.examined.insert(node_id.clone(), lookups);
    state
        .work
        .fanout
        .insert(node_id.clone(), u64::from(!parents.is_empty()));
    sort_parent_proof_rows(&mut proof_rows);
    let proof = merge_json(
        tuple_json(request),
        json!({"kind":"equality-to-one","label":"complete","rows":proof_rows}),
    );
    state.node_proofs.push(proof_entry(
        node_id,
        node_kind(node),
        GraphCompletenessLabelV1::Complete,
        GraphNodeCompletenessProofClassV1::UniquePoint,
        proof,
    )?);
    Ok(())
}

fn evaluate_to_many(
    read: &DbRead<'_>,
    request: &GraphEvaluationRequestV1,
    input: &HandlerInput,
    state: &mut EvaluationState,
    node: &GraphNodeV1,
) -> SnapbackResult<()> {
    let GraphNodeV1::BoundedToMany {
        node_id,
        parent_node_id,
        table,
        visibility,
        join_on,
        access_index,
        order,
        page,
        filters,
        ..
    } = node
    else {
        unreachable!()
    };
    let parents = parent_instances(state, parent_node_id).to_vec();
    let literal = match page {
        GraphChildPageV1::Literal(value) => Some(value),
        GraphChildPageV1::Demand(_) => None,
    };
    let mut output = Vec::new();
    let mut ranges = Vec::new();
    let mut any_has_more = false;
    let mut any_bounded = false;
    let mut examined = 0_u64;
    for parent in &parents {
        let window = window_for(request, node_id, Some(&parent.key), literal)?;
        let mut effective = window.clone();
        if literal.is_some() {
            effective.order = order.clone();
        }
        if effective.order != *order {
            return Err(SnapbackError::error(
                "SNAPBACK_GRAPH_WINDOW_VECTOR_INVALID",
                "query",
                "child window order does not equal the admitted node order",
            ));
        }
        let cap = usize::try_from(effective.take).unwrap_or(usize::MAX);
        let Some(mut relation) = relation_filters(&parent.row, join_on) else {
            insert_child(state, parent_node_id, parent, node_id, Vec::new())?;
            ranges.push(
                json!({"parentKey":parent.key,"consumed":0,"cap":effective.take,"hasMore":false}),
            );
            continue;
        };
        relation.extend(filters.clone().unwrap_or_default());
        let query = query_plan(
            table,
            visibility,
            authorized_filters(table, &relation, request),
            order.clone(),
            cap,
            access_index,
        );
        let mut rows = read
            .query_graph_window_with_lookahead(
                &query,
                input,
                effective.direction,
                &effective.lower,
                &effective.upper,
            )?
            .rows;
        let has_more = rows.len() > cap;
        examined += rows.len() as u64;
        rows.truncate(cap);
        any_has_more |= has_more;
        any_bounded |= !unbounded(&effective);
        let children = rows
            .into_iter()
            .map(|row| {
                Ok(RowInstance {
                    key: row_key(table, &row)?,
                    row,
                    root_key: parent.root_key.clone(),
                    root_id: parent.root_id.clone(),
                })
            })
            .collect::<SnapbackResult<Vec<_>>>()?;
        state
            .work
            .fanout
            .entry(node_id.clone())
            .and_modify(|value| *value = (*value).max(children.len() as u64))
            .or_insert(children.len() as u64);
        state
            .has_more
            .insert((node_id.clone(), parent.key.id.clone()), has_more);
        let mut range = json!({"parentKey":parent.key,"consumed":children.len(),"cap":effective.take,"hasMore":has_more});
        if has_more && unbounded(&effective) {
            let continuation = keyset_for(
                &children.last().expect("lookahead implies a child").row,
                order,
            )?;
            state.continuations.insert(
                (node_id.clone(), parent.key.id.clone()),
                continuation.clone(),
            );
            range["continuation"] = continuation;
        } else if !unbounded(&effective) {
            range["interval"] = json!({"lower":effective.lower,"upper":effective.upper});
        }
        ranges.push(range);
        output.extend(children.iter().cloned());
        insert_child(state, parent_node_id, parent, node_id, children)?;
    }
    sort_parent_proof_rows(&mut ranges);
    state.by_node.insert(node_id.clone(), output);
    state
        .work
        .lookups
        .insert(node_id.clone(), parents.len() as u64);
    state.work.examined.insert(node_id.clone(), examined);
    state
        .work
        .ranges
        .insert(node_id.clone(), parents.len() as u64);
    let tuple = tuple_json(request);
    let (label, class, evidence) = if any_has_more && !any_bounded {
        (
            GraphCompletenessLabelV1::Prefix,
            GraphNodeCompletenessProofClassV1::OrderedPrefix,
            json!({"kind":"bounded-to-many","label":"prefix","order":order,"stableOrderProof":"declared-order-with-id-tiebreak","ranges":ranges}),
        )
    } else if any_bounded {
        (
            GraphCompletenessLabelV1::Window,
            GraphNodeCompletenessProofClassV1::ParentRanges,
            json!({"kind":"bounded-to-many","label":"window","ranges":ranges}),
        )
    } else {
        (
            GraphCompletenessLabelV1::Complete,
            GraphNodeCompletenessProofClassV1::ParentRanges,
            json!({"kind":"bounded-to-many","label":"complete","ranges":ranges}),
        )
    };
    state.node_proofs.push(proof_entry(
        node_id,
        node_kind(node),
        label,
        class,
        merge_json(tuple, evidence),
    )?);
    Ok(())
}

#[derive(Default)]
struct ProbeObservation {
    found: bool,
    lookups: u64,
    examined: u64,
    fanout: u64,
}

fn direct_probe(
    read: &DbRead<'_>,
    request: &GraphEvaluationRequestV1,
    input: &HandlerInput,
    parent: &Value,
    edge: &crate::manifest::DirectEdgeV1,
    filters: &[FilterExpr],
) -> SnapbackResult<ProbeObservation> {
    let Some(mut relation) = relation_filters(parent, &edge.join_on) else {
        return Ok(ProbeObservation::default());
    };
    relation.extend_from_slice(filters);
    let query = query_plan(
        &edge.table,
        &edge.visibility,
        authorized_filters(&edge.table, &relation, request),
        Vec::new(),
        1,
        &edge.access_index,
    );
    let rows = read.query(&query, input)?.rows;
    Ok(ProbeObservation {
        found: !rows.is_empty(),
        lookups: 1,
        examined: rows.len() as u64,
        fanout: rows.len() as u64,
    })
}

fn through_probe(
    read: &DbRead<'_>,
    request: &GraphEvaluationRequestV1,
    input: &HandlerInput,
    parent: &Value,
    edge: &crate::manifest::ThroughEdgeV1,
    edge_filters: &[FilterExpr],
    edge_cap: usize,
) -> SnapbackResult<ProbeObservation> {
    let Some(mut relation) = relation_filters(parent, &edge.parent_join) else {
        return Ok(ProbeObservation::default());
    };
    // @ref LLP 0209#26-bounds-and-fixture-derivation — a through probe is one
    // filtered edge-range consultation followed by one target point per edge.
    // The G2-A ruling places GraphNode filters on that edge range; predicates
    // on target rows belong to a target node rather than moving across it.
    relation.extend_from_slice(edge_filters);
    let edge_query = query_plan(
        &edge.table,
        &edge.visibility,
        authorized_filters(&edge.table, &relation, request),
        Vec::new(),
        edge_cap,
        &edge.parent_index,
    );
    let edge_rows = read.query(&edge_query, input)?.rows;
    let mut observation = ProbeObservation {
        found: false,
        lookups: 1,
        examined: edge_rows.len() as u64,
        fanout: edge_rows.len() as u64,
    };
    for edge_row in edge_rows {
        let Some(target_filters) = relation_filters(&edge_row, &edge.target_join) else {
            continue;
        };
        observation.lookups += 1;
        let target_query = query_plan(
            &edge.target_table,
            &edge.target_visibility,
            authorized_filters(&edge.target_table, &target_filters, request),
            Vec::new(),
            1,
            &edge.target_index,
        );
        let target = read.query(&target_query, input)?.rows;
        observation.examined += target.len() as u64;
        if !target.is_empty() {
            observation.found = true;
            break;
        }
    }
    Ok(observation)
}

fn projection_references_exists(object: &GraphProjectionObjectV1, node_id: &str) -> bool {
    object.fields.iter().any(|field| match &field.value {
        GraphProjectionValueV1::Exists {
            node_id: projected_node,
        } => projected_node == node_id,
        GraphProjectionValueV1::Object { object, .. }
        | GraphProjectionValueV1::Array { item: object, .. } => {
            projection_references_exists(object, node_id)
        }
        GraphProjectionValueV1::Field { .. } | GraphProjectionValueV1::Literal { .. } => false,
    })
}

fn evaluate_semi_join(
    read: &DbRead<'_>,
    plan: &GraphQueryPlanV1,
    request: &GraphEvaluationRequestV1,
    input: &HandlerInput,
    state: &mut EvaluationState,
    node: &GraphNodeV1,
) -> SnapbackResult<()> {
    let GraphNodeV1::ExistsSemiJoin {
        node_id,
        parent_node_id,
        mode,
        edge,
        filters,
        argument_id,
        ..
    } = node
    else {
        unreachable!()
    };
    let parents = parent_instances(state, parent_node_id).to_vec();
    let base_filters = filters.clone().unwrap_or_default();
    let mut rows = Vec::new();
    let mut lookups = 0_u64;
    let mut examined = 0_u64;
    let mut max_fanout = 0_u64;
    let edge_cap = plan
        .query_cost
        .graph
        .nodes
        .iter()
        .find(|cost| cost.node_id == *node_id)
        .and_then(|cost| cost.max_children_per_parent)
        .and_then(|value| usize::try_from(value).ok())
        .unwrap_or(1);
    let arguments = argument_id
        .as_ref()
        .and_then(|argument_id| input.args.get(argument_id).and_then(Value::as_array))
        .cloned()
        .unwrap_or_default();
    let mut canonical_arguments = BTreeMap::new();
    for value in arguments {
        let key = snapback_types::rqs_contract::jcs(&value).map_err(|_| {
            SnapbackError::error(
                "SNAPBACK_GRAPH_ARGUMENT_INVALID",
                "query",
                "semi-join argument is not canonicalizable",
            )
        })?;
        canonical_arguments.entry(key).or_insert(value);
    }
    if let Some(argument_id) = argument_id {
        state
            .work
            .argument_items
            .insert(argument_id.clone(), canonical_arguments.len() as u64);
        state
            .work
            .expansion
            .insert(node_id.clone(), canonical_arguments.len() as u64);
    }
    for parent in &parents {
        let probes = if matches!(mode, GraphExistsModeV1::All) {
            canonical_arguments.values().cloned().collect::<Vec<_>>()
        } else {
            vec![Value::Null]
        };
        let mut matched = true;
        for argument in probes {
            let mut probe_filters = base_filters.clone();
            if matches!(mode, GraphExistsModeV1::All) {
                for filter in &mut probe_filters {
                    if matches!(filter.op, FilterOp::In) {
                        filter.op = FilterOp::Eq;
                        filter.value = ValueExpr::Literal(argument.clone());
                    }
                }
            }
            let observation = match edge {
                crate::manifest::GraphEdgeV1::Direct(edge) => {
                    direct_probe(read, request, input, &parent.row, edge, &probe_filters)?
                }
                crate::manifest::GraphEdgeV1::Through(edge) => through_probe(
                    read,
                    request,
                    input,
                    &parent.row,
                    edge,
                    &probe_filters,
                    edge_cap,
                )?,
            };
            lookups += observation.lookups;
            examined += observation.examined;
            max_fanout = max_fanout.max(observation.fanout);
            if !observation.found {
                matched = false;
                break;
            }
        }
        state.exists.insert(
            (
                parent_node_id.clone(),
                storage_id(&parent.row)?.to_owned(),
                node_id.clone(),
            ),
            matched,
        );
        rows.push(json!({"parentKey":parent.key,"existenceBit":matched}));
    }
    sort_parent_proof_rows(&mut rows);
    state.work.lookups.insert(node_id.clone(), lookups);
    state.work.examined.insert(node_id.clone(), examined);
    state.work.fanout.insert(node_id.clone(), max_fanout);

    let projected_as_existence = plan.nodes.last().is_some_and(|projection| {
        matches!(projection, GraphNodeV1::ClosedProjection { object, .. } if projection_references_exists(object, node_id))
    });
    if !projected_as_existence {
        let retained = parents
            .iter()
            .filter(|parent| {
                state
                    .exists
                    .get(&(
                        parent_node_id.clone(),
                        storage_id(&parent.row).unwrap_or_default().to_owned(),
                        node_id.clone(),
                    ))
                    .copied()
                    .unwrap_or(false)
            })
            .cloned()
            .collect::<Vec<_>>();
        let retained_keys = retained
            .iter()
            .map(|parent| parent.key.clone())
            .collect::<std::collections::BTreeSet<_>>();
        state
            .by_node
            .insert(parent_node_id.clone(), retained.clone());
        if plan.nodes.first().map(GraphNodeV1::node_id) == Some(parent_node_id.as_str()) {
            state.roots = retained;
        } else {
            for ((_, _, child_node_id), children) in &mut state.children {
                if child_node_id == parent_node_id {
                    children.retain(|child| retained_keys.contains(&child.key));
                }
            }
        }
    }
    let proof = merge_json(
        tuple_json(request),
        json!({"kind":"exists-semi-join","label":"complete","rows":rows}),
    );
    state.node_proofs.push(proof_entry(
        node_id,
        node_kind(node),
        GraphCompletenessLabelV1::Complete,
        GraphNodeCompletenessProofClassV1::CompleteMembership,
        proof,
    )?);
    Ok(())
}

fn evaluate_principal(
    read: &DbRead<'_>,
    request: &GraphEvaluationRequestV1,
    input: &HandlerInput,
    state: &mut EvaluationState,
    node: &GraphNodeV1,
) -> SnapbackResult<()> {
    let GraphNodeV1::PrincipalBound {
        node_id,
        parent_node_id,
        table,
        visibility,
        parent_join,
        principal_field,
        access_index,
        binding,
        filters,
        ..
    } = node
    else {
        unreachable!()
    };
    let parents = parent_instances(state, parent_node_id).to_vec();
    let mut principal = input.auth.user_id.clone();
    let mut binding_found = binding.is_none();
    let mut binding_lookups = 0_u64;
    if let (Some(binding), Some(raw_principal)) = (binding, principal.clone()) {
        binding_lookups = 1;
        let query = query_plan(
            &binding.table,
            &binding.visibility,
            authorized_filters(
                &binding.table,
                &[FilterExpr {
                    field: binding.principal_field.clone(),
                    op: FilterOp::Eq,
                    value: ValueExpr::Literal(Value::String(raw_principal)),
                }],
                request,
            ),
            Vec::new(),
            1,
            &binding.unique_index,
        );
        let row = read.query(&query, input)?.rows.into_iter().next();
        binding_found = row.is_some();
        principal = row.and_then(|row| {
            row.get(&binding.value_field)
                .and_then(Value::as_str)
                .map(str::to_owned)
        });
    }
    let mut output = Vec::new();
    let mut proof_rows = Vec::new();
    let mut target_lookups = 0_u64;
    for parent in &parents {
        let mut found = false;
        let mut children_rows = Vec::new();
        if let (Some(principal), Some(mut relation)) = (
            principal.as_ref(),
            relation_filters(&parent.row, parent_join),
        ) {
            relation.push(FilterExpr {
                field: principal_field.clone(),
                op: FilterOp::Eq,
                value: ValueExpr::Literal(Value::String(principal.clone())),
            });
            relation.extend(filters.clone().unwrap_or_default());
            target_lookups += 1;
            let query = query_plan(
                table,
                visibility,
                authorized_filters(table, &relation, request),
                Vec::new(),
                1,
                access_index,
            );
            let rows = read.query(&query, input)?.rows;
            found = !rows.is_empty();
            children_rows = rows
                .into_iter()
                .map(|row| {
                    Ok(RowInstance {
                        key: row_key(table, &row)?,
                        row,
                        root_key: parent.root_key.clone(),
                        root_id: parent.root_id.clone(),
                    })
                })
                .collect::<SnapbackResult<Vec<_>>>()?;
        }
        output.extend(children_rows.iter().cloned());
        insert_child(state, parent_node_id, parent, node_id, children_rows)?;
        proof_rows
            .push(json!({"parentKey":parent.key,"bindingFound":binding_found,"targetFound":found}));
    }
    sort_parent_proof_rows(&mut proof_rows);
    state.by_node.insert(node_id.clone(), output);
    state
        .work
        .lookups
        .insert(node_id.clone(), binding_lookups + target_lookups);
    state
        .work
        .examined
        .insert(node_id.clone(), binding_lookups + target_lookups);
    state
        .work
        .fanout
        .insert(node_id.clone(), u64::from(!parents.is_empty()));
    let proof = merge_json(
        tuple_json(request),
        json!({"kind":"principal-bound","label":"complete","rows":proof_rows}),
    );
    state.node_proofs.push(proof_entry(
        node_id,
        node_kind(node),
        GraphCompletenessLabelV1::Complete,
        GraphNodeCompletenessProofClassV1::PrincipalPoint,
        proof,
    )?);
    Ok(())
}

fn literal_value(literal: &GraphProjectionLiteralV1) -> Value {
    match literal {
        GraphProjectionLiteralV1::Null(()) => Value::Null,
        GraphProjectionLiteralV1::Boolean(value) => Value::Bool(*value),
        GraphProjectionLiteralV1::String(value) => Value::String(value.clone()),
        GraphProjectionLiteralV1::Number(value) => json!(value),
    }
}

fn project_object(
    object: &GraphProjectionObjectV1,
    state: &EvaluationState,
    scope: &BTreeMap<String, Value>,
) -> SnapbackResult<Value> {
    let mut result = Map::new();
    for field in &object.fields {
        let value = match &field.value {
            GraphProjectionValueV1::Field { node_id, field } => scope
                .get(node_id)
                .and_then(|row| row.get(field))
                .cloned()
                .unwrap_or(Value::Null),
            GraphProjectionValueV1::Literal { value } => literal_value(value),
            GraphProjectionValueV1::Object { node_id, object } => {
                let parent = scope.get(&object.scope_node_id).ok_or_else(|| {
                    SnapbackError::error(
                        "SNAPBACK_GRAPH_PROJECTION_SCOPE_INVALID",
                        "query",
                        "projection object parent scope is absent",
                    )
                })?;
                let child = children(state, &object.scope_node_id, parent, node_id).first();
                if let Some(child) = child {
                    let mut nested = scope.clone();
                    nested.insert(node_id.clone(), child.row.clone());
                    project_object(object, state, &nested)?
                } else {
                    Value::Null
                }
            }
            GraphProjectionValueV1::Array {
                scope_node_id,
                item,
            } => {
                let parent = scope.get(&object.scope_node_id).ok_or_else(|| {
                    SnapbackError::error(
                        "SNAPBACK_GRAPH_PROJECTION_SCOPE_INVALID",
                        "query",
                        "projection array parent scope is absent",
                    )
                })?;
                let mut values = Vec::new();
                for child in children(state, &object.scope_node_id, parent, scope_node_id) {
                    let mut nested = scope.clone();
                    nested.insert(scope_node_id.clone(), child.row.clone());
                    values.push(project_object(item, state, &nested)?);
                }
                Value::Array(values)
            }
            GraphProjectionValueV1::Exists { node_id } => {
                let parent = scope.get(&object.scope_node_id).ok_or_else(|| {
                    SnapbackError::error(
                        "SNAPBACK_GRAPH_PROJECTION_SCOPE_INVALID",
                        "query",
                        "projection exists parent scope is absent",
                    )
                })?;
                Value::Bool(
                    state
                        .exists
                        .get(&(
                            object.scope_node_id.clone(),
                            storage_id(parent)?.to_owned(),
                            node_id.clone(),
                        ))
                        .copied()
                        .unwrap_or(false),
                )
            }
        };
        result.insert(field.name.clone(), value);
    }
    Ok(Value::Object(result))
}

fn proof_hash(value: &Value) -> SnapbackResult<String> {
    let canonical = snapback_types::rqs_contract::jcs(value).map_err(|_| {
        SnapbackError::error(
            "SNAPBACK_QUERY_COST_EVIDENCE_REQUIRED",
            "query",
            "node proof is not canonicalizable",
        )
    })?;
    let mut hasher = Sha256::new();
    hasher.update(b"snapback:graph-node-completeness:v1:");
    hasher.update(canonical.as_bytes());
    Ok(format!("sha256:{:x}", hasher.finalize()))
}

fn composition(
    plan: &GraphQueryPlanV1,
    request: &GraphEvaluationRequestV1,
    proofs: &[NodeCompletenessV1],
    refusal_reason: Option<GraphMaterializedRefusalReasonV1>,
) -> SnapbackResult<(
    GraphCompletenessLabelV1,
    GraphCompletenessProofClassV1,
    Value,
)> {
    let data = plan
        .nodes
        .iter()
        .zip(proofs)
        .filter_map(|(node, proof)| data_node_kind(node).map(|kind| (kind, proof)))
        .collect::<Vec<_>>();
    let labels = data
        .iter()
        .map(|(_, proof)| proof.label)
        .collect::<Vec<_>>();
    let label = if labels.contains(&GraphCompletenessLabelV1::Refused) {
        GraphCompletenessLabelV1::Refused
    } else if labels.contains(&GraphCompletenessLabelV1::Unknown) {
        GraphCompletenessLabelV1::Unknown
    } else if labels
        .iter()
        .all(|label| *label == GraphCompletenessLabelV1::Complete)
    {
        GraphCompletenessLabelV1::Complete
    } else if labels.iter().all(|label| {
        matches!(
            label,
            GraphCompletenessLabelV1::Complete | GraphCompletenessLabelV1::Window
        )
    }) {
        GraphCompletenessLabelV1::Window
    } else if labels.iter().all(|label| {
        matches!(
            label,
            GraphCompletenessLabelV1::Complete | GraphCompletenessLabelV1::Prefix
        )
    }) {
        GraphCompletenessLabelV1::Prefix
    } else {
        GraphCompletenessLabelV1::Unknown
    };
    let nodes = data.iter().map(|(kind, proof)| Ok(json!({
        "nodeId":proof.node_id,
        "nodeKind":kind,
        "label":proof.label,
        "proofHash":proof_hash(&serde_json::to_value(proof).map_err(|error| SnapbackError::error("SNAPBACK_QUERY_COST_EVIDENCE_REQUIRED", "query", error.to_string()))?)?,
    }))).collect::<SnapbackResult<Vec<_>>>()?;
    let partial = data
        .iter()
        .filter(|(_, proof)| proof.label != GraphCompletenessLabelV1::Complete)
        .map(|(_, proof)| proof.node_id.clone())
        .collect::<Vec<_>>();
    let (class, evidence) = match label {
        GraphCompletenessLabelV1::Complete => (
            GraphCompletenessProofClassV1::AllComplete,
            json!({"label":"complete","nodes":nodes,"allComplete":true}),
        ),
        GraphCompletenessLabelV1::Prefix => (
            GraphCompletenessProofClassV1::OrderedPrefix,
            json!({"label":"prefix","nodes":nodes,"partialNodeIds":partial}),
        ),
        GraphCompletenessLabelV1::Window => (
            GraphCompletenessProofClassV1::NamedWindow,
            json!({"label":"window","nodes":nodes,"partialNodeIds":partial}),
        ),
        GraphCompletenessLabelV1::Unknown => (
            GraphCompletenessProofClassV1::MixedUnknown,
            json!({"label":"unknown","nodes":nodes,"reason":"mixed-prefix-window"}),
        ),
        GraphCompletenessLabelV1::Refused => (
            GraphCompletenessProofClassV1::Refusal,
            json!({
                "label":"refused",
                "nodes":nodes,
                "primaryReason":refusal_reason.unwrap_or(
                    GraphMaterializedRefusalReasonV1::QueryCostBoundExceeded
                ),
            }),
        ),
    };
    let proof = merge_json(
        tuple_json(request),
        merge_json(json!({"kind":"graph-composition"}), evidence),
    );
    serde_json::from_value::<GraphCompositionProofV1>(proof.clone()).map_err(|error| {
        SnapbackError::error(
            "SNAPBACK_QUERY_COST_EVIDENCE_REQUIRED",
            "query",
            format!("graph composition proof is invalid: {error}"),
        )
    })?;
    Ok((label, class, proof))
}

fn enforce_execution_bounds(
    plan: &GraphQueryPlanV1,
    state: &EvaluationState,
    result_bytes: usize,
) -> bool {
    if result_bytes as u64 > plan.query_cost.graph.max_page_result_bytes {
        return false;
    }
    for cost in &plan.query_cost.graph.nodes {
        let node = &cost.node_id;
        if state.work.examined.get(node).copied().unwrap_or(0)
            > cost.max_examined_entries_per_execution
            || cost
                .max_relationship_lookups_per_execution
                .is_some_and(|limit| state.work.lookups.get(node).copied().unwrap_or(0) > limit)
            || cost
                .max_children_per_parent
                .is_some_and(|limit| state.work.fanout.get(node).copied().unwrap_or(0) > limit)
            || cost
                .max_argument_expansion
                .is_some_and(|limit| state.work.expansion.get(node).copied().unwrap_or(0) > limit)
        {
            return false;
        }
    }
    true
}

fn ledgers(
    plan: &GraphQueryPlanV1,
    request: &GraphEvaluationRequestV1,
    state: &EvaluationState,
    result_rows: u64,
    result_bytes: u64,
) -> Vec<GraphWindowLedgerV1> {
    let mut ledgers = request
        .prior_window_ledgers
        .iter()
        .map(|ledger| (ledger.node_id.clone(), ledger.clone()))
        .collect::<BTreeMap<_, _>>();
    for cost in &plan.query_cost.graph.nodes {
        if cost.max_window_pages.is_none() {
            continue;
        }
        let ledger = ledgers
            .entry(cost.node_id.clone())
            .or_insert_with(|| GraphWindowLedgerV1 {
                node_id: cost.node_id.clone(),
                ..GraphWindowLedgerV1::default()
            });
        ledger.pages += 1;
        ledger.root_rows += state.work.root.get(&cost.node_id).copied().unwrap_or(0);
        ledger.scanned_rows += state.work.examined.get(&cost.node_id).copied().unwrap_or(0);
        ledger.result_rows += result_rows;
        ledger.result_bytes += result_bytes;
        ledger.index_ranges += state.work.ranges.get(&cost.node_id).copied().unwrap_or(0);
    }
    ledgers.into_values().collect()
}

fn refused_output(
    plan: &GraphQueryPlanV1,
    request: &GraphEvaluationRequestV1,
    state: &EvaluationState,
    reason: GraphMaterializedRefusalReasonV1,
) -> SnapbackResult<GraphEvaluationOutputV1> {
    let mut node_proofs = Vec::new();
    for node in &plan.nodes {
        let evidence = json!({"kind":match node_kind(node) {
            GraphNodeKindV1::RootWindow=>"root-window", GraphNodeKindV1::EqualityToOne=>"equality-to-one",
            GraphNodeKindV1::BoundedToMany=>"bounded-to-many", GraphNodeKindV1::ExistsSemiJoin=>"exists-semi-join",
            GraphNodeKindV1::PrincipalBound=>"principal-bound", GraphNodeKindV1::SearchMembership=>"search-membership",
            GraphNodeKindV1::ClosedProjection=>"closed-projection",
        },"label":"refused","reason":reason});
        if matches!(node, GraphNodeV1::ClosedProjection { .. }) {
            break;
        }
        node_proofs.push(proof_entry(
            node.node_id(),
            node_kind(node),
            GraphCompletenessLabelV1::Refused,
            GraphNodeCompletenessProofClassV1::Refusal,
            merge_json(tuple_json(request), evidence),
        )?);
    }
    let (label, class, proof) = composition(plan, request, &node_proofs, Some(reason))?;
    let graph = GraphCompletenessV1 {
        materialization_hash: request.materialization_hash.clone(),
        partition_hash: request.partition_hash.clone(),
        authorization_version: request.authorization_version.clone(),
        evaluation_cut: request.evaluation_cut,
        label,
        proof_class: class,
        proof,
    };
    Ok(GraphEvaluationOutputV1 {
        kind: "result".to_owned(),
        label: GraphCompletenessLabelV1::Refused,
        result_bytes: None,
        ordered_root_ids: Vec::new(),
        result_length: 0,
        node_completeness: node_proofs,
        graph_completeness: graph,
        refusal_reason: Some(reason),
        structural_work: state.work.observation(),
        window_ledgers: ledgers(plan, request, state, 0, 0),
    })
}

/// Execute one admitted graph plan in one pinned storage snapshot.
///
/// @ref LLP 0209#2-the-graph-ir — closed normalized nodes execute without
/// callbacks or data-dependent graph construction.
/// @ref LLP 0209#23-closure-admission-demand-time-evaluation-time-and-qualification-registers — evaluation-time bound excess becomes
/// the materialized `SNAPBACK_QUERY_COST_BOUND_EXCEEDED` result.
/// @ref LLP 0209#24-plan-instance-and-contextual-materialization-identity — proofs bind the exact
/// materialization, authority partition, authorization version, and cut.
/// @ref LLP 0209#26-bounds-and-fixture-derivation — every range uses lookahead and work
/// is charged by normalized node before any result can be published.
/// @ref LLP 0209#4-completeness-vocabulary — node evidence composes in
/// canonical plan order and citations hash the complete outer node record.
pub(crate) fn evaluate_graph_query_on(
    read: DbRead<'_>,
    plan: &GraphQueryPlanV1,
    request: &GraphEvaluationRequestV1,
) -> SnapbackResult<GraphEvaluationOutputV1> {
    let input = input_for(plan, request)?;
    let mut state = EvaluationState::default();
    for node in &plan.nodes {
        match node {
            GraphNodeV1::RootWindow { .. } => {
                evaluate_root(&read, plan, request, &input, &mut state, node)?
            }
            GraphNodeV1::EqualityToOne { .. } => {
                evaluate_to_one(&read, request, &input, &mut state, node)?;
                if let Some(reason) = state.materialized_refusal {
                    return refused_output(plan, request, &state, reason);
                }
            }
            GraphNodeV1::BoundedToMany { .. } => {
                evaluate_to_many(&read, request, &input, &mut state, node)?
            }
            GraphNodeV1::ExistsSemiJoin { .. } => {
                evaluate_semi_join(&read, plan, request, &input, &mut state, node)?
            }
            GraphNodeV1::PrincipalBound { .. } => {
                evaluate_principal(&read, request, &input, &mut state, node)?
            }
            GraphNodeV1::SearchMembership { .. } => {
                return Err(SnapbackError::error(
                    "SNAPBACK_QUERY_COST_EVIDENCE_REQUIRED",
                    "query",
                    "G2-A has no search provider execution contract",
                ));
            }
            GraphNodeV1::ClosedProjection { .. } => {}
        }
    }
    let projection = plan.nodes.last().ok_or_else(|| {
        SnapbackError::error(
            "SNAPBACK_QUERY_COST_EVIDENCE_REQUIRED",
            "query",
            "graph plan has no projection",
        )
    })?;
    let GraphNodeV1::ClosedProjection {
        node_id, object, ..
    } = projection
    else {
        return Err(SnapbackError::error(
            "SNAPBACK_QUERY_COST_EVIDENCE_REQUIRED",
            "query",
            "graph plan projection is not last",
        ));
    };
    let root_id = plan
        .nodes
        .first()
        .map(GraphNodeV1::node_id)
        .unwrap_or_default();
    let mut rows = Vec::new();
    for root in &state.roots {
        let mut scope = BTreeMap::new();
        scope.insert(root_id.to_owned(), root.row.clone());
        rows.push(project_object(object, &state, &scope)?);
    }
    let result_bytes = serde_json::to_string(&rows).map_err(|error| {
        SnapbackError::error(
            "SNAPBACK_QUERY_COST_EVIDENCE_REQUIRED",
            "query",
            error.to_string(),
        )
    })?;
    if !enforce_execution_bounds(plan, &state, result_bytes.len()) {
        return refused_output(
            plan,
            request,
            &state,
            GraphMaterializedRefusalReasonV1::QueryCostBoundExceeded,
        );
    }
    let (label, class, composition_proof) = composition(plan, request, &state.node_proofs, None)?;
    let projection_proof = merge_json(
        tuple_json(request),
        json!({"kind":"closed-projection","label":label,"composition":composition_proof}),
    );
    state.node_proofs.push(proof_entry(
        node_id,
        node_kind(projection),
        label,
        GraphNodeCompletenessProofClassV1::ProjectionComposition,
        projection_proof,
    )?);
    let graph_completeness = GraphCompletenessV1 {
        materialization_hash: request.materialization_hash.clone(),
        partition_hash: request.partition_hash.clone(),
        authorization_version: request.authorization_version.clone(),
        evaluation_cut: request.evaluation_cut,
        label,
        proof_class: class,
        proof: composition_proof,
    };
    let ordered_root_ids = state
        .roots
        .iter()
        .map(|root| root.root_id.clone())
        .collect::<Vec<_>>();
    let result_length = rows.len() as u64;
    let window_ledgers = ledgers(
        plan,
        request,
        &state,
        result_length,
        result_bytes.len() as u64,
    );
    Ok(GraphEvaluationOutputV1 {
        kind: "result".to_owned(),
        label,
        result_bytes: Some(result_bytes),
        ordered_root_ids,
        result_length,
        node_completeness: state.node_proofs,
        graph_completeness,
        refusal_reason: None,
        structural_work: state.work.observation(),
        window_ledgers,
    })
}
