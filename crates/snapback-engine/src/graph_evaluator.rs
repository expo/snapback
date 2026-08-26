//! Snapshot-pinned evaluator for admitted `graph_query_v1` plans.
//!
//! G2-A introduced the evaluator as an engine primitive. G2-C routes admitted
//! live graph functions through it while retaining the same closed request
//! and capture contracts used by the frozen corpus.

use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::live_wire::{LiveDeltaOpKind, LiveGraphDeltaWireOpV1};
use crate::manifest::{
    AuthInput, FilterExpr, FilterOp, GraphAuthorityClassV1, GraphCapturedDependencyV1,
    GraphCapturedReadAttachmentV1, GraphCapturedReadV1, GraphChildPageV1, GraphCompletenessLabelV1,
    GraphCompositionProofV1, GraphDataNodeKindV1, GraphEdgeV1, GraphEvaluationCutV1,
    GraphEvaluationTimeRefusalReasonV1, GraphExistsModeV1, GraphIntervalEndV1, GraphLiteralPageV1,
    GraphMaterializationIdentityV1, GraphMaterializedRefusalReasonV1,
    GraphNodeCompletenessProofClassV1, GraphNodeCompletenessProofV1, GraphNodeKindV1, GraphNodeV1,
    GraphNodeWindowIdentityV1, GraphParentWindowIdentityV1, GraphProjectionLiteralV1,
    GraphProjectionObjectV1, GraphProjectionValueV1, GraphQueryPlanV1, GraphRowKeyV1,
    GraphToOnePresenceV1, GraphWindowIdentityV1, HandlerInput, KeysetKeyV1, OrderDirection,
    OrderExpr, QueryPlan, Sha256V1, TableVisibilityV1, ValueExpr, graph_instance_identity_v1,
    graph_plan_identity_v1, validate_graph_arguments_v1, validate_graph_window_vector_v1,
};
use crate::storage::{CapturedReadDependency, CapturedReadKind, ChangeOp, ChangedRow, DbRead};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use sha2::{Digest as _, Sha256};
use std::collections::{BTreeMap, BTreeSet};

/// Reserved engine-owned argument carrying the graph demand ladder. It is
/// removed before the application argument contract is validated and is
/// never visible to a handler or a plan expression.
pub const GRAPH_SERVING_DEMAND_ARG: &str = "__snapbackGraphDemandV1";

/// Wire-internal demand carrier for one served graph page. Materialization,
/// partition, authorization version, and evaluation cut are deliberately
/// absent: the serving owner derives them inside the pinned read snapshot.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphServingDemandV1 {
    pub format: String,
    pub windows: Vec<GraphNodeWindowIdentityV1>,
    pub advanced_node_id: String,
    #[serde(default)]
    pub prior_window_ledgers: Vec<GraphWindowLedgerV1>,
    /// Additive DK-3 negotiation. Absent or unknown values keep graph
    /// subscriptions replace-compatible.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delta_format: Option<String>,
}

impl GraphServingDemandV1 {
    pub(crate) fn requests_rung1_delta(&self) -> bool {
        self.delta_format.as_deref() == Some("snapback.graph-live-delta.v1")
    }
}

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
    #[serde(default)]
    pub resolved_membership_inputs: BTreeSet<String>,
    #[serde(default)]
    pub resolved_role_inputs: BTreeSet<String>,
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
    /// The one demand-paged node whose independent ledger lineage this
    /// request advances on continuation. A first-page request charges every
    /// evaluated demand lineage; continuation siblings carry byte-for-byte.
    pub advanced_node_id: String,
    pub materialization_hash: Sha256V1,
    /// Host-recomputed outer identity used to authenticate cumulative
    /// ledgers. This is internal custody, not frozen request/result surface.
    #[serde(skip)]
    pub materialization_identity: Option<GraphMaterializationIdentityV1>,
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
    /// Retained beside the counters in memory and omitted from evaluator and
    /// inspection JSON so existing frozen corpus rows remain byte-identical.
    #[serde(skip)]
    lineage: Option<GraphWindowLedgerLineageV1>,
}

#[derive(Clone, Debug, PartialEq)]
struct GraphWindowLedgerContinuationV1 {
    parent_key: Option<GraphRowKeyV1>,
    key: KeysetKeyV1,
}

#[derive(Clone, Debug, PartialEq)]
/// @ref LLP 0209#24-plan-instance-and-contextual-materialization-identity —
/// cumulative counters ride only in server-retained registration custody,
/// bound to the exact materialization, demand node, and per-parent intervals.
struct GraphWindowLedgerLineageV1 {
    node_id: String,
    materialization_context_hash: Sha256V1,
    plan_hash: Sha256V1,
    args_digest: Sha256V1,
    partition_hash: Sha256V1,
    intervals: Vec<GraphParentWindowIdentityV1>,
    continuations: Vec<GraphWindowLedgerContinuationV1>,
}

#[derive(Clone, Debug, Default, Deserialize, JsonSchema, PartialEq, Serialize)]
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

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphObservedNodeWorkV1 {
    pub node_id: String,
    pub observed: u64,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
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
    /// Physical root keys retained by the serving owner. The serialized G2
    /// evaluator contract keeps its application-id observation unchanged;
    /// graph delta identity never consumes that observation.
    #[serde(skip)]
    pub(crate) ordered_root_keys: Vec<GraphRowKeyV1>,
    pub result_length: u64,
    pub node_completeness: Vec<NodeCompletenessV1>,
    pub graph_completeness: GraphCompletenessV1,
    #[serde(deserialize_with = "deserialize_required_option")]
    pub refusal_reason: Option<GraphMaterializedRefusalReasonV1>,
    pub structural_work: StructuralWorkV1,
    pub window_ledgers: Vec<GraphWindowLedgerV1>,
    /// The shared read-dependency vector a future serving subscription will
    /// register. G2-B exposes it only through the evaluator's existing
    /// test/test-support gate; G2-C still owns serving dispatch.
    #[serde(default)]
    pub captured_reads: Vec<CapturedReadDependency>,
    /// Exact graph-to-ordinary companion attachment over `captured_reads`.
    /// Sync registration attests this evaluator-authored map before the graph
    /// matcher can consume any of the reads.
    #[serde(default)]
    pub capture_attachments: Vec<GraphCapturedReadAttachmentV1>,
    /// Internal full-row provenance for ordinary query companions. These
    /// values cross only the evaluator-to-sync registration seam and are
    /// intentionally omitted from serialized evaluation results/inspection.
    #[serde(skip)]
    pub captured_query_outputs: Vec<crate::live_matcher::GraphCapturedQueryOutputV1>,
    /// Materialized normalized rows retained only by the live serving owner.
    /// It never crosses inspection or wire seams.
    #[serde(skip)]
    pub(crate) retained_state: Option<RetainedEvaluationState>,
}

#[derive(Clone, Default)]
pub(crate) struct RetainedEvaluationState(EvaluationState);

impl std::fmt::Debug for RetainedEvaluationState {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("RetainedEvaluationState(..)")
    }
}

impl PartialEq for RetainedEvaluationState {
    fn eq(&self, _other: &Self) -> bool {
        // This field is intentionally outside the serialized evaluator
        // contract; equality of GraphEvaluationOutputV1 concerns only that
        // public contract.
        true
    }
}

/// Successful rung-1 incremental evaluation. The output has the same result,
/// label, and proof contract as a fresh evaluation at `request`'s tuple;
/// `structural_work` charges only the bounded sub-reads used for this delta.
pub(crate) struct GraphDeltaEvaluationV1 {
    pub output: GraphEvaluationOutputV1,
    pub ops: Vec<LiveGraphDeltaWireOpV1>,
    pub node_proof_updates: Vec<NodeCompletenessV1>,
    pub evaluation_cost: u64,
}

fn deserialize_required_option<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

#[derive(Clone, Default)]
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
    fn absorb(&mut self, other: &Self) {
        fn add(target: &mut BTreeMap<String, u64>, source: &BTreeMap<String, u64>) {
            for (key, value) in source {
                let next = target.get(key).copied().unwrap_or(0).saturating_add(*value);
                target.insert(key.clone(), next);
            }
        }
        add(&mut self.root, &other.root);
        add(&mut self.examined, &other.examined);
        add(&mut self.lookups, &other.lookups);
        add(&mut self.fanout, &other.fanout);
        add(&mut self.ranges, &other.ranges);
    }

    fn prepare(
        &mut self,
        plan: &GraphQueryPlanV1,
        request: &GraphEvaluationRequestV1,
    ) -> SnapbackResult<()> {
        let supplied = request.args.as_object().ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_GRAPH_ARGUMENT_INVALID",
                "query",
                "graph arguments must be an object",
            )
        })?;
        for argument in &plan.arguments {
            let observed = supplied
                .get(&argument.name)
                .map(|value| match value {
                    Value::Array(values) => values.len() as u64,
                    _ => 1,
                })
                .unwrap_or(0);
            self.argument_items
                .insert(argument.argument_id.clone(), observed);
        }
        for cost in &plan.query_cost.graph.nodes {
            self.examined.insert(cost.node_id.clone(), 0);
            if cost.max_root_rows_per_page.is_some() {
                self.root.insert(cost.node_id.clone(), 0);
            }
            if cost.max_relationship_lookups_per_execution.is_some() {
                self.lookups.insert(cost.node_id.clone(), 0);
            }
            if cost.max_children_per_parent.is_some() {
                self.fanout.insert(cost.node_id.clone(), 0);
            }
            if cost.max_argument_expansion.is_some() {
                let node = plan
                    .nodes
                    .iter()
                    .find(|node| node.node_id() == cost.node_id)
                    .expect("admission aligns graph node costs");
                let mut argument_ids = std::collections::BTreeSet::new();
                let filters = match node {
                    GraphNodeV1::RootWindow { filters, .. } => filters.as_slice(),
                    GraphNodeV1::EqualityToOne { filters, .. }
                    | GraphNodeV1::BoundedToMany { filters, .. }
                    | GraphNodeV1::ExistsSemiJoin { filters, .. }
                    | GraphNodeV1::PrincipalBound { filters, .. } => {
                        filters.as_deref().unwrap_or_default()
                    }
                    GraphNodeV1::SearchMembership {
                        argument_ids: search_argument_ids,
                        ..
                    } => {
                        search_argument_ids
                            .iter()
                            .flatten()
                            .for_each(|argument_id| {
                                argument_ids.insert(argument_id.clone());
                            });
                        &[]
                    }
                    GraphNodeV1::ClosedProjection { .. } => &[],
                };
                for filter in filters {
                    if filter.op == FilterOp::In {
                        if let ValueExpr::Arg(argument_id) = &filter.value {
                            argument_ids.insert(argument_id.clone());
                        }
                    }
                }
                let expansion = argument_ids
                    .into_iter()
                    .try_fold(1_u64, |product, id| {
                        product.checked_mul(self.argument_items.get(&id).copied().unwrap_or(0))
                    })
                    .unwrap_or(u64::MAX);
                self.expansion.insert(cost.node_id.clone(), expansion);
            }
        }
        Ok(())
    }

    fn observation(&self, plan: &GraphQueryPlanV1) -> StructuralWorkV1 {
        fn nodes<'a>(
            ids: impl Iterator<Item = &'a str>,
            values: &BTreeMap<String, u64>,
        ) -> Vec<GraphObservedNodeWorkV1> {
            ids.map(|node_id| GraphObservedNodeWorkV1 {
                node_id: node_id.to_owned(),
                observed: values.get(node_id).copied().unwrap_or(0),
            })
            .collect()
        }
        StructuralWorkV1 {
            root_rows_by_node: nodes(
                plan.query_cost.graph.nodes.iter().filter_map(|cost| {
                    cost.max_root_rows_per_page
                        .is_some()
                        .then_some(cost.node_id.as_str())
                }),
                &self.root,
            ),
            examined_entries_by_node: nodes(
                plan.query_cost
                    .graph
                    .nodes
                    .iter()
                    .map(|cost| cost.node_id.as_str()),
                &self.examined,
            ),
            relationship_lookups_by_node: nodes(
                plan.query_cost.graph.nodes.iter().filter_map(|cost| {
                    cost.max_relationship_lookups_per_execution
                        .is_some()
                        .then_some(cost.node_id.as_str())
                }),
                &self.lookups,
            ),
            max_fanout_by_node: nodes(
                plan.query_cost.graph.nodes.iter().filter_map(|cost| {
                    cost.max_children_per_parent
                        .is_some()
                        .then_some(cost.node_id.as_str())
                }),
                &self.fanout,
            ),
            argument_items_by_argument: plan
                .arguments
                .iter()
                .map(|argument| GraphObservedArgumentWorkV1 {
                    argument_id: argument.argument_id.clone(),
                    observed: self
                        .argument_items
                        .get(&argument.argument_id)
                        .copied()
                        .unwrap_or(0),
                })
                .collect(),
            argument_items: plan.arguments.iter().fold(0_u64, |sum, argument| {
                sum.saturating_add(
                    self.argument_items
                        .get(&argument.argument_id)
                        .copied()
                        .unwrap_or(0),
                )
            }),
            argument_expansion_by_node: nodes(
                plan.query_cost.graph.nodes.iter().filter_map(|cost| {
                    cost.max_argument_expansion
                        .is_some()
                        .then_some(cost.node_id.as_str())
                }),
                &self.expansion,
            ),
        }
    }
}

impl StructuralWorkV1 {
    /// Corpus-stable scalar used by D2-H3. Examined index entries and
    /// relationship point lookups are the evaluator work charged by the
    /// existing graph ledger; result bytes remain a separate wire metric.
    pub fn evaluation_cost(&self) -> u64 {
        self.examined_entries_by_node
            .iter()
            .chain(self.relationship_lookups_by_node.iter())
            .fold(0_u64, |sum, row| sum.saturating_add(row.observed))
    }
}

#[derive(Clone)]
struct RowInstance {
    row: Value,
    key: GraphRowKeyV1,
    root_key: GraphRowKeyV1,
}

#[derive(Clone)]
struct GraphCaptureContext {
    graph_plan_hash: Sha256V1,
    instance_hash: Sha256V1,
}

#[derive(Clone, Default)]
pub(crate) struct EvaluationState {
    roots: Vec<RowInstance>,
    by_node: BTreeMap<String, Vec<RowInstance>>,
    children: BTreeMap<(String, String, String), Vec<RowInstance>>,
    exists: BTreeMap<(String, String, String), bool>,
    has_more: BTreeMap<(String, String), bool>,
    continuations: BTreeMap<(String, String), Value>,
    node_proofs: Vec<NodeCompletenessV1>,
    materialized_refusal: Option<GraphMaterializedRefusalReasonV1>,
    capture_context: Option<GraphCaptureContext>,
    captured_reads: Vec<CapturedReadDependency>,
    capture_attachments: Vec<GraphCapturedReadAttachmentV1>,
    captured_query_outputs: Vec<crate::live_matcher::GraphCapturedQueryOutputV1>,
    work: Work,
}

impl EvaluationState {
    fn capture_graph(
        &mut self,
        node: &GraphNodeV1,
        dependency: GraphCapturedDependencyV1,
    ) -> Option<usize> {
        let Some(context) = self.capture_context.as_ref() else {
            return None;
        };
        let graph_read_index = self.captured_reads.len() as u64;
        self.captured_reads.push(CapturedReadDependency {
            kind: CapturedReadKind::GraphNode,
            graph: Some(GraphCapturedReadV1 {
                format: "snapback.graph-captured-read.v1".to_owned(),
                graph_plan_hash: context.graph_plan_hash.clone(),
                instance_hash: context.instance_hash.clone(),
                node_id: node.node_id().to_owned(),
                node_kind: node_kind(node),
                authority_class: node.authority().declared_class,
                dependency,
            }),
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
        });
        self.capture_attachments
            .push(GraphCapturedReadAttachmentV1 {
                graph_read_index,
                ordinary_read_indices: Vec::new(),
            });
        Some(self.capture_attachments.len() - 1)
    }

    fn capture_ordinary(
        &mut self,
        attachment: Option<usize>,
        dependency: CapturedReadDependency,
    ) -> Option<u64> {
        let Some(attachment) = attachment else {
            return None;
        };
        let ordinary_read_index = self.captured_reads.len() as u64;
        self.captured_reads.push(dependency);
        self.capture_attachments[attachment]
            .ordinary_read_indices
            .push(ordinary_read_index);
        Some(ordinary_read_index)
    }

    fn capture_query(
        &mut self,
        attachment: Option<usize>,
        plan: &QueryPlan,
        version: u64,
        rows: &[Value],
    ) -> SnapbackResult<()> {
        if self.capture_context.is_none() {
            return Ok(());
        }
        let (order, limit, result_count, boundary) =
            crate::live_matcher::query_dependency_metadata(plan, rows)?;
        let predicate = serde_json::to_value(plan).map_err(|error| {
            SnapbackError::error(
                "SNAPBACK_CAPTURED_READ_SERIALIZE_FAILED",
                "runtime",
                "graph query dependency could not be serialized",
            )
            .with_details(json!({ "error": error.to_string() }))
        })?;
        let query_read_index = self.capture_ordinary(
            attachment,
            CapturedReadDependency {
                kind: CapturedReadKind::Query,
                graph: None,
                table: Some(plan.table.clone()),
                id: None,
                version: Some(version),
                predicate: Some(predicate),
                rows: rows
                    .iter()
                    .filter_map(|row| row.get("_id").and_then(Value::as_str).map(str::to_owned))
                    .collect(),
                field: None,
                value: None,
                order,
                limit,
                result_count,
                boundary,
            },
        );
        if let Some(query_read_index) = query_read_index {
            self.captured_query_outputs
                .push(crate::live_matcher::GraphCapturedQueryOutputV1 {
                    query_read_index,
                    rows: rows.to_vec(),
                });
        }
        for row in rows {
            let (Some(id), Some(version)) = (
                row.get("_id").and_then(Value::as_str),
                row.get("_version").and_then(Value::as_u64),
            ) else {
                continue;
            };
            self.capture_ordinary(
                attachment,
                CapturedReadDependency {
                    kind: CapturedReadKind::Row,
                    graph: None,
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
                },
            );
        }
        Ok(())
    }

    fn capture_auth_user(&mut self, attachment: Option<usize>, user_id: &str) {
        if self.capture_context.is_none() {
            return;
        }
        self.capture_ordinary(
            attachment,
            CapturedReadDependency {
                kind: CapturedReadKind::Auth,
                graph: None,
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
            },
        );
    }
}

fn captured_value_digest(domain: &[u8], value: &Value) -> SnapbackResult<Sha256V1> {
    let canonical = snapback_types::rqs_contract::jcs(value).map_err(|_| {
        SnapbackError::error(
            "SNAPBACK_GRAPH_ARGUMENT_INVALID",
            "query",
            "captured graph value is not canonicalizable",
        )
    })?;
    let mut hasher = Sha256::new();
    hasher.update(domain);
    hasher.update(canonical.as_bytes());
    Sha256V1::new(format!("sha256:{:x}", hasher.finalize())).map_err(|_| {
        SnapbackError::error(
            "SNAPBACK_QUERY_COST_EVIDENCE_REQUIRED",
            "query",
            "captured graph digest is malformed",
        )
    })
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
            .cloned();
        let Some(value) = value else {
            if !argument.contract.required {
                // @ref LLP 0209#24-plan-instance-and-contextual-materialization-identity —
                // absent optional arguments have observed cardinality zero and
                // remain absent from the normalized handler input.
                continue;
            }
            return Err(SnapbackError::error(
                "SNAPBACK_GRAPH_ARGUMENT_INVALID",
                "query",
                format!("missing graph argument {}", argument.name),
            ));
        };
        args.insert(argument.argument_id.clone(), value);
    }
    Ok(HandlerInput {
        args: Value::Object(args),
        auth: request.authority.auth.clone(),
        ..HandlerInput::default()
    })
}

fn demand_refusal(error: crate::manifest::GraphDemandTimeRefusalReasonV1) -> SnapbackError {
    SnapbackError::error(error.code(), "query", "graph demand validation refused")
}

fn supplied_parent_sets(
    request: &GraphEvaluationRequestV1,
) -> BTreeMap<String, Vec<GraphRowKeyV1>> {
    request
        .windows
        .iter()
        .filter_map(|entry| {
            let parents = entry
                .intervals
                .iter()
                .map(|interval| interval.parent_key.clone())
                .collect::<Option<Vec<_>>>()?;
            Some((entry.node_id.clone(), parents))
        })
        .collect()
}

fn validate_demand(
    plan: &GraphQueryPlanV1,
    request: &GraphEvaluationRequestV1,
    evaluated_parents: &BTreeMap<String, Vec<GraphRowKeyV1>>,
) -> SnapbackResult<()> {
    validate_graph_arguments_v1(plan, &request.args).map_err(demand_refusal)?;
    validate_graph_window_vector_v1(plan, &request.windows, evaluated_parents)
        .map_err(demand_refusal)
}

fn validate_child_demand(
    plan: &GraphQueryPlanV1,
    request: &GraphEvaluationRequestV1,
    state: &EvaluationState,
    node: &GraphNodeV1,
) -> SnapbackResult<()> {
    if !matches!(
        node,
        GraphNodeV1::BoundedToMany {
            page: GraphChildPageV1::Demand(_),
            ..
        }
    ) {
        return Ok(());
    }
    let mut parents = supplied_parent_sets(request);
    let parent_node_id = node.parent_node_id().ok_or_else(|| {
        SnapbackError::error(
            "SNAPBACK_GRAPH_WINDOW_VECTOR_INVALID",
            "query",
            "demand-paged child has no parent",
        )
    })?;
    parents.insert(
        node.node_id().to_owned(),
        parent_instances(state, parent_node_id)
            .iter()
            .map(|parent| parent.key.clone())
            .collect(),
    );
    validate_demand(plan, request, &parents)
}

fn class_two_context_is_complete(
    plan: &GraphQueryPlanV1,
    request: &GraphEvaluationRequestV1,
) -> bool {
    plan.nodes.iter().all(|node| {
        if node.authority().declared_class != GraphAuthorityClassV1::PARTITION_SCOPED
            || matches!(node, GraphNodeV1::ClosedProjection { .. })
        {
            return true;
        }
        let Some(proof) = node.authority().proof.as_ref() else {
            return false;
        };
        if proof.policy_inputs.iter().any(|input| match input.kind {
            crate::manifest::GraphPolicyInputKindV1::PermissionBacking => !request
                .authority
                .permission_values_by_table
                .contains_key(&input.declaration_id),
            crate::manifest::GraphPolicyInputKindV1::Membership => !request
                .authority
                .resolved_membership_inputs
                .contains(&input.declaration_id),
            crate::manifest::GraphPolicyInputKindV1::Role => !request
                .authority
                .resolved_role_inputs
                .contains(&input.declaration_id),
        }) {
            return false;
        }
        let permission_backings = proof
            .policy_inputs
            .iter()
            .filter(|input| {
                matches!(
                    input.kind,
                    crate::manifest::GraphPolicyInputKindV1::PermissionBacking
                )
            })
            .collect::<Vec<_>>();
        let reads = match node {
            GraphNodeV1::RootWindow {
                table, visibility, ..
            }
            | GraphNodeV1::EqualityToOne {
                table, visibility, ..
            }
            | GraphNodeV1::BoundedToMany {
                table, visibility, ..
            }
            | GraphNodeV1::PrincipalBound {
                table, visibility, ..
            } => vec![(table, visibility)],
            GraphNodeV1::ExistsSemiJoin { edge, .. } => match edge {
                crate::manifest::GraphEdgeV1::Direct(edge) => {
                    vec![(&edge.table, &edge.visibility)]
                }
                crate::manifest::GraphEdgeV1::Through(edge) => vec![
                    (&edge.table, &edge.visibility),
                    (&edge.target_table, &edge.target_visibility),
                ],
            },
            GraphNodeV1::SearchMembership { .. } | GraphNodeV1::ClosedProjection { .. } => {
                Vec::new()
            }
        };
        reads.iter().all(|(table, visibility)| {
            !permission_backings
                .iter()
                .any(|input| input.declaration_id == **table)
                || matches!(visibility, TableVisibilityV1::PublicRead)
        })
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
            "SNAPBACK_GRAPH_DEMAND_IDENTITY_MISMATCH",
            "query",
            "root window order does not equal the admitted node order",
        ));
    }
    let take = usize::try_from(window.take).unwrap_or(usize::MAX);
    if take == 0 {
        state.work.root.insert(node_id.clone(), 0);
        state.work.examined.insert(node_id.clone(), 0);
        state.work.ranges.insert(node_id.clone(), 0);
        state.roots.clear();
        state.by_node.insert(node_id.clone(), Vec::new());
        state.node_proofs.push(proof_entry(
            node_id,
            node_kind(node),
            GraphCompletenessLabelV1::Unknown,
            GraphNodeCompletenessProofClassV1::None,
            merge_json(
                tuple_json(request),
                json!({
                    "kind":"root-window", "label":"unknown",
                    "reason":"zero-take-unproved",
                }),
            ),
        )?);
        return Ok(());
    }
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
    let snapshot_version = output.version;
    let mut rows = output.rows;
    let has_more = rows.len() > take;
    rows.truncate(take);
    let boundary = if has_more {
        rows.last()
            .map(|row| keyset_for(row, order))
            .transpose()?
            .map(|value| {
                serde_json::from_value(value).map_err(|error| {
                    SnapbackError::error(
                        "SNAPBACK_QUERY_COST_EVIDENCE_REQUIRED",
                        "query",
                        format!("graph root capture boundary is invalid: {error}"),
                    )
                })
            })
            .transpose()?
    } else {
        None
    };
    // @ref LLP 0209#51-captured-vocabulary-by-normalized-node — root
    // windows register both their graph identity/boundary fact and the shared
    // Query/Row dependencies used by the existing disjointness machinery.
    let attachment = state.capture_graph(
        node,
        GraphCapturedDependencyV1::RootRange {
            table: table.clone(),
            index: access_index.clone(),
            predicate: filters.clone(),
            order: order.clone(),
            direction: Some(window.direction),
            lower: Some(window.lower.clone()),
            upper: Some(window.upper.clone()),
            limit: window.take,
            result_count: rows.len() as u64,
            boundary,
            complete: !has_more,
        },
    );
    state.capture_query(attachment, &query, snapshot_version, &rows)?;
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
    let (label, class, evidence) = if has_more {
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
    let mut consultations = 0_u64;
    let mut examined = 0_u64;
    for parent in &parents {
        lookups += 1;
        let lookup_key = join_on
            .iter()
            .map(|equality| {
                parent
                    .row
                    .get(&equality.root_field)
                    .cloned()
                    .unwrap_or(Value::Null)
            })
            .collect::<Vec<_>>();
        let Some(mut relation) = relation_filters(&parent.row, join_on) else {
            let _ = state.capture_graph(
                node,
                GraphCapturedDependencyV1::ParentLookupSkipped {
                    table: table.clone(),
                    index: access_index.clone(),
                    parent_key: parent.key.clone(),
                    reason: crate::manifest::GraphParentLookupSkippedReasonV1::NullOrOmittedKey,
                },
            );
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
        consultations += 1;
        let query = query_plan(
            table,
            visibility,
            authorized_filters(table, &relation, request),
            Vec::new(),
            1,
            access_index,
        );
        let query_output = read.query(&query, input)?;
        let snapshot_version = query_output.version;
        let rows = query_output.rows;
        examined += rows.len() as u64;
        let found = !rows.is_empty();
        let child_key = rows.first().map(|row| row_key(table, row)).transpose()?;
        let row_version = rows
            .first()
            .and_then(|row| row.get("_version"))
            .and_then(Value::as_u64);
        let attachment = state.capture_graph(
            node,
            GraphCapturedDependencyV1::ParentPoint {
                table: table.clone(),
                index: access_index.clone(),
                parent_key: parent.key.clone(),
                lookup_key,
                child_key,
                found,
                row_version,
            },
        );
        state.capture_query(attachment, &query, snapshot_version, &rows)?;
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
    state.work.examined.insert(node_id.clone(), examined);
    state.work.ranges.insert(node_id.clone(), consultations);
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
    #[derive(Clone, Copy, Eq, PartialEq)]
    enum ParentRangeClass {
        Complete,
        Window,
        Prefix,
    }
    #[derive(Clone, Copy)]
    enum ParentRangeComposition {
        Complete,
        Window,
        Prefix,
        Mixed,
    }
    let mut output = Vec::new();
    let mut facts = Vec::new();
    let mut zero_take_unproved = false;
    let mut examined = 0_u64;
    let mut consultations = 0_u64;
    for parent in &parents {
        let window = window_for(request, node_id, Some(&parent.key), literal)?;
        let mut effective = window.clone();
        if literal.is_some() {
            effective.order = order.clone();
        }
        if effective.order != *order {
            return Err(SnapbackError::error(
                "SNAPBACK_GRAPH_DEMAND_IDENTITY_MISMATCH",
                "query",
                "child window order does not equal the admitted node order",
            ));
        }
        let cap = usize::try_from(effective.take).unwrap_or(usize::MAX);
        if cap == 0 {
            // A zero-take range supplies no exhaustion fact and never mints a
            // zero-progress continuation. Other parents may still contribute
            // useful rows, but this node's only honest proof is unknown.
            zero_take_unproved = true;
            insert_child(state, parent_node_id, parent, node_id, Vec::new())?;
            continue;
        }
        let Some(mut relation) = relation_filters(&parent.row, join_on) else {
            let _ = state.capture_graph(
                node,
                GraphCapturedDependencyV1::ParentRange {
                    table: table.clone(),
                    index: access_index.clone(),
                    parent_key: parent.key.clone(),
                    predicate: filters.clone().unwrap_or_default(),
                    order: order.clone(),
                    direction: Some(effective.direction),
                    lower: Some(effective.lower.clone()),
                    upper: Some(effective.upper.clone()),
                    limit: effective.take,
                    result_count: 0,
                    boundary: None,
                    // The v1 carrier has no storage-free nullable to-many
                    // attempt arm. Mark the range incomplete so matching can
                    // never turn this representational gap into a false skip.
                    complete: false,
                },
            );
            insert_child(state, parent_node_id, parent, node_id, Vec::new())?;
            let class = if unbounded(&effective) {
                ParentRangeClass::Complete
            } else {
                ParentRangeClass::Window
            };
            facts.push((
                class,
                json!({"parentKey":parent.key,"consumed":0,"cap":effective.take,"hasMore":false}),
                json!({
                    "parentKey":parent.key,
                    "interval":{"lower":effective.lower,"upper":effective.upper},
                    "consumed":0,"cap":effective.take,"hasMore":false
                }),
                None,
            ));
            continue;
        };
        consultations += 1;
        relation.extend(filters.clone().unwrap_or_default());
        let query = query_plan(
            table,
            visibility,
            authorized_filters(table, &relation, request),
            order.clone(),
            cap,
            access_index,
        );
        let query_output = read.query_graph_window_with_lookahead(
            &query,
            input,
            effective.direction,
            &effective.lower,
            &effective.upper,
        )?;
        let snapshot_version = query_output.version;
        let mut rows = query_output.rows;
        let has_more = rows.len() > cap;
        examined += rows.len() as u64;
        rows.truncate(cap);
        let boundary = if has_more {
            rows.last()
                .map(|row| keyset_for(row, order))
                .transpose()?
                .map(|value| {
                    serde_json::from_value(value).map_err(|error| {
                        SnapbackError::error(
                            "SNAPBACK_QUERY_COST_EVIDENCE_REQUIRED",
                            "query",
                            format!("graph parent capture boundary is invalid: {error}"),
                        )
                    })
                })
                .transpose()?
        } else {
            None
        };
        let attachment = state.capture_graph(
            node,
            GraphCapturedDependencyV1::ParentRange {
                table: table.clone(),
                index: access_index.clone(),
                parent_key: parent.key.clone(),
                predicate: filters.clone().unwrap_or_default(),
                order: order.clone(),
                direction: Some(effective.direction),
                lower: Some(effective.lower.clone()),
                upper: Some(effective.upper.clone()),
                limit: effective.take,
                result_count: rows.len() as u64,
                boundary,
                complete: !has_more,
            },
        );
        state.capture_query(attachment, &query, snapshot_version, &rows)?;
        let children = rows
            .into_iter()
            .map(|row| {
                Ok(RowInstance {
                    key: row_key(table, &row)?,
                    row,
                    root_key: parent.root_key.clone(),
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
        let complete_range = json!({
            "parentKey":parent.key,"consumed":children.len(),
            "cap":effective.take,"hasMore":false
        });
        let window_range = json!({
            "parentKey":parent.key,
            "interval":{"lower":effective.lower,"upper":effective.upper},
            "consumed":children.len(),"cap":effective.take,"hasMore":has_more
        });
        let mut prefix_range = None;
        let class = if has_more && unbounded(&effective) {
            let continuation = keyset_for(
                &children.last().expect("lookahead implies a child").row,
                order,
            )?;
            state.continuations.insert(
                (node_id.clone(), parent.key.id.clone()),
                continuation.clone(),
            );
            prefix_range = Some(json!({
                "parentKey":parent.key,"consumed":children.len(),
                "cap":effective.take,"hasMore":true,"continuation":continuation
            }));
            ParentRangeClass::Prefix
        } else if unbounded(&effective) {
            ParentRangeClass::Complete
        } else {
            ParentRangeClass::Window
        };
        facts.push((class, complete_range, window_range, prefix_range));
        output.extend(children.iter().cloned());
        insert_child(state, parent_node_id, parent, node_id, children)?;
    }
    state.by_node.insert(node_id.clone(), output);
    state
        .work
        .lookups
        .insert(node_id.clone(), parents.len() as u64);
    state.work.examined.insert(node_id.clone(), examined);
    state.work.ranges.insert(node_id.clone(), consultations);
    let tuple = tuple_json(request);
    let composition = facts.iter().fold(
        ParentRangeComposition::Complete,
        |composition, (parent, ..)| match (composition, parent) {
            (value, ParentRangeClass::Complete) => value,
            (
                ParentRangeComposition::Complete | ParentRangeComposition::Window,
                ParentRangeClass::Window,
            ) => ParentRangeComposition::Window,
            (
                ParentRangeComposition::Complete | ParentRangeComposition::Prefix,
                ParentRangeClass::Prefix,
            ) => ParentRangeComposition::Prefix,
            _ => ParentRangeComposition::Mixed,
        },
    );
    let (label, class, evidence) = if zero_take_unproved {
        (
            GraphCompletenessLabelV1::Unknown,
            GraphNodeCompletenessProofClassV1::None,
            json!({"kind":"bounded-to-many","label":"unknown","reason":"zero-take-unproved"}),
        )
    } else {
        match composition {
            ParentRangeComposition::Complete => {
                let mut ranges = facts
                    .iter()
                    .map(|(_, complete, _, _)| complete.clone())
                    .collect::<Vec<_>>();
                sort_parent_proof_rows(&mut ranges);
                (
                    GraphCompletenessLabelV1::Complete,
                    GraphNodeCompletenessProofClassV1::ParentRanges,
                    json!({"kind":"bounded-to-many","label":"complete","ranges":ranges}),
                )
            }
            ParentRangeComposition::Window => {
                let mut ranges = facts
                    .iter()
                    .map(|(_, _, window, _)| window.clone())
                    .collect::<Vec<_>>();
                sort_parent_proof_rows(&mut ranges);
                (
                    GraphCompletenessLabelV1::Window,
                    GraphNodeCompletenessProofClassV1::ParentRanges,
                    json!({"kind":"bounded-to-many","label":"window","ranges":ranges}),
                )
            }
            ParentRangeComposition::Prefix
                if facts
                    .iter()
                    .all(|(parent, ..)| *parent == ParentRangeClass::Prefix) =>
            {
                let mut ranges = facts
                    .iter()
                    .filter_map(|(_, _, _, prefix)| prefix.clone())
                    .collect::<Vec<_>>();
                sort_parent_proof_rows(&mut ranges);
                (
                    GraphCompletenessLabelV1::Prefix,
                    GraphNodeCompletenessProofClassV1::OrderedPrefix,
                    json!({"kind":"bounded-to-many","label":"prefix","order":order,"stableOrderProof":"declared-order-with-id-tiebreak","ranges":ranges}),
                )
            }
            ParentRangeComposition::Prefix => (
                GraphCompletenessLabelV1::Unknown,
                GraphNodeCompletenessProofClassV1::None,
                json!({"kind":"bounded-to-many","label":"unknown","reason":"parent-range-unproved"}),
            ),
            ParentRangeComposition::Mixed => (
                GraphCompletenessLabelV1::Unknown,
                GraphNodeCompletenessProofClassV1::None,
                json!({"kind":"bounded-to-many","label":"unknown","reason":"mixed-prefix-window"}),
            ),
        }
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

struct QueryCapture {
    plan: QueryPlan,
    version: u64,
    rows: Vec<Value>,
}

#[derive(Default)]
struct ProbeObservation {
    found: bool,
    undecidable_over_cap: bool,
    lookups: u64,
    ranges: u64,
    examined: u64,
    fanout: u64,
    captures: Vec<QueryCapture>,
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
        return Ok(ProbeObservation {
            lookups: 1,
            ..ProbeObservation::default()
        });
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
    let output = read.query(&query, input)?;
    let rows = output.rows;
    Ok(ProbeObservation {
        found: !rows.is_empty(),
        undecidable_over_cap: false,
        lookups: 1,
        ranges: 1,
        examined: rows.len() as u64,
        fanout: rows.len() as u64,
        captures: vec![QueryCapture {
            plan: query,
            version: output.version,
            rows,
        }],
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
        return Ok(ProbeObservation {
            lookups: 1,
            ..ProbeObservation::default()
        });
    };
    // @ref LLP 0209#26-bounds-and-fixture-derivation — a through probe is one
    // filtered edge-range consultation followed by one target point per edge.
    // The G2-A ruling places GraphNode filters on that edge range; predicates
    // on target rows belong to a target node rather than moving across it.
    relation.extend_from_slice(edge_filters);
    let edge_order = read
        .schema()
        .tables
        .iter()
        .find(|table| table.name == edge.table)
        .and_then(|table| {
            table
                .indexes
                .iter()
                .find(|index| index.name == edge.parent_index)
        })
        .map(|index| {
            index
                .fields
                .iter()
                .filter(|field| field.as_str() != "_id")
                .map(|field| OrderExpr {
                    field: field.clone(),
                    direction: OrderDirection::Asc,
                    max_encoded_bytes: None,
                })
                .collect::<Vec<_>>()
        })
        .ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_QUERY_COST_INDEX_REQUIRED",
                "query",
                "through-edge parent index is absent from the pinned schema",
            )
        })?;
    let edge_query = query_plan(
        &edge.table,
        &edge.visibility,
        authorized_filters(&edge.table, &relation, request),
        edge_order,
        edge_cap,
        &edge.parent_index,
    );
    let edge_output = read.query_graph_window_with_lookahead(
        &edge_query,
        input,
        crate::manifest::GraphDirectionV1::Forward,
        &GraphIntervalEndV1::Unbounded,
        &GraphIntervalEndV1::Unbounded,
    )?;
    let mut edge_rows = edge_output.rows;
    let has_more = edge_rows.len() > edge_cap;
    let examined_edge_rows = edge_rows.len() as u64;
    edge_rows.truncate(edge_cap);
    let captured_edge_rows = edge_rows.clone();
    let mut observation = ProbeObservation {
        found: false,
        lookups: 1,
        ranges: 1,
        examined: examined_edge_rows,
        fanout: edge_rows.len() as u64,
        undecidable_over_cap: false,
        captures: vec![QueryCapture {
            plan: edge_query,
            version: edge_output.version,
            rows: captured_edge_rows,
        }],
    };
    for edge_row in edge_rows {
        let Some(target_filters) = relation_filters(&edge_row, &edge.target_join) else {
            continue;
        };
        observation.lookups += 1;
        observation.ranges += 1;
        let target_query = query_plan(
            &edge.target_table,
            &edge.target_visibility,
            authorized_filters(&edge.target_table, &target_filters, request),
            Vec::new(),
            1,
            &edge.target_index,
        );
        let target_output = read.query(&target_query, input)?;
        let target = target_output.rows;
        observation.examined += target.len() as u64;
        observation.captures.push(QueryCapture {
            plan: target_query,
            version: target_output.version,
            rows: target.clone(),
        });
        if !target.is_empty() {
            observation.found = true;
            break;
        }
    }
    observation.undecidable_over_cap = !observation.found && has_more;
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
    let mut consultations = 0_u64;
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
    let (dependency_tables, dependency_indexes) = match edge {
        crate::manifest::GraphEdgeV1::Direct(edge) => {
            (vec![edge.table.clone()], vec![edge.access_index.clone()])
        }
        crate::manifest::GraphEdgeV1::Through(edge) => (
            vec![edge.table.clone(), edge.target_table.clone()],
            vec![edge.parent_index.clone(), edge.target_index.clone()],
        ),
    };
    let argument_digest = argument_id
        .as_ref()
        .map(|argument_id| {
            let value = input.args.get(argument_id).cloned().unwrap_or(Value::Null);
            captured_value_digest(b"snapback:g0-corpus-argument:v1:", &value)
        })
        .transpose()?;
    for parent in &parents {
        let probes = if matches!(mode, GraphExistsModeV1::All) {
            canonical_arguments.values().cloned().collect::<Vec<_>>()
        } else {
            vec![Value::Null]
        };
        let mut matched = true;
        let mut matched_count = 0_u64;
        let mut captured_queries = Vec::new();
        for argument in probes {
            let mut probe_filters = base_filters.clone();
            if matches!(mode, GraphExistsModeV1::All) {
                bind_declared_all_probe(&mut probe_filters, argument_id.as_deref(), &argument);
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
            consultations += observation.ranges;
            examined += observation.examined;
            max_fanout = max_fanout.max(observation.fanout);
            captured_queries.extend(observation.captures);
            if observation.undecidable_over_cap {
                state.materialized_refusal =
                    Some(GraphMaterializedRefusalReasonV1::QueryCostBoundExceeded);
                break;
            }
            if !observation.found {
                matched = false;
                break;
            }
            matched_count += 1;
        }
        let attachment = state.capture_graph(
            node,
            GraphCapturedDependencyV1::Membership {
                tables: dependency_tables.clone(),
                indexes: dependency_indexes.clone(),
                parent_key: parent.key.clone(),
                argument_id: argument_id.clone(),
                argument_digest: argument_digest.clone(),
                matched_count,
                complete: state.materialized_refusal.is_none(),
            },
        );
        for capture in captured_queries {
            state.capture_query(attachment, &capture.plan, capture.version, &capture.rows)?;
        }
        if state.materialized_refusal.is_some() {
            break;
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
    state.work.ranges.insert(node_id.clone(), consultations);

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

fn bind_declared_all_probe(filters: &mut [FilterExpr], argument_id: Option<&str>, value: &Value) {
    let Some(argument_id) = argument_id else {
        return;
    };
    for filter in filters {
        if filter.op == FilterOp::In
            && matches!(&filter.value, ValueExpr::Arg(bound) if bound == argument_id)
        {
            filter.op = FilterOp::Eq;
            filter.value = ValueExpr::Literal(value.clone());
        }
    }
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
    let auth_user = principal.clone();
    let mut auth_attached = false;
    let mut binding_found = binding.is_none();
    let binding_lookups = u64::from(binding.is_some());
    let mut binding_consultations = 0_u64;
    let mut examined = 0_u64;
    if let (Some(binding), Some(raw_principal)) = (binding, principal.clone()) {
        binding_consultations = 1;
        let query = query_plan(
            &binding.table,
            &binding.visibility,
            authorized_filters(
                &binding.table,
                &[FilterExpr {
                    field: binding.principal_field.clone(),
                    op: FilterOp::Eq,
                    value: ValueExpr::Literal(Value::String(raw_principal.clone())),
                }],
                request,
            ),
            Vec::new(),
            1,
            &binding.unique_index,
        );
        let query_output = read.query(&query, input)?;
        let binding_rows = query_output.rows;
        let row = binding_rows.first().cloned();
        examined += u64::from(row.is_some());
        binding_found = row.is_some();
        let attachment = state.capture_graph(
            node,
            GraphCapturedDependencyV1::PrincipalField {
                table: binding.table.clone(),
                index: binding.unique_index.clone(),
                parent_key: None,
                partition_hash: request.partition_hash.clone(),
                field: binding.principal_field.clone(),
                value_digest: captured_value_digest(
                    b"snapback:g0-corpus-principal-value:v1:",
                    &Value::String(raw_principal),
                )?,
                found: binding_found,
            },
        );
        if let Some(user_id) = auth_user.as_deref() {
            state.capture_auth_user(attachment, user_id);
            auth_attached = true;
        }
        let resolved_value = row
            .as_ref()
            .and_then(|row| row.get(&binding.value_field))
            .cloned();
        if let Some(value) = resolved_value.as_ref() {
            let _ = state.capture_graph(
                node,
                GraphCapturedDependencyV1::PrincipalField {
                    table: binding.table.clone(),
                    index: binding.unique_index.clone(),
                    parent_key: None,
                    partition_hash: request.partition_hash.clone(),
                    field: binding.value_field.clone(),
                    value_digest: captured_value_digest(
                        b"snapback:g0-corpus-principal-value:v1:",
                        value,
                    )?,
                    found: binding_found,
                },
            );
        }
        state.capture_query(attachment, &query, query_output.version, &binding_rows)?;
        principal = row.and_then(|row| {
            row.get(&binding.value_field)
                .and_then(Value::as_str)
                .map(str::to_owned)
        });
    }
    let mut output = Vec::new();
    let mut proof_rows = Vec::new();
    let target_lookups = parents.len() as u64;
    let mut target_consultations = 0_u64;
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
            target_consultations += 1;
            let query = query_plan(
                table,
                visibility,
                authorized_filters(table, &relation, request),
                Vec::new(),
                1,
                access_index,
            );
            let query_output = read.query(&query, input)?;
            let rows = query_output.rows;
            examined += rows.len() as u64;
            found = !rows.is_empty();
            let attachment = state.capture_graph(
                node,
                GraphCapturedDependencyV1::PrincipalField {
                    table: table.clone(),
                    index: access_index.clone(),
                    parent_key: Some(parent.key.clone()),
                    partition_hash: request.partition_hash.clone(),
                    field: principal_field.clone(),
                    value_digest: captured_value_digest(
                        b"snapback:g0-corpus-principal-value:v1:",
                        &Value::String(principal.clone()),
                    )?,
                    found,
                },
            );
            if !auth_attached && let Some(user_id) = auth_user.as_deref() {
                state.capture_auth_user(attachment, user_id);
                auth_attached = true;
            }
            state.capture_query(attachment, &query, query_output.version, &rows)?;
            children_rows = rows
                .into_iter()
                .map(|row| {
                    Ok(RowInstance {
                        key: row_key(table, &row)?,
                        row,
                        root_key: parent.root_key.clone(),
                    })
                })
                .collect::<SnapbackResult<Vec<_>>>()?;
        } else if let Some(principal) = principal.as_ref() {
            // The parent relation is nullable, so no point lookup occurred.
            // The current principal scope is still the only target-table
            // scope that could become relevant after the parent itself wakes.
            let attachment = state.capture_graph(
                node,
                GraphCapturedDependencyV1::PrincipalField {
                    table: table.clone(),
                    index: access_index.clone(),
                    parent_key: Some(parent.key.clone()),
                    partition_hash: request.partition_hash.clone(),
                    field: principal_field.clone(),
                    value_digest: captured_value_digest(
                        b"snapback:g0-corpus-principal-value:v1:",
                        &Value::String(principal.clone()),
                    )?,
                    found: false,
                },
            );
            if !auth_attached && let Some(user_id) = auth_user.as_deref() {
                state.capture_auth_user(attachment, user_id);
                auth_attached = true;
            }
        } else {
            // Binding missed: still emit one parent-keyed fact so registration's
            // parent-key-set stays exact. No target-table query is possible.
            // @ref LLP 0209#32-authority-partition-identity-and-versioning —
            // an unbound principal cannot drop parents from the attested set.
            let _ = state.capture_graph(
                node,
                GraphCapturedDependencyV1::PrincipalField {
                    table: table.clone(),
                    index: access_index.clone(),
                    parent_key: Some(parent.key.clone()),
                    partition_hash: request.partition_hash.clone(),
                    field: principal_field.clone(),
                    value_digest: captured_value_digest(
                        b"snapback:g0-corpus-principal-value:v1:",
                        &Value::Null,
                    )?,
                    found: false,
                },
            );
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
    state.work.examined.insert(node_id.clone(), examined);
    state.work.ranges.insert(
        node_id.clone(),
        binding_consultations + target_consultations,
    );
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
        GraphProjectionLiteralV1::Number(value) => snapback_types::value_expr::number_value(*value),
    }
}

fn graph_transport_value(value: &Value) -> Value {
    match value {
        // SQLite REAL values arrive as f64 even when ECMAScript would render
        // the same finite value without a fractional suffix. Normalize at the
        // graph projection boundary so the host plan emits the same JSON
        // number bytes as the opaque JavaScript oracle.
        // @ref LLP 0209#8-serverlocal-evaluator-agreement-the-d2d3-interface-rung-5-referenced — graph projection has portable JavaScript value semantics.
        Value::Number(number) if number.is_f64() => number
            .as_f64()
            .map(snapback_types::value_expr::number_value)
            .unwrap_or(Value::Null),
        _ => value.clone(),
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
                .map(graph_transport_value)
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
        .filter_map(|node| {
            data_node_kind(node).and_then(|kind| {
                proofs
                    .iter()
                    .find(|proof| proof.node_id == node.node_id())
                    .map(|proof| (kind, proof))
            })
        })
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
    result_rows: u64,
    result_bytes: u64,
) -> bool {
    for cost in &plan.query_cost.graph.nodes {
        let node = &cost.node_id;
        if cost
            .max_root_rows_per_page
            .is_some_and(|limit| state.work.root.get(node).copied().unwrap_or(0) > limit)
            || state.work.examined.get(node).copied().unwrap_or(0)
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
    for argument in &plan.query_cost.graph.arguments {
        if state
            .work
            .argument_items
            .get(&argument.argument_id)
            .copied()
            .unwrap_or(0)
            > argument.max_items
        {
            return false;
        }
    }
    let argument_items = plan.arguments.iter().try_fold(0_u64, |sum, argument| {
        sum.checked_add(
            state
                .work
                .argument_items
                .get(&argument.argument_id)
                .copied()
                .unwrap_or(0),
        )
    });
    let scanned_rows = plan
        .query_cost
        .graph
        .nodes
        .iter()
        .try_fold(0_u64, |sum, cost| {
            sum.checked_add(state.work.examined.get(&cost.node_id).copied().unwrap_or(0))
        });
    let index_ranges = plan
        .query_cost
        .graph
        .nodes
        .iter()
        .try_fold(0_u64, |sum, cost| {
            sum.checked_add(state.work.ranges.get(&cost.node_id).copied().unwrap_or(0))
        });
    argument_items.is_some_and(|observed| observed <= plan.query_cost.graph.max_argument_items)
        && scanned_rows.is_some_and(|observed| observed <= plan.query_cost.max_scanned_rows)
        && index_ranges.is_some_and(|observed| observed <= plan.query_cost.max_index_ranges)
        && result_rows <= plan.query_cost.max_result_rows
        && result_bytes <= plan.query_cost.max_result_bytes
        && result_bytes <= plan.query_cost.graph.max_page_result_bytes
}

fn demand_costs(plan: &GraphQueryPlanV1) -> Vec<&crate::manifest::GraphNodeCostV1> {
    plan.query_cost
        .graph
        .nodes
        .iter()
        .filter(|cost| cost.max_window_pages.is_some())
        .collect()
}

fn cursor_unbound(message: impl Into<String>) -> SnapbackError {
    SnapbackError::error("SNAPBACK_GRAPH_CURSOR_UNBOUND", "query", message.into())
}

fn current_lineage(
    plan: &GraphQueryPlanV1,
    request: &GraphEvaluationRequestV1,
    node_id: &str,
    continuations: Vec<GraphWindowLedgerContinuationV1>,
) -> SnapbackResult<GraphWindowLedgerLineageV1> {
    let materialization = request.materialization_identity.as_ref().ok_or_else(|| {
        cursor_unbound("graph window ledger is missing host materialization custody")
    })?;
    if materialization.materialization_hash != request.materialization_hash {
        return Err(cursor_unbound(
            "graph window ledger materialization hash does not match host custody",
        ));
    }
    let plan_identity = graph_plan_identity_v1(plan)
        .map_err(|_| cursor_unbound("graph window ledger plan identity cannot be rebuilt"))?;
    let evaluated_parents = supplied_parent_sets(request);
    let instance = graph_instance_identity_v1(
        &plan_identity,
        &request.args,
        request.windows.clone(),
        &evaluated_parents,
    )
    .map_err(|_| cursor_unbound("graph window ledger demand identity cannot be rebuilt"))?;
    if materialization.preimage.graph_instance_hash != instance.instance_hash {
        return Err(cursor_unbound(
            "graph window ledger materialization does not bind the current demand",
        ));
    }
    let intervals = instance
        .preimage
        .windows
        .iter()
        .find(|window| window.node_id == node_id)
        .map(|window| window.intervals.clone())
        .ok_or_else(|| cursor_unbound("graph window ledger node has no demand vector entry"))?;
    let mut context = serde_json::to_value(&materialization.preimage).map_err(|_| {
        cursor_unbound("graph window ledger materialization context cannot be serialized")
    })?;
    context
        .as_object_mut()
        .expect("materialization preimage serializes as an object")
        .remove("graphInstanceHash");
    let materialization_context_hash =
        captured_value_digest(b"snapback:graph-window-ledger-context:v1:", &context)?;
    Ok(GraphWindowLedgerLineageV1 {
        node_id: node_id.to_owned(),
        materialization_context_hash,
        plan_hash: plan_identity.plan_hash,
        args_digest: instance.preimage.args_digest,
        partition_hash: request.partition_hash.clone(),
        intervals,
        continuations,
    })
}

fn continuation_for_parent<'a>(
    lineage: &'a GraphWindowLedgerLineageV1,
    parent_key: &Option<GraphRowKeyV1>,
) -> Option<&'a KeysetKeyV1> {
    lineage
        .continuations
        .iter()
        .find(|continuation| &continuation.parent_key == parent_key)
        .map(|continuation| &continuation.key)
}

fn keyset_keys_match(left: &KeysetKeyV1, right: &KeysetKeyV1) -> bool {
    let left = serde_json::to_value(left)
        .ok()
        .and_then(|value| snapback_types::rqs_contract::jcs(&value).ok());
    let right = serde_json::to_value(right)
        .ok()
        .and_then(|value| snapback_types::rqs_contract::jcs(&value).ok());
    left.is_some() && left == right
}

fn prior_lineage_matches_current(
    prior: &GraphWindowLedgerLineageV1,
    current: &GraphWindowLedgerLineageV1,
    may_advance: bool,
) -> bool {
    if prior.node_id != current.node_id
        || prior.materialization_context_hash != current.materialization_context_hash
        || prior.plan_hash != current.plan_hash
        || prior.args_digest != current.args_digest
        || prior.partition_hash != current.partition_hash
        || prior.intervals.len() != current.intervals.len()
    {
        return false;
    }
    prior
        .intervals
        .iter()
        .zip(&current.intervals)
        .all(|(before, after)| {
            if before == after {
                return true;
            }
            may_advance
                && before.parent_key == after.parent_key
                && before.window.order == after.window.order
                && before.window.direction == after.window.direction
                && before.window.take == after.window.take
                && before.window.upper == after.window.upper
                && continuation_for_parent(prior, &before.parent_key).is_some_and(|key| {
                    matches!(
                        &after.window.lower,
                        GraphIntervalEndV1::Exclusive { key: after_key }
                            if keyset_keys_match(key, after_key)
                    )
                })
        })
}

fn validate_prior_ledgers(
    plan: &GraphQueryPlanV1,
    request: &GraphEvaluationRequestV1,
) -> SnapbackResult<()> {
    let expected = demand_costs(plan);
    if !expected
        .iter()
        .any(|cost| cost.node_id == request.advanced_node_id)
    {
        return Err(SnapbackError::error(
            "SNAPBACK_GRAPH_CURSOR_UNBOUND",
            "query",
            "graph request does not bind one admitted demand lineage",
        ));
    }
    if request.prior_window_ledgers.is_empty() {
        return Ok(());
    }
    if request.prior_window_ledgers.len() != expected.len()
        || request
            .prior_window_ledgers
            .iter()
            .zip(expected)
            .any(|(ledger, cost)| ledger.node_id != cost.node_id)
    {
        return Err(cursor_unbound(
            "graph window ledger vector does not match demand lineages",
        ));
    }
    for ledger in &request.prior_window_ledgers {
        let prior = ledger
            .lineage
            .as_ref()
            .ok_or_else(|| cursor_unbound("graph window ledger lineage is unauthenticated"))?;
        let current = current_lineage(plan, request, &ledger.node_id, Vec::new())?;
        if !prior_lineage_matches_current(
            prior,
            &current,
            ledger.node_id == request.advanced_node_id,
        ) {
            return Err(cursor_unbound(
                "graph window ledger lineage does not authenticate this continuation",
            ));
        }
    }
    Ok(())
}

fn prior_ledger_at_or_over_bound(
    plan: &GraphQueryPlanV1,
    request: &GraphEvaluationRequestV1,
) -> bool {
    request
        .prior_window_ledgers
        .iter()
        .filter(|ledger| ledger.node_id == request.advanced_node_id)
        .any(|ledger| {
            let cost = plan
                .query_cost
                .graph
                .nodes
                .iter()
                .find(|cost| cost.node_id == ledger.node_id)
                .expect("prior ledger validation aligns demand costs");
            ledger.pages >= cost.max_window_pages.unwrap_or(0)
                || ledger.root_rows > cost.max_window_root_rows.unwrap_or(0)
                || ledger.scanned_rows > cost.max_window_scanned_rows.unwrap_or(0)
                || ledger.result_rows > cost.max_window_result_rows.unwrap_or(0)
                || ledger.result_bytes > cost.max_window_result_bytes.unwrap_or(0)
                || ledger.index_ranges > cost.max_window_index_ranges.unwrap_or(0)
        })
}

fn node_is_in_subtree(plan: &GraphQueryPlanV1, node_id: &str, root_id: &str) -> bool {
    let mut cursor = Some(node_id);
    while let Some(current) = cursor {
        if current == root_id {
            return true;
        }
        cursor = plan
            .nodes
            .iter()
            .find(|node| node.node_id() == current)
            .and_then(GraphNodeV1::parent_node_id);
    }
    false
}

fn next_ledgers(
    plan: &GraphQueryPlanV1,
    request: &GraphEvaluationRequestV1,
    state: &EvaluationState,
    result_rows: u64,
    result_bytes: u64,
) -> SnapbackResult<Option<Vec<GraphWindowLedgerV1>>> {
    let mut ledgers = request
        .prior_window_ledgers
        .iter()
        .map(|ledger| (ledger.node_id.clone(), ledger.clone()))
        .collect::<BTreeMap<_, _>>();
    let mut output = Vec::new();
    for cost in demand_costs(plan) {
        let first_page = !ledgers.contains_key(&cost.node_id);
        let ledger = ledgers
            .entry(cost.node_id.clone())
            .or_insert_with(|| GraphWindowLedgerV1 {
                node_id: cost.node_id.clone(),
                ..GraphWindowLedgerV1::default()
            });
        // @ref LLP 0209#24-plan-instance-and-contextual-materialization-identity —
        // the first publication charges every evaluated demand lineage; only
        // a continuation carries non-advanced lineages unchanged.
        if !first_page && cost.node_id != request.advanced_node_id {
            output.push(ledger.clone());
            continue;
        }
        let is_root = plan.root_node_id == cost.node_id;
        let Some(scanned_rows) = plan
            .query_cost
            .graph
            .nodes
            .iter()
            .try_fold(0_u64, |sum, node| {
                if node_is_in_subtree(plan, &node.node_id, &cost.node_id) {
                    sum.checked_add(state.work.examined.get(&node.node_id).copied().unwrap_or(0))
                } else {
                    Some(sum)
                }
            })
        else {
            return Ok(None);
        };
        let Some(index_ranges) = plan
            .query_cost
            .graph
            .nodes
            .iter()
            .try_fold(0_u64, |sum, node| {
                if node_is_in_subtree(plan, &node.node_id, &cost.node_id) {
                    sum.checked_add(state.work.ranges.get(&node.node_id).copied().unwrap_or(0))
                } else {
                    Some(sum)
                }
            })
        else {
            return Ok(None);
        };
        let Some((pages, root_rows, scanned_rows, result_rows, result_bytes, index_ranges)) =
            ledger
                .pages
                .checked_add(1)
                .zip(ledger.root_rows.checked_add(if is_root {
                    state.work.root.get(&cost.node_id).copied().unwrap_or(0)
                } else {
                    0
                }))
                .zip(ledger.scanned_rows.checked_add(scanned_rows))
                .zip(ledger.result_rows.checked_add(result_rows))
                .zip(ledger.result_bytes.checked_add(result_bytes))
                .zip(ledger.index_ranges.checked_add(index_ranges))
                .map(
                    |(
                        ((((pages, root_rows), scanned_rows), result_rows), result_bytes),
                        index_ranges,
                    )| {
                        (
                            pages,
                            root_rows,
                            scanned_rows,
                            result_rows,
                            result_bytes,
                            index_ranges,
                        )
                    },
                )
        else {
            return Ok(None);
        };
        let Some((
            max_pages,
            max_root_rows,
            max_scanned_rows,
            max_result_rows,
            max_result_bytes,
            max_index_ranges,
        )) = cost
            .max_window_pages
            .zip(cost.max_window_root_rows)
            .zip(cost.max_window_scanned_rows)
            .zip(cost.max_window_result_rows)
            .zip(cost.max_window_result_bytes)
            .zip(cost.max_window_index_ranges)
            .map(
                |(
                    ((((pages, root_rows), scanned_rows), result_rows), result_bytes),
                    index_ranges,
                )| {
                    (
                        pages,
                        root_rows,
                        scanned_rows,
                        result_rows,
                        result_bytes,
                        index_ranges,
                    )
                },
            )
        else {
            return Ok(None);
        };
        if pages > max_pages
            || root_rows > max_root_rows
            || scanned_rows > max_scanned_rows
            || result_rows > max_result_rows
            || result_bytes > max_result_bytes
            || index_ranges > max_index_ranges
        {
            return Ok(None);
        }
        ledger.pages = pages;
        ledger.root_rows = root_rows;
        ledger.scanned_rows = scanned_rows;
        ledger.result_rows = result_rows;
        ledger.result_bytes = result_bytes;
        ledger.index_ranges = index_ranges;
        let intervals = request
            .windows
            .iter()
            .find(|window| window.node_id == cost.node_id)
            .map(|window| &window.intervals)
            .ok_or_else(|| cursor_unbound("graph window ledger node lost its demand entry"))?;
        let continuations = intervals
            .iter()
            .filter_map(|interval| {
                let parent_id = interval
                    .parent_key
                    .as_ref()
                    .map_or("", |parent| parent.id.as_str());
                state
                    .continuations
                    .get(&(cost.node_id.clone(), parent_id.to_owned()))
                    .map(|key| {
                        serde_json::from_value(key.clone()).map(|key| {
                            GraphWindowLedgerContinuationV1 {
                                parent_key: interval.parent_key.clone(),
                                key,
                            }
                        })
                    })
            })
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| cursor_unbound("graph window continuation key is malformed"))?;
        ledger.lineage = Some(current_lineage(
            plan,
            request,
            &cost.node_id,
            continuations,
        )?);
        output.push(ledger.clone());
    }
    Ok(Some(output))
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
            continue;
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
    let projection = plan
        .nodes
        .iter()
        .find(|node| matches!(node, GraphNodeV1::ClosedProjection { .. }))
        .ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_QUERY_COST_EVIDENCE_REQUIRED",
                "query",
                "graph plan has no projection",
            )
        })?;
    node_proofs.push(proof_entry(
        projection.node_id(),
        node_kind(projection),
        GraphCompletenessLabelV1::Refused,
        GraphNodeCompletenessProofClassV1::ProjectionComposition,
        merge_json(
            tuple_json(request),
            json!({
                "kind":"closed-projection",
                "label":"refused",
                "reason":reason,
                "composition":proof,
            }),
        ),
    )?);
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
        ordered_root_keys: Vec::new(),
        result_length: 0,
        node_completeness: node_proofs,
        graph_completeness: graph,
        refusal_reason: Some(reason),
        structural_work: state.work.observation(plan),
        // A refusal publishes no page, so it cannot advance any lineage.
        window_ledgers: request.prior_window_ledgers.clone(),
        captured_reads: state.captured_reads.clone(),
        capture_attachments: state.capture_attachments.clone(),
        captured_query_outputs: state.captured_query_outputs.clone(),
        retained_state: None,
    })
}

fn closed_evaluation_refusal(error: &SnapbackError) -> Option<GraphMaterializedRefusalReasonV1> {
    // LLP 0209 §2.3 imports exact owner codes into a closed evaluation-time
    // register. Those storage, authorization, and query-cost conditions are
    // materialized; kernel errors outside that register (for example an
    // unknown-index error from a malformed in-memory plan, or an unclassified
    // SQLite I/O error) remain host errors because no owner ruling permits the
    // evaluator to relabel them.
    GraphEvaluationTimeRefusalReasonV1::from_code(&error.diagnostic.code)
        .and_then(|reason| GraphMaterializedRefusalReasonV1::from_code(reason.code()))
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
    let supplied_parents = supplied_parent_sets(request);
    validate_demand(plan, request, &supplied_parents)?;
    let input = input_for(plan, request)?;
    let mut state = EvaluationState::default();
    // Capture identity reconstruction is an additive G2-B output channel. A
    // corpus-only or defense-in-depth in-memory plan can intentionally bypass
    // admission while exercising G2-A evaluation behavior, so identity
    // reconstruction failure suppresses captures rather than changing that
    // established result/refusal behavior. Real admitted carriers always have
    // both identities and therefore emit the complete vector.
    state.capture_context = graph_plan_identity_v1(plan).ok().and_then(|plan_identity| {
        graph_instance_identity_v1(
            &plan_identity,
            &request.args,
            request.windows.clone(),
            &supplied_parents,
        )
        .ok()
        .map(|instance_identity| GraphCaptureContext {
            graph_plan_hash: plan_identity.plan_hash,
            instance_hash: instance_identity.instance_hash,
        })
    });
    state.work.prepare(plan, request)?;
    validate_prior_ledgers(plan, request)?;
    if prior_ledger_at_or_over_bound(plan, request) {
        return refused_output(
            plan,
            request,
            &state,
            GraphMaterializedRefusalReasonV1::QueryCostBoundExceeded,
        );
    }
    if !class_two_context_is_complete(plan, request) {
        return refused_output(
            plan,
            request,
            &state,
            GraphMaterializedRefusalReasonV1::AuthStaleResult,
        );
    }
    let evaluation = (|| -> SnapbackResult<GraphEvaluationOutputV1> {
        for node in &plan.nodes {
            match node {
                GraphNodeV1::RootWindow { .. } => {
                    evaluate_root(&read, plan, request, &input, &mut state, node)?
                }
                GraphNodeV1::EqualityToOne { .. } => {
                    evaluate_to_one(&read, request, &input, &mut state, node)?
                }
                GraphNodeV1::BoundedToMany { .. } => {
                    validate_child_demand(plan, request, &state, node)?;
                    evaluate_to_many(&read, request, &input, &mut state, node)?
                }
                GraphNodeV1::ExistsSemiJoin { .. } => {
                    evaluate_semi_join(&read, plan, request, &input, &mut state, node)?
                }
                GraphNodeV1::PrincipalBound { .. } => {
                    evaluate_principal(&read, request, &input, &mut state, node)?
                }
                GraphNodeV1::SearchMembership { .. } => {
                    // RULED for G2-A: admission continues to refuse search
                    // membership under B1/D6/OQ-4. This arm is defense in
                    // depth only for a hypothetically admitted in-memory plan;
                    // it must close as materialized evidence, not invent a
                    // provider execution contract.
                    return Err(SnapbackError::error(
                        "SNAPBACK_QUERY_COST_EVIDENCE_REQUIRED",
                        "query",
                        "search membership has no admitted G2 execution evidence",
                    ));
                }
                GraphNodeV1::ClosedProjection { .. } => {}
            }
            if let Some(reason) = state.materialized_refusal {
                return Err(SnapbackError::error(
                    reason.code(),
                    "query",
                    "graph node materialized a closed evaluation refusal",
                ));
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
        let result_length = rows.len() as u64;
        if !enforce_execution_bounds(plan, &state, result_length, result_bytes.len() as u64) {
            return Err(SnapbackError::error(
                "SNAPBACK_QUERY_COST_BOUND_EXCEEDED",
                "query",
                "graph execution exceeded an admitted bound",
            ));
        }
        let (label, class, composition_proof) =
            composition(plan, request, &state.node_proofs, None)?;
        let projection_proof = merge_json(
            tuple_json(request),
            json!({"kind":"closed-projection","label":label,"composition":composition_proof}),
        );
        let _ = state.capture_graph(
            projection,
            GraphCapturedDependencyV1::Projection {
                source_node_ids: plan
                    .nodes
                    .iter()
                    .filter(|node| !matches!(node, GraphNodeV1::ClosedProjection { .. }))
                    .map(|node| node.node_id().to_owned())
                    .collect(),
            },
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
            .map(|root| application_id(&root.row))
            .collect::<SnapbackResult<Vec<_>>>()?;
        let ordered_root_keys = state
            .roots
            .iter()
            .map(|root| root.root_key.clone())
            .collect::<Vec<_>>();
        let window_ledgers = next_ledgers(
            plan,
            request,
            &state,
            result_length,
            result_bytes.len() as u64,
        )?
        .ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_QUERY_COST_BOUND_EXCEEDED",
                "query",
                "graph window lineage exceeded an admitted bound",
            )
        })?;
        let retained_state = state.clone();
        Ok(GraphEvaluationOutputV1 {
            kind: "result".to_owned(),
            label,
            result_bytes: Some(result_bytes),
            ordered_root_ids,
            ordered_root_keys,
            result_length,
            node_completeness: state.node_proofs.clone(),
            graph_completeness,
            refusal_reason: None,
            structural_work: state.work.observation(plan),
            window_ledgers,
            captured_reads: state.captured_reads.clone(),
            capture_attachments: state.capture_attachments.clone(),
            captured_query_outputs: state.captured_query_outputs.clone(),
            retained_state: Some(RetainedEvaluationState(retained_state)),
        })
    })();
    match evaluation {
        Ok(output) => Ok(output),
        Err(error) => {
            if let Some(reason) = closed_evaluation_refusal(&error) {
                refused_output(plan, request, &state, reason)
            } else {
                Err(error)
            }
        }
    }
}

fn replace_node_proof(proofs: &mut Vec<NodeCompletenessV1>, replacement: NodeCompletenessV1) {
    if let Some(slot) = proofs
        .iter_mut()
        .find(|proof| proof.node_id == replacement.node_id)
    {
        *slot = replacement;
    } else {
        proofs.push(replacement);
    }
}

fn projection_contains_array(object: &GraphProjectionObjectV1) -> bool {
    object.fields.iter().any(|field| match &field.value {
        GraphProjectionValueV1::Array { .. } => true,
        GraphProjectionValueV1::Object { object, .. } => projection_contains_array(object),
        GraphProjectionValueV1::Field { .. }
        | GraphProjectionValueV1::Literal { .. }
        | GraphProjectionValueV1::Exists { .. } => false,
    })
}

fn rung1_node_path_is_eligible(plan: &GraphQueryPlanV1, node_id: &str) -> bool {
    let mut cursor = Some(node_id);
    while let Some(current) = cursor {
        let Some(node) = plan.nodes.iter().find(|node| node.node_id() == current) else {
            return false;
        };
        match node {
            GraphNodeV1::RootWindow { .. } => return current == plan.root_node_id,
            GraphNodeV1::EqualityToOne { parent_node_id, .. } => {
                cursor = Some(parent_node_id);
            }
            GraphNodeV1::BoundedToMany { .. }
            | GraphNodeV1::ExistsSemiJoin { .. }
            | GraphNodeV1::PrincipalBound { .. }
            | GraphNodeV1::SearchMembership { .. }
            | GraphNodeV1::ClosedProjection { .. } => return false,
        }
    }
    false
}

fn rung1_delta_shape_is_eligible(plan: &GraphQueryPlanV1, matched: &BTreeSet<&str>) -> bool {
    let Some(GraphNodeV1::ClosedProjection { object, .. }) = plan.nodes.last() else {
        return false;
    };
    !projection_contains_array(object)
        && matched
            .iter()
            .all(|node_id| rung1_node_path_is_eligible(plan, node_id))
}

fn descendant_join_may_have_changed(
    plan: &GraphQueryPlanV1,
    node_id: &str,
    changes: &[ChangedRow],
) -> bool {
    let join_fields = plan
        .nodes
        .iter()
        .filter(|node| node.parent_node_id() == Some(node_id))
        .flat_map(|node| match node {
            GraphNodeV1::EqualityToOne { join_on, .. }
            | GraphNodeV1::BoundedToMany { join_on, .. } => join_on
                .iter()
                .map(|join| join.root_field.as_str())
                .collect::<Vec<_>>(),
            GraphNodeV1::PrincipalBound { parent_join, .. } => parent_join
                .iter()
                .map(|join| join.root_field.as_str())
                .collect::<Vec<_>>(),
            GraphNodeV1::ExistsSemiJoin { edge, .. } => match edge {
                GraphEdgeV1::Direct(edge) => edge
                    .join_on
                    .iter()
                    .map(|join| join.root_field.as_str())
                    .collect(),
                GraphEdgeV1::Through(edge) => edge
                    .parent_join
                    .iter()
                    .map(|join| join.root_field.as_str())
                    .collect(),
            },
            GraphNodeV1::SearchMembership { .. }
            | GraphNodeV1::RootWindow { .. }
            | GraphNodeV1::ClosedProjection { .. } => Vec::new(),
        })
        .collect::<BTreeSet<_>>();
    !join_fields.is_empty()
        && changes.iter().any(|change| {
            change.changed_fields.is_empty()
                || change
                    .changed_fields
                    .iter()
                    .any(|field| join_fields.contains(field.as_str()))
        })
}

fn affected_to_one_parents(
    state: &EvaluationState,
    parent_node_id: &str,
    node_id: &str,
    join_on: &[crate::manifest::JoinEquality],
    table: &str,
    changes: &[ChangedRow],
) -> SnapbackResult<Vec<RowInstance>> {
    let relevant = changes
        .iter()
        .filter(|change| change.table == table)
        .collect::<Vec<_>>();
    let mut parents = Vec::new();
    for parent in parent_instances(state, parent_node_id) {
        let parent_id = storage_id(&parent.row)?;
        let old_child_ids = state
            .children
            .get(&(
                parent_node_id.to_owned(),
                parent_id.to_owned(),
                node_id.to_owned(),
            ))
            .into_iter()
            .flatten()
            .filter_map(|child| storage_id(&child.row).ok())
            .collect::<BTreeSet<_>>();
        let affected = relevant.iter().any(|change| {
            old_child_ids.contains(change.id.as_str())
                || change.row.as_ref().is_some_and(|row| {
                    join_on.iter().all(|join| {
                        parent.row.get(&join.root_field).unwrap_or(&Value::Null)
                            == row.get(&join.joined_field).unwrap_or(&Value::Null)
                    })
                })
        });
        if affected {
            parents.push(parent.clone());
        }
    }
    Ok(parents)
}

fn rebuild_to_one_proof(
    request: &GraphEvaluationRequestV1,
    state: &EvaluationState,
    node: &GraphNodeV1,
) -> SnapbackResult<Option<NodeCompletenessV1>> {
    let GraphNodeV1::EqualityToOne {
        node_id,
        parent_node_id,
        presence,
        ..
    } = node
    else {
        unreachable!()
    };
    let mut rows = Vec::new();
    for parent in parent_instances(state, parent_node_id) {
        let found = !children(state, parent_node_id, &parent.row, node_id).is_empty();
        if !found && *presence == GraphToOnePresenceV1::Required {
            return Ok(None);
        }
        rows.push(json!({"parentKey":parent.key,"found":found}));
    }
    sort_parent_proof_rows(&mut rows);
    proof_entry(
        node_id,
        node_kind(node),
        GraphCompletenessLabelV1::Complete,
        GraphNodeCompletenessProofClassV1::UniquePoint,
        merge_json(
            tuple_json(request),
            json!({"kind":"equality-to-one","label":"complete","rows":rows}),
        ),
    )
    .map(Some)
}

fn project_retained_result(
    plan: &GraphQueryPlanV1,
    state: &EvaluationState,
) -> SnapbackResult<Vec<Value>> {
    let projection = plan.nodes.last().ok_or_else(|| {
        SnapbackError::error(
            "SNAPBACK_QUERY_COST_EVIDENCE_REQUIRED",
            "query",
            "graph plan has no projection",
        )
    })?;
    let GraphNodeV1::ClosedProjection { object, .. } = projection else {
        return Err(SnapbackError::error(
            "SNAPBACK_QUERY_COST_EVIDENCE_REQUIRED",
            "query",
            "graph plan projection is not last",
        ));
    };
    let root_node_id = plan
        .nodes
        .first()
        .map(GraphNodeV1::node_id)
        .unwrap_or_default();
    state
        .roots
        .iter()
        .map(|root| {
            let mut scope = BTreeMap::new();
            scope.insert(root_node_id.to_owned(), root.row.clone());
            project_object(object, state, &scope)
        })
        .collect()
}

fn retained_row_patch(previous: &Value, current: &Value) -> SnapbackResult<Value> {
    let previous = previous.as_object().ok_or_else(|| {
        SnapbackError::error(
            "SNAPBACK_QUERY_COST_EVIDENCE_REQUIRED",
            "query",
            "retained graph row is not an object",
        )
    })?;
    let current = current.as_object().ok_or_else(|| {
        SnapbackError::error(
            "SNAPBACK_QUERY_COST_EVIDENCE_REQUIRED",
            "query",
            "fresh graph row is not an object",
        )
    })?;
    let fields = previous
        .keys()
        .chain(current.keys())
        .cloned()
        .collect::<BTreeSet<_>>();
    Ok(Value::Object(
        fields
            .into_iter()
            .filter(|field| previous.get(field) != current.get(field))
            .map(|field| {
                let value = current
                    .get(&field)
                    .map(graph_transport_value)
                    .unwrap_or(Value::Null);
                (field, value)
            })
            .collect(),
    ))
}

fn apply_projected_node_patch(
    projection: &GraphProjectionObjectV1,
    projected: &mut Value,
    node_id: &str,
    row_patch: &Value,
) -> SnapbackResult<()> {
    let output = projected.as_object_mut().ok_or_else(|| {
        SnapbackError::error(
            "SNAPBACK_QUERY_COST_EVIDENCE_REQUIRED",
            "query",
            "retained projected graph row is not an object",
        )
    })?;
    for field in &projection.fields {
        match &field.value {
            GraphProjectionValueV1::Field {
                node_id: source_node_id,
                field: source_field,
            } if source_node_id == node_id => {
                if let Some(value) = row_patch.get(source_field) {
                    output.insert(field.name.clone(), value.clone());
                }
            }
            GraphProjectionValueV1::Object { object, .. } => {
                if let Some(value) = output.get_mut(&field.name)
                    && !value.is_null()
                {
                    apply_projected_node_patch(object, value, node_id, row_patch)?;
                }
            }
            GraphProjectionValueV1::Array { .. } => {
                return Err(SnapbackError::error(
                    "SNAPBACK_QUERY_COST_EVIDENCE_REQUIRED",
                    "query",
                    "rung-1 graph patch encountered an ineligible array projection",
                ));
            }
            GraphProjectionValueV1::Field { .. }
            | GraphProjectionValueV1::Literal { .. }
            | GraphProjectionValueV1::Exists { .. } => {}
        }
    }
    Ok(())
}

/// Apply the exact emitted graph operations to the previously delivered
/// projected result. The convergence oracle compares these bytes—not the
/// evaluator's maintained side state—to a fresh same-cut evaluation.
pub(crate) fn apply_graph_delta_to_result(
    plan: &GraphQueryPlanV1,
    previous_result_bytes: &str,
    previous_root_keys: &[GraphRowKeyV1],
    ops: &[LiveGraphDeltaWireOpV1],
    ordered_root_keys: &[GraphRowKeyV1],
) -> SnapbackResult<String> {
    let rows = serde_json::from_str::<Vec<Value>>(previous_result_bytes).map_err(|error| {
        SnapbackError::error(
            "SNAPBACK_QUERY_COST_EVIDENCE_REQUIRED",
            "query",
            format!("retained graph result bytes are invalid: {error}"),
        )
    })?;
    if rows.len() != previous_root_keys.len() {
        return Err(SnapbackError::error(
            "SNAPBACK_QUERY_COST_EVIDENCE_REQUIRED",
            "query",
            "retained graph result and physical root-key vector disagree",
        ));
    }
    if previous_root_keys != ordered_root_keys {
        return Err(SnapbackError::error(
            "SNAPBACK_QUERY_COST_EVIDENCE_REQUIRED",
            "query",
            "rung-1 graph patch changed root membership or order",
        ));
    }
    let Some(GraphNodeV1::ClosedProjection { object, .. }) = plan.nodes.last() else {
        return Err(SnapbackError::error(
            "SNAPBACK_QUERY_COST_EVIDENCE_REQUIRED",
            "query",
            "graph plan has no terminal projection",
        ));
    };
    if projection_contains_array(object) {
        return Err(SnapbackError::error(
            "SNAPBACK_QUERY_COST_EVIDENCE_REQUIRED",
            "query",
            "rung-1 graph patch cannot apply an array projection",
        ));
    }
    let mut by_root = previous_root_keys
        .iter()
        .cloned()
        .zip(rows)
        .collect::<BTreeMap<_, _>>();
    if by_root.len() != previous_root_keys.len() {
        return Err(SnapbackError::error(
            "SNAPBACK_QUERY_COST_EVIDENCE_REQUIRED",
            "query",
            "retained graph physical root keys are not unique",
        ));
    }
    for operation in ops {
        let node = plan
            .nodes
            .iter()
            .find(|node| node.node_id() == operation.node_id);
        let node_table = node.and_then(|node| match node {
            GraphNodeV1::RootWindow { table, .. } | GraphNodeV1::EqualityToOne { table, .. } => {
                Some(table.as_str())
            }
            _ => None,
        });
        let root_table = plan.nodes.first().and_then(|node| match node {
            GraphNodeV1::RootWindow { table, .. } => Some(table.as_str()),
            _ => None,
        });
        if operation.op != LiveDeltaOpKind::Update
            || !rung1_node_path_is_eligible(plan, &operation.node_id)
            || node_table != Some(operation.key.table.as_str())
            || root_table != Some(operation.root_key.table.as_str())
        {
            return Err(SnapbackError::error(
                "SNAPBACK_QUERY_COST_EVIDENCE_REQUIRED",
                "query",
                "wire operation is outside the commissioned rung-1 update lane",
            ));
        }
        let expected_position = ordered_root_keys
            .iter()
            .position(|key| key == &operation.root_key)
            .map(|position| position as u64);
        if expected_position != Some(operation.position) {
            return Err(SnapbackError::error(
                "SNAPBACK_QUERY_COST_EVIDENCE_REQUIRED",
                "query",
                "wire operation root position is not physically keyed",
            ));
        }
        let projected = by_root.get_mut(&operation.root_key).ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_QUERY_COST_EVIDENCE_REQUIRED",
                "query",
                "wire operation names an undelivered physical root row",
            )
        })?;
        let patch = operation.row.as_ref().ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_QUERY_COST_EVIDENCE_REQUIRED",
                "query",
                "wire update omitted its retained-row diff",
            )
        })?;
        apply_projected_node_patch(object, projected, &operation.node_id, patch)?;
    }
    let applied = ordered_root_keys
        .iter()
        .map(|key| {
            by_root.get(key).cloned().ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_QUERY_COST_EVIDENCE_REQUIRED",
                    "query",
                    "post-apply physical root order names a missing row",
                )
            })
        })
        .collect::<SnapbackResult<Vec<_>>>()?;
    serde_json::to_string(&applied).map_err(|error| {
        SnapbackError::error(
            "SNAPBACK_QUERY_COST_EVIDENCE_REQUIRED",
            "query",
            error.to_string(),
        )
    })
}

fn graph_delta_ops(
    plan: &GraphQueryPlanV1,
    prior: &EvaluationState,
    current: &EvaluationState,
    matched: &BTreeSet<&str>,
) -> SnapbackResult<Vec<LiveGraphDeltaWireOpV1>> {
    let current_positions = current
        .roots
        .iter()
        .enumerate()
        .map(|(position, row)| (row.root_key.clone(), position as u64))
        .collect::<BTreeMap<_, _>>();
    let mut ops = Vec::new();
    for node in &plan.nodes {
        let node_id = node.node_id();
        if !matched.contains(node_id) {
            continue;
        }
        let prior_rows = prior
            .by_node
            .get(node_id)
            .into_iter()
            .flatten()
            .map(|row| ((row.root_key.clone(), row.key.clone()), row))
            .collect::<BTreeMap<_, _>>();
        let current_rows = current
            .by_node
            .get(node_id)
            .into_iter()
            .flatten()
            .map(|row| ((row.root_key.clone(), row.key.clone()), row))
            .collect::<BTreeMap<_, _>>();
        let identities = prior_rows
            .keys()
            .chain(current_rows.keys())
            .cloned()
            .collect::<BTreeSet<_>>();
        for identity in identities {
            let old = prior_rows.get(&identity).copied();
            let new = current_rows.get(&identity).copied();
            let (Some(old), Some(new)) = (old, new) else {
                return Err(SnapbackError::error(
                    "SNAPBACK_QUERY_COST_EVIDENCE_REQUIRED",
                    "query",
                    "rung-1 update changed physical row membership",
                ));
            };
            if old.row == new.row {
                continue;
            }
            let row = retained_row_patch(&old.row, &new.row)?;
            let position = current_positions
                .get(&new.root_key)
                .copied()
                .ok_or_else(|| {
                    SnapbackError::error(
                        "SNAPBACK_QUERY_COST_EVIDENCE_REQUIRED",
                        "query",
                        "rung-1 update lost its physical root position",
                    )
                })?;
            ops.push(LiveGraphDeltaWireOpV1 {
                op: LiveDeltaOpKind::Update,
                node_id: node_id.to_owned(),
                root_key: new.root_key.clone(),
                key: new.key.clone(),
                position,
                row: Some(row),
            });
        }
    }
    Ok(ops)
}

/// Incrementally maintain only LLP 0209 rung-1 nodes. `matched_node_ids` must
/// come from the per-node attested matcher; any inability to prove an exact
/// root range or retained-parent point update closes to `Ok(None)`.
///
/// @ref LLP 0209#7-rung-4--incremental-maintenance-for-admitted-shapes-extending-dk-3 — root windows are boundary-aware and equality-to-one edges are row-keyed patches.
/// @ref LLP 0209#4-completeness-vocabulary — the maintained result carries the fresh label and tuple-bound proofs.
pub(crate) fn evaluate_graph_delta_on(
    read: DbRead<'_>,
    plan: &GraphQueryPlanV1,
    request: &GraphEvaluationRequestV1,
    prior: &GraphEvaluationOutputV1,
    changes: &[ChangedRow],
    matched_node_ids: &[String],
) -> SnapbackResult<Option<GraphDeltaEvaluationV1>> {
    let Some(RetainedEvaluationState(mut state)) = prior.retained_state.clone() else {
        return Ok(None);
    };
    let prior_state = state.clone();
    if prior.refusal_reason.is_some() || matched_node_ids.is_empty() {
        return Ok(None);
    }
    let matched = matched_node_ids
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    if !rung1_delta_shape_is_eligible(plan, &matched) {
        return Ok(None);
    }
    validate_demand(plan, request, &supplied_parent_sets(request))?;
    let input = input_for(plan, request)?;
    let mut delta_work = Work::default();
    delta_work.prepare(plan, request)?;
    let mut proofs = state
        .node_proofs
        .iter()
        .filter(|proof| proof.node_kind != GraphNodeKindV1::ClosedProjection)
        .cloned()
        .collect::<Vec<_>>();
    for proof in &mut proofs {
        proof.proof = merge_json(proof.proof.clone(), tuple_json(request));
    }
    let root_node_id = plan
        .nodes
        .first()
        .map(GraphNodeV1::node_id)
        .unwrap_or_default()
        .to_owned();

    if matched.contains(root_node_id.as_str()) {
        let root_node = plan.nodes.first().expect("admitted graph root");
        let GraphNodeV1::RootWindow { table, .. } = root_node else {
            return Ok(None);
        };
        let old_keys = state
            .roots
            .iter()
            .map(|row| row.root_key.clone())
            .collect::<Vec<_>>();
        let old_key_set = old_keys.iter().cloned().collect::<BTreeSet<_>>();
        let root_changes = changes
            .iter()
            .filter(|change| change.table == *table)
            .collect::<Vec<_>>();
        if root_changes.is_empty()
            || root_changes.iter().any(|change| {
                change.op != ChangeOp::Update
                    || !old_key_set.contains(&GraphRowKeyV1 {
                        table: table.clone(),
                        id: change.id.clone(),
                    })
            })
        {
            return Ok(None);
        }
        let mut fresh_root = EvaluationState::default();
        fresh_root.work.prepare(plan, request)?;
        evaluate_root(&read, plan, request, &input, &mut fresh_root, root_node)?;
        let new_keys = fresh_root
            .roots
            .iter()
            .map(|row| row.root_key.clone())
            .collect::<Vec<_>>();
        let old_proof = proofs
            .iter()
            .find(|proof| proof.node_id == root_node_id)
            .expect("retained graph root proof");
        let fresh_proof = fresh_root
            .node_proofs
            .first()
            .expect("fresh graph root proof")
            .clone();
        // The commissioned root lane is update-in-place only. Exact physical
        // membership and position must remain identical; additions, removals,
        // boundary displacement, and in-window reorder all replace.
        if old_keys != new_keys || old_proof.label != fresh_proof.label {
            return Ok(None);
        }
        if descendant_join_may_have_changed(plan, &root_node_id, changes) {
            return Ok(None);
        }
        state.roots = fresh_root.roots.clone();
        state
            .by_node
            .insert(root_node_id.clone(), fresh_root.roots.clone());
        delta_work.absorb(&fresh_root.work);
        replace_node_proof(&mut proofs, fresh_proof);
    }

    for node in &plan.nodes {
        let GraphNodeV1::EqualityToOne {
            node_id,
            parent_node_id,
            table,
            join_on,
            ..
        } = node
        else {
            continue;
        };
        if !matched.contains(node_id.as_str()) {
            continue;
        }
        let node_changes = changes
            .iter()
            .filter(|change| change.table == *table)
            .cloned()
            .collect::<Vec<_>>();
        if node_changes.is_empty()
            || node_changes
                .iter()
                .any(|change| change.op != ChangeOp::Update)
            || descendant_join_may_have_changed(plan, node_id, &node_changes)
        {
            return Ok(None);
        }
        let parents =
            affected_to_one_parents(&state, parent_node_id, node_id, join_on, table, changes)?;
        if parents.is_empty() {
            return Ok(None);
        }
        let mut point = EvaluationState::default();
        point.work.prepare(plan, request)?;
        point
            .by_node
            .insert(parent_node_id.clone(), parents.clone());
        evaluate_to_one(&read, request, &input, &mut point, node)?;
        if point.materialized_refusal.is_some() {
            return Ok(None);
        }
        let mut replaced_child_keys = BTreeSet::new();
        for parent in &parents {
            let parent_id = storage_id(&parent.row)?;
            let key = (
                parent_node_id.clone(),
                parent_id.to_owned(),
                node_id.clone(),
            );
            let old = state.children.get(&key).cloned().unwrap_or_default();
            let new = point.children.get(&key).cloned().unwrap_or_default();
            let old_keys = old.iter().map(|row| row.key.clone()).collect::<Vec<_>>();
            let new_keys = new.iter().map(|row| row.key.clone()).collect::<Vec<_>>();
            // Rung 1 maintains updates for retained parents. Optional edge
            // entry/exit and child identity replacement remain replace-only.
            if old_keys != new_keys {
                return Ok(None);
            }
            replaced_child_keys.extend(
                old.into_iter()
                    .map(|row| (row.root_key.clone(), row.key.clone())),
            );
            state.children.insert(key, new);
        }
        let rows = state.by_node.entry(node_id.clone()).or_default();
        rows.retain(|row| !replaced_child_keys.contains(&(row.root_key.clone(), row.key.clone())));
        rows.extend(point.by_node.get(node_id).cloned().unwrap_or_default());
        delta_work.absorb(&point.work);
        let Some(proof) = rebuild_to_one_proof(request, &state, node)? else {
            // A required-edge miss is data in the evaluation-time register;
            // the incremental lane falls back without surfacing a host Err.
            return Ok(None);
        };
        replace_node_proof(&mut proofs, proof);
    }

    let rows = project_retained_result(plan, &state)?;
    let result_bytes = serde_json::to_string(&rows).map_err(|error| {
        SnapbackError::error(
            "SNAPBACK_QUERY_COST_EVIDENCE_REQUIRED",
            "query",
            error.to_string(),
        )
    })?;
    let (label, proof_class, composition_proof) = composition(plan, request, &proofs, None)?;
    if label != prior.label {
        return Ok(None);
    }
    let projection = plan.nodes.last().expect("admitted graph projection");
    proofs.push(proof_entry(
        projection.node_id(),
        node_kind(projection),
        label,
        GraphNodeCompletenessProofClassV1::ProjectionComposition,
        merge_json(
            tuple_json(request),
            json!({
                "kind":"closed-projection",
                "label":label,
                "composition":composition_proof,
            }),
        ),
    )?);
    state.node_proofs = proofs.clone();
    state.work = delta_work.clone();
    let structural_work = delta_work.observation(plan);
    if !enforce_execution_bounds(plan, &state, rows.len() as u64, result_bytes.len() as u64) {
        return Ok(None);
    }
    let mut ledger_request = request.clone();
    ledger_request.prior_window_ledgers = prior.window_ledgers.clone();
    let Some(window_ledgers) = next_ledgers(
        plan,
        &ledger_request,
        &state,
        rows.len() as u64,
        result_bytes.len() as u64,
    )?
    else {
        return Ok(None);
    };
    let new_root_ids = state
        .roots
        .iter()
        .map(|root| application_id(&root.row))
        .collect::<SnapbackResult<Vec<_>>>()?;
    let new_root_keys = state
        .roots
        .iter()
        .map(|root| root.root_key.clone())
        .collect::<Vec<_>>();
    let ops = graph_delta_ops(plan, &prior_state, &state, &matched)?;
    let mut predecessor_proofs = prior.node_completeness.clone();
    for proof in &mut predecessor_proofs {
        proof.proof = merge_json(proof.proof.clone(), tuple_json(request));
    }
    let node_proof_updates = proofs
        .iter()
        .filter(|proof| {
            predecessor_proofs
                .iter()
                .find(|prior| prior.node_id == proof.node_id)
                != Some(*proof)
        })
        .cloned()
        .collect();
    let evaluation_cost = structural_work.evaluation_cost();
    let output = GraphEvaluationOutputV1 {
        kind: "result".to_owned(),
        label,
        result_bytes: Some(result_bytes),
        ordered_root_ids: new_root_ids,
        ordered_root_keys: new_root_keys,
        result_length: rows.len() as u64,
        node_completeness: proofs,
        graph_completeness: GraphCompletenessV1 {
            materialization_hash: request.materialization_hash.clone(),
            partition_hash: request.partition_hash.clone(),
            authorization_version: request.authorization_version.clone(),
            evaluation_cut: request.evaluation_cut,
            label,
            proof_class,
            proof: composition_proof,
        },
        refusal_reason: None,
        structural_work,
        window_ledgers,
        captured_reads: prior.captured_reads.clone(),
        capture_attachments: prior.capture_attachments.clone(),
        captured_query_outputs: prior.captured_query_outputs.clone(),
        retained_state: Some(RetainedEvaluationState(state)),
    };
    Ok(Some(GraphDeltaEvaluationV1 {
        output,
        ops,
        node_proof_updates,
        evaluation_cost,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_probe_binds_only_the_declared_argument_filter() {
        let mut filters = vec![
            FilterExpr {
                field: "declared".to_owned(),
                op: FilterOp::In,
                value: ValueExpr::Arg("a1".to_owned()),
            },
            FilterExpr {
                field: "other".to_owned(),
                op: FilterOp::In,
                value: ValueExpr::Arg("a2".to_owned()),
            },
            FilterExpr {
                field: "literal".to_owned(),
                op: FilterOp::In,
                value: ValueExpr::Literal(json!(["unchanged"])),
            },
        ];
        bind_declared_all_probe(&mut filters, Some("a1"), &json!("probe"));
        assert_eq!(filters[0].op, FilterOp::Eq);
        assert_eq!(filters[0].value, ValueExpr::Literal(json!("probe")));
        assert_eq!(filters[1].op, FilterOp::In);
        assert_eq!(filters[1].value, ValueExpr::Arg("a2".to_owned()));
        assert_eq!(filters[2].op, FilterOp::In);
        assert_eq!(filters[2].value, ValueExpr::Literal(json!(["unchanged"])));
    }

    #[test]
    fn retained_row_patch_diffs_evaluated_rows_including_system_fields() {
        let previous = json!({
            "_id":"row_physical",
            "_version":7,
            "_updatedAt":100,
            "title":"before",
            "open":false,
            "removed":"old",
        });
        let current = json!({
            "_id":"row_physical",
            "_version":8,
            "_updatedAt":101,
            "title":"after",
            "open":true,
        });
        assert_eq!(
            retained_row_patch(&previous, &current).unwrap(),
            json!({
                "_version":8,
                "_updatedAt":101,
                "title":"after",
                "open":true,
                "removed":null,
            })
        );
    }
}

#[cfg(any(test, feature = "test-support"))]
impl RetainedEvaluationState {
    /// Observe the exact server-retained evaluator carrier without exposing a
    /// mutation path. Stage-B delta conformance uses this owned JSON value to
    /// compare the shipped next state with the reference forms.
    pub(crate) fn observation_for_test(&self) -> Value {
        json!({
            "byNode": self.0.by_node.iter().map(|(node_id, rows)| json!({
                "nodeId": node_id,
                "rows": rows.iter().map(|instance| json!({
                    "key": instance.key,
                    "rootKey": instance.root_key,
                    "row": instance.row,
                })).collect::<Vec<_>>(),
            })).collect::<Vec<_>>(),
            "children": self.0.children.iter().map(|((parent_node_id, scope, node_id), rows)| json!({
                "parentNodeId": parent_node_id,
                "scope": scope,
                "nodeId": node_id,
                "rows": rows.iter().map(|instance| json!({
                    "key": instance.key,
                    "rootKey": instance.root_key,
                    "row": instance.row,
                })).collect::<Vec<_>>(),
            })).collect::<Vec<_>>(),
            "hasMore": self.0.has_more.iter().map(|((node_id, scope), has_more)| json!({
                "nodeId": node_id,
                "scope": scope,
                "value": has_more,
            })).collect::<Vec<_>>(),
            "continuations": self.0.continuations.iter().map(|((node_id, scope), continuation)| json!({
                "nodeId": node_id,
                "scope": scope,
                "value": continuation,
            })).collect::<Vec<_>>(),
        })
    }
}

#[cfg(any(test, feature = "test-support"))]
impl GraphEvaluationOutputV1 {
    /// Observe retained evaluator state through the Stage-B read-only seam.
    /// The returned value is detached from serving custody and cannot mutate
    /// the established subscription's evidence.
    pub(crate) fn retained_state_observation_for_test(&self) -> Option<Value> {
        self.retained_state
            .as_ref()
            .map(RetainedEvaluationState::observation_for_test)
    }
}
