use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::manifest::{
    FilterExpr, FilterOp, FunctionDefinition, FunctionRuntime, GraphAuthorityPartitionIdentityV1,
    GraphCapturedDependencyV1, GraphCapturedReadAttachmentV1, GraphCapturedReadV1,
    GraphChildPageV1, GraphDemandTimeRefusalReasonV1, GraphDirectionV1, GraphEdgeV1,
    GraphExistsModeV1, GraphIntervalEndV1, GraphMaterializationIdentityV1, GraphNodeKindV1,
    GraphNodeV1, GraphNodeWindowIdentityV1, GraphQueryCarrierV1, GraphRowKeyV1, HandlerInput,
    HandlerPlan, OrderDirection, OrderExpr, QueryOutput, QueryPlan, SchemaManifest, Sha256V1,
    TableVisibilityV1, ValueExpr, effective_query_limit, graph_authority_partition_identity_v1,
    graph_instance_identity_v1, graph_materialization_identity_v1, graph_plan_identity_v1,
    validate_graph_captured_read_v1,
};
use crate::storage::{CapturedReadDependency, CapturedReadKind, ChangeOp, ChangedRow, DbRead};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest as _, Sha256};
use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet};

pub type QueryDependencyMetadata = (Option<Value>, Option<usize>, Option<usize>, Option<Value>);

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

#[derive(
    Clone, Copy, Debug, Deserialize, Eq, JsonSchema, Ord, PartialEq, PartialOrd, Serialize,
)]
#[serde(rename_all = "kebab-case")]
pub enum GraphNodeMatchDispositionV1 {
    Skip,
    Match,
    ConservativeFallback,
}

#[derive(
    Clone, Copy, Debug, Deserialize, Eq, JsonSchema, Ord, PartialEq, PartialOrd, Serialize,
)]
#[serde(rename_all = "kebab-case")]
pub enum GraphNodeMatchReasonV1 {
    CapturedDisjoint,
    CapturedIntersects,
    CaptureIncomplete,
    StaticTableIntersects,
    SearchTableWrite,
    SearchCaptureIncomplete,
    ProjectionOnly,
}

/// One value-free per-node graph matcher decision in normalized plan order.
///
/// @ref LLP 0209#52-per-node-decision-ledger — node/instance values remain in
/// the decision row used by tests and traces; stats aggregate without exposing
/// row, argument, principal, or scope values.
#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphNodeDecisionLedgerV1 {
    pub graph_plan_hash: String,
    pub instance_hash: String,
    pub node_id: String,
    pub node_kind: GraphNodeKindV1,
    pub authority_class: crate::manifest::GraphAuthorityClassV1,
    pub capture_complete: bool,
    pub dependency_kinds: Vec<CapturedReadKind>,
    pub captured_dependency_count: u64,
    pub changed_row_count: u64,
    pub disposition: GraphNodeMatchDispositionV1,
    pub reason: GraphNodeMatchReasonV1,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphNodeDecisionStatsV1 {
    pub graph_plan_hash: String,
    pub node_kind: GraphNodeKindV1,
    pub disposition: GraphNodeMatchDispositionV1,
    pub reason: GraphNodeMatchReasonV1,
    pub decisions: u64,
    pub skips: u64,
    pub matches: u64,
    pub conservative_fallbacks: u64,
    pub capture_incomplete: u64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct LiveMatchDecisionV1 {
    pub outcome: LiveMatchOutcome,
    pub graph_nodes: Vec<GraphNodeDecisionLedgerV1>,
}

/// Full rows returned by one ordinary query companion during graph evaluation.
/// This internal registration input is never exposed by captured-read
/// inspection. It lets sync reconstruct child join literals and parent output
/// closure without treating the child graph fact as its own provenance.
#[derive(Clone, Debug, PartialEq)]
pub struct GraphCapturedQueryOutputV1 {
    pub query_read_index: u64,
    pub rows: Vec<Value>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct GraphRegistrationPermissionValuesV1 {
    pub field: String,
    pub allowed_values: Vec<Value>,
}

/// Complete demand/context input to graph dependency registration. Hash-only
/// registration is deliberately impossible: the constructor rebuilds the
/// instance, materialization, and partition identities from these preimages.
#[derive(Clone, Debug, PartialEq)]
pub struct GraphSubscriptionRegistrationDemandV1 {
    pub args: Value,
    pub windows: Vec<GraphNodeWindowIdentityV1>,
    pub input: HandlerInput,
    pub permission_values_by_table: BTreeMap<String, GraphRegistrationPermissionValuesV1>,
    pub materialization: GraphMaterializationIdentityV1,
    pub partition: GraphAuthorityPartitionIdentityV1,
}

/// Sync-attested graph dependency registration. Its private fields prevent the
/// matcher from accepting a caller-assembled flat vector: the only constructor
/// validates exact graph identity, attachment, cardinality, and parent closure.
///
/// @ref LLP 0209#51-captured-vocabulary-by-normalized-node — graph matching is
/// all-or-conservative and consumes only the sync-attested capture closure.
#[derive(Clone, Debug)]
pub struct RegisteredGraphSubscriptionDependenciesV1 {
    graph_plan_hash: Sha256V1,
    instance_hash: Sha256V1,
    materialization_hash: Sha256V1,
    partition_hash: Sha256V1,
    normalized_node_ids: Vec<String>,
    per_node_capture_cardinalities: Vec<u64>,
    parent_key_closure: Vec<Vec<GraphRowKeyV1>>,
    reads: Vec<CapturedReadDependency>,
    attachments: Vec<GraphCapturedReadAttachmentV1>,
}

impl RegisteredGraphSubscriptionDependenciesV1 {
    pub fn reads(&self) -> &[CapturedReadDependency] {
        &self.reads
    }

    pub fn instance_hash(&self) -> &Sha256V1 {
        &self.instance_hash
    }

    pub fn materialization_hash(&self) -> &Sha256V1 {
        &self.materialization_hash
    }

    pub fn partition_hash(&self) -> &Sha256V1 {
        &self.partition_hash
    }

    /// Estimated bytes for the complete retained registration payload. The
    /// registration owns its own read and attachment vectors in addition to
    /// the evaluator-facing copies retained by the engine, so both copies
    /// must participate in the memo's byte budget.
    pub fn retained_payload_estimated_bytes(&self) -> usize {
        #[derive(Default)]
        struct ByteCounter {
            bytes: usize,
        }

        impl std::io::Write for ByteCounter {
            fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
                self.bytes = self.bytes.saturating_add(buffer.len());
                Ok(buffer.len())
            }

            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }

        let mut counter = ByteCounter::default();
        serde_json::to_writer(
            &mut counter,
            &(
                &self.graph_plan_hash,
                &self.instance_hash,
                &self.materialization_hash,
                &self.partition_hash,
                &self.normalized_node_ids,
                &self.per_node_capture_cardinalities,
                &self.parent_key_closure,
                &self.reads,
                &self.attachments,
            ),
        )
        .map_or(usize::MAX, |()| counter.bytes)
    }
}

struct GraphRegistrationFact<'a> {
    graph: &'a GraphCapturedReadV1,
    ordinary: Vec<(usize, &'a CapturedReadDependency)>,
    query_outputs: BTreeMap<usize, &'a [Value]>,
}

fn demand_mismatch(field: &'static str) -> GraphDemandTimeRefusalReasonV1 {
    if std::env::var_os("SNAPBACK_GRAPH_DEMAND_IDENTITY_TRACE").is_some() {
        eprintln!("SNAPBACK_GRAPH_DEMAND_IDENTITY_MISMATCH field={field}");
    }
    GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch
}

fn registration_facts<'a>(
    carrier: &GraphQueryCarrierV1,
    reads: &'a [CapturedReadDependency],
    attachments: &[GraphCapturedReadAttachmentV1],
    query_outputs: &'a [GraphCapturedQueryOutputV1],
) -> Result<(Vec<GraphRegistrationFact<'a>>, Vec<u64>), GraphDemandTimeRefusalReasonV1> {
    let rebuilt_plan = graph_plan_identity_v1(&carrier.normalized_plan);
    if !rebuilt_plan
        .as_ref()
        .is_ok_and(|identity| identity.plan_hash == carrier.plan_hash)
    {
        return Err(demand_mismatch("plan-hash"));
    }
    if reads.iter().any(|read| !read.graph_pairing_is_valid()) {
        return Err(demand_mismatch("graph-pairing"));
    }
    let mut claimed = BTreeSet::new();
    let mut attached_graphs = BTreeSet::new();
    let mut cardinalities = vec![0_u64; carrier.normalized_plan.nodes.len()];
    let mut last_node_index = None;
    let mut facts = Vec::with_capacity(attachments.len());
    let mut outputs_by_query = BTreeMap::new();
    for output in query_outputs {
        let index = usize::try_from(output.query_read_index)
            .map_err(|_| demand_mismatch("query-output-index"))?;
        if outputs_by_query
            .insert(index, output.rows.as_slice())
            .is_some()
        {
            return Err(demand_mismatch("duplicate-query-output"));
        }
    }
    for attachment in attachments {
        let graph_index = usize::try_from(attachment.graph_read_index)
            .map_err(|_| demand_mismatch("graph-read-index"))?;
        let graph_read = reads
            .get(graph_index)
            .ok_or_else(|| demand_mismatch("graph-read-missing"))?;
        let graph = graph_read
            .graph
            .as_ref()
            .ok_or_else(|| demand_mismatch("graph-payload-missing"))?;
        if !attached_graphs.insert(graph_index)
            || !claimed.insert(graph_index)
            || validate_graph_captured_read_v1(graph, &carrier.normalized_plan).is_err()
        {
            return Err(demand_mismatch("graph-attachment"));
        }
        let node_index = carrier
            .normalized_plan
            .nodes
            .iter()
            .position(|node| node.node_id() == graph.node_id)
            .ok_or_else(|| demand_mismatch("unknown-node-id"))?;
        if last_node_index.is_some_and(|last| node_index < last) {
            return Err(demand_mismatch("attachment-order"));
        }
        last_node_index = Some(node_index);
        cardinalities[node_index] = cardinalities[node_index]
            .checked_add(1)
            .ok_or_else(|| demand_mismatch("capture-cardinality"))?;
        let mut ordinary_reads = Vec::with_capacity(attachment.ordinary_read_indices.len());
        let mut attached_outputs = BTreeMap::new();
        for ordinary_index in &attachment.ordinary_read_indices {
            let ordinary_index = usize::try_from(*ordinary_index)
                .map_err(|_| demand_mismatch("ordinary-read-index"))?;
            let ordinary = reads
                .get(ordinary_index)
                .ok_or_else(|| demand_mismatch("ordinary-read-missing"))?;
            if ordinary.graph.is_some()
                || ordinary.kind == CapturedReadKind::GraphNode
                || !claimed.insert(ordinary_index)
            {
                return Err(demand_mismatch("ordinary-attachment"));
            }
            if ordinary.kind == CapturedReadKind::Query {
                let rows = outputs_by_query
                    .remove(&ordinary_index)
                    .ok_or_else(|| demand_mismatch("query-output-missing"))?;
                attached_outputs.insert(ordinary_index, rows);
            } else if outputs_by_query.contains_key(&ordinary_index) {
                return Err(demand_mismatch("query-output-unattached"));
            }
            ordinary_reads.push((ordinary_index, ordinary));
        }
        facts.push(GraphRegistrationFact {
            graph,
            ordinary: ordinary_reads,
            query_outputs: attached_outputs,
        });
    }
    let graph_read_count = reads.iter().filter(|read| read.graph.is_some()).count();
    if attached_graphs.len() != graph_read_count
        || claimed.len() != reads.len()
        || !outputs_by_query.is_empty()
    {
        return Err(demand_mismatch("capture-vector-coverage"));
    }
    Ok((facts, cardinalities))
}

fn registration_query_records<'a>(
    fact: &'a GraphRegistrationFact<'a>,
) -> Result<
    Vec<(usize, &'a CapturedReadDependency, QueryPlan, &'a [Value])>,
    GraphDemandTimeRefusalReasonV1,
> {
    fact.ordinary
        .iter()
        .filter(|(_, read)| read.kind == CapturedReadKind::Query)
        .map(|(index, read)| {
            let plan = serde_json::from_value::<QueryPlan>(
                read.predicate
                    .clone()
                    .ok_or(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch)?,
            )
            .map_err(|_| GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch)?;
            let rows = fact
                .query_outputs
                .get(index)
                .copied()
                .ok_or(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch)?;
            Ok((*index, *read, plan, rows))
        })
        .collect()
}

fn registration_query_rows_are_attested(
    fact: &GraphRegistrationFact<'_>,
) -> Result<(), GraphDemandTimeRefusalReasonV1> {
    let records = registration_query_records(fact)?;
    let mut expected_points = Vec::new();
    for (_, read, _, rows) in &records {
        let table = read
            .table
            .as_deref()
            .ok_or(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch)?;
        let ids = rows
            .iter()
            .map(|row| {
                let id = row
                    .get("_id")
                    .and_then(Value::as_str)
                    .ok_or(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch)?;
                let version = row
                    .get("_version")
                    .and_then(Value::as_u64)
                    .ok_or(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch)?;
                expected_points.push((table.to_owned(), id.to_owned(), version));
                Ok(id.to_owned())
            })
            .collect::<Result<Vec<_>, GraphDemandTimeRefusalReasonV1>>()?;
        if read.rows != ids || read.version.is_none() {
            return Err(demand_mismatch("query-row-attestation"));
        }
    }
    let mut actual_points = fact
        .ordinary
        .iter()
        .filter(|(_, read)| read.kind == CapturedReadKind::Row)
        .map(|(_, read)| {
            Ok((
                read.table
                    .clone()
                    .ok_or_else(|| demand_mismatch("row-table"))?,
                read.id.clone().ok_or_else(|| demand_mismatch("row-id"))?,
                read.version.ok_or_else(|| demand_mismatch("row-version"))?,
            ))
        })
        .collect::<Result<Vec<_>, GraphDemandTimeRefusalReasonV1>>()?;
    expected_points.sort();
    actual_points.sort();
    if expected_points != actual_points {
        return Err(demand_mismatch("row-point-set"));
    }
    if fact.ordinary.iter().any(|(_, read)| {
        !matches!(
            read.kind,
            CapturedReadKind::Query | CapturedReadKind::Row | CapturedReadKind::Auth
        )
    }) {
        return Err(demand_mismatch("ordinary-kind"));
    }
    Ok(())
}

fn registration_authorized_filters(
    table: &str,
    declared: impl IntoIterator<Item = FilterExpr>,
    demand: &GraphSubscriptionRegistrationDemandV1,
) -> Vec<FilterExpr> {
    let mut filters = declared.into_iter().collect::<Vec<_>>();
    if let Some(permission) = demand.permission_values_by_table.get(table) {
        filters.push(FilterExpr {
            field: permission.field.clone(),
            op: FilterOp::In,
            value: ValueExpr::Literal(Value::Array(permission.allowed_values.clone())),
        });
    }
    filters
}

fn registration_query_plan(
    table: &str,
    visibility: &TableVisibilityV1,
    filters: Vec<FilterExpr>,
    order: Vec<OrderExpr>,
    limit: u64,
    index: &str,
    demand: &GraphSubscriptionRegistrationDemandV1,
) -> Result<QueryPlan, GraphDemandTimeRefusalReasonV1> {
    Ok(QueryPlan {
        table: table.to_owned(),
        table_visibility: (!matches!(visibility, TableVisibilityV1::PublicRead))
            .then(|| visibility.clone()),
        filters: registration_authorized_filters(table, filters, demand),
        membership_filters: Vec::new(),
        order,
        limit: Some(
            usize::try_from(limit)
                .map_err(|_| GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch)?,
        ),
        indexed_by: (index != "by_id").then(|| index.to_owned()),
    })
}

fn registration_query_is_exact(
    read: &CapturedReadDependency,
    supplied: &QueryPlan,
    rows: &[Value],
    expected: &QueryPlan,
) -> Result<(), GraphDemandTimeRefusalReasonV1> {
    let expected_value =
        serde_json::to_value(expected).map_err(|_| demand_mismatch("query-plan-serialize"))?;
    let (order, limit, result_count, boundary) =
        query_dependency_metadata(expected, rows).map_err(|_| demand_mismatch("query-metadata"))?;
    if supplied != expected {
        return Err(demand_mismatch("query-plan"));
    }
    if read.predicate.as_ref() != Some(&expected_value) {
        return Err(demand_mismatch("query-predicate"));
    }
    if read.table.as_deref() != Some(expected.table.as_str()) {
        return Err(demand_mismatch("query-table"));
    }
    if read.order != order {
        return Err(demand_mismatch("query-order"));
    }
    if read.limit != limit {
        return Err(demand_mismatch("query-limit"));
    }
    if read.result_count != result_count {
        return Err(demand_mismatch("query-result-count"));
    }
    if read.boundary != boundary {
        return Err(demand_mismatch("query-boundary"));
    }
    let ids = rows
        .iter()
        .map(|row| row.get("_id").and_then(Value::as_str).map(str::to_owned))
        .collect::<Option<Vec<_>>>()
        .ok_or_else(|| demand_mismatch("query-row-id"))?;
    if read.rows != ids {
        return Err(demand_mismatch("query-row-ids"));
    }
    Ok(())
}

fn registration_relation_filters(
    parent: &Value,
    join: &[crate::manifest::JoinEquality],
) -> Option<Vec<FilterExpr>> {
    join.iter()
        .map(|equality| {
            let value = parent
                .get(&equality.root_field)
                .cloned()
                .unwrap_or(Value::Null);
            (!value.is_null()).then(|| FilterExpr {
                field: equality.joined_field.clone(),
                op: FilterOp::Eq,
                value: ValueExpr::Literal(value),
            })
        })
        .collect()
}

fn registration_row_key(
    table: &str,
    row: &Value,
) -> Result<GraphRowKeyV1, GraphDemandTimeRefusalReasonV1> {
    Ok(GraphRowKeyV1 {
        table: table.to_owned(),
        id: row
            .get("_id")
            .and_then(Value::as_str)
            .ok_or(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch)?
            .to_owned(),
    })
}

fn registration_window<'a>(
    demand: &'a GraphSubscriptionRegistrationDemandV1,
    node_id: &str,
    parent_key: Option<&GraphRowKeyV1>,
) -> Result<&'a crate::manifest::GraphWindowIdentityV1, GraphDemandTimeRefusalReasonV1> {
    demand
        .windows
        .iter()
        .find(|window| window.node_id == node_id)
        .and_then(|window| {
            window
                .intervals
                .iter()
                .find(|interval| interval.parent_key.as_ref() == parent_key)
        })
        .map(|interval| &interval.window)
        .ok_or(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch)
}

fn registration_index_order(
    schema: &SchemaManifest,
    table: &str,
    index: &str,
) -> Result<Vec<OrderExpr>, GraphDemandTimeRefusalReasonV1> {
    if index == "by_id" {
        return Ok(Vec::new());
    }
    schema
        .tables
        .iter()
        .find(|candidate| candidate.name == table)
        .and_then(|table| {
            table
                .indexes
                .iter()
                .find(|candidate| candidate.name == index)
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
                .collect()
        })
        .ok_or(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch)
}

fn registration_value_digest(
    domain: &[u8],
    value: &Value,
) -> Result<Sha256V1, GraphDemandTimeRefusalReasonV1> {
    let canonical = snapback_types::rqs_contract::jcs(value)
        .map_err(|_| GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch)?;
    let mut hasher = Sha256::new();
    hasher.update(domain);
    hasher.update(canonical.as_bytes());
    Sha256V1::new(format!("sha256:{:x}", hasher.finalize()))
        .map_err(|_| GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch)
}

fn registration_bind_all_probe(
    filters: &mut [FilterExpr],
    argument_id: Option<&str>,
    value: &Value,
) {
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

fn exact_parent_fact_set(
    facts: &[&GraphRegistrationFact<'_>],
    expected: &BTreeSet<GraphRowKeyV1>,
    parent_key: impl Fn(&GraphCapturedDependencyV1) -> Option<&GraphRowKeyV1>,
) -> Result<(), GraphDemandTimeRefusalReasonV1> {
    let actual = facts
        .iter()
        .filter_map(|fact| parent_key(&fact.graph.dependency).cloned())
        .collect::<Vec<_>>();
    if actual.len() != expected.len()
        || actual.iter().cloned().collect::<BTreeSet<_>>() != *expected
    {
        return Err(demand_mismatch("parent-key-set"));
    }
    Ok(())
}

type RegistrationRows = BTreeMap<GraphRowKeyV1, Value>;

fn insert_registration_rows(
    target: &mut RegistrationRows,
    table: &str,
    rows: &[Value],
) -> Result<(), GraphDemandTimeRefusalReasonV1> {
    for row in rows {
        let key = registration_row_key(table, row)?;
        match target.entry(key) {
            std::collections::btree_map::Entry::Vacant(entry) => {
                entry.insert(row.clone());
            }
            std::collections::btree_map::Entry::Occupied(entry) if entry.get() == row => {}
            std::collections::btree_map::Entry::Occupied(_) => {
                return Err(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch);
            }
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn attest_membership_fact(
    carrier: &GraphQueryCarrierV1,
    schema: &SchemaManifest,
    demand: &GraphSubscriptionRegistrationDemandV1,
    node: &GraphNodeV1,
    mode: &GraphExistsModeV1,
    edge: &GraphEdgeV1,
    filters: &[FilterExpr],
    argument_id: Option<&str>,
    parent_rows: &RegistrationRows,
    fact: &GraphRegistrationFact<'_>,
) -> Result<bool, GraphDemandTimeRefusalReasonV1> {
    let GraphCapturedDependencyV1::Membership {
        parent_key,
        argument_id: captured_argument_id,
        argument_digest,
        matched_count,
        complete: true,
        ..
    } = &fact.graph.dependency
    else {
        return Err(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch);
    };
    let parent = parent_rows
        .get(parent_key)
        .ok_or(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch)?;
    let probes = match mode {
        GraphExistsModeV1::Exists => {
            if captured_argument_id.is_some() || argument_digest.is_some() {
                return Err(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch);
            }
            vec![Value::Null]
        }
        GraphExistsModeV1::All => {
            if captured_argument_id.as_deref() != argument_id {
                return Err(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch);
            }
            let argument_id =
                argument_id.ok_or(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch)?;
            let argument_value = demand
                .input
                .args
                .get(argument_id)
                .ok_or(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch)?;
            if argument_digest.as_ref()
                != Some(&registration_value_digest(
                    b"snapback:g0-corpus-argument:v1:",
                    argument_value,
                )?)
            {
                return Err(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch);
            }
            let values = argument_value
                .as_array()
                .ok_or(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch)?;
            let mut canonical = BTreeMap::new();
            for value in values {
                canonical
                    .entry(
                        snapback_types::rqs_contract::jcs(value)
                            .map_err(|_| GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch)?,
                    )
                    .or_insert_with(|| value.clone());
            }
            canonical.into_values().collect::<Vec<_>>()
        }
    };
    let records = registration_query_records(fact)?;
    let mut cursor = 0_usize;
    let mut actual_matched = 0_u64;
    let relation_join = match edge {
        GraphEdgeV1::Direct(edge) => edge.join_on.as_slice(),
        GraphEdgeV1::Through(edge) => edge.parent_join.as_slice(),
    };
    let Some(parent_relation) = registration_relation_filters(parent, relation_join) else {
        if !records.is_empty() || *matched_count != 0 {
            return Err(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch);
        }
        return Ok(matches!(mode, GraphExistsModeV1::All) && probes.is_empty());
    };
    let required_matches = u64::try_from(probes.len())
        .map_err(|_| GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch)?;
    for probe in probes {
        let mut probe_filters = filters.to_vec();
        if matches!(mode, GraphExistsModeV1::All) {
            registration_bind_all_probe(&mut probe_filters, argument_id, &probe);
        }
        let found = match edge {
            GraphEdgeV1::Direct(edge) => {
                let mut relation = parent_relation.clone();
                relation.extend(probe_filters);
                let expected = registration_query_plan(
                    &edge.table,
                    &edge.visibility,
                    relation,
                    Vec::new(),
                    1,
                    &edge.access_index,
                    demand,
                )?;
                let (_, read, supplied, rows) = records
                    .get(cursor)
                    .ok_or(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch)?;
                registration_query_is_exact(read, supplied, rows, &expected)?;
                cursor += 1;
                !rows.is_empty()
            }
            GraphEdgeV1::Through(edge) => {
                let cap = carrier
                    .normalized_plan
                    .query_cost
                    .graph
                    .nodes
                    .iter()
                    .find(|cost| cost.node_id == node.node_id())
                    .and_then(|cost| cost.max_children_per_parent)
                    .ok_or(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch)?;
                let mut relation = parent_relation.clone();
                relation.extend(probe_filters);
                let edge_order = registration_index_order(schema, &edge.table, &edge.parent_index)?;
                let expected = registration_query_plan(
                    &edge.table,
                    &edge.visibility,
                    relation,
                    edge_order,
                    cap,
                    &edge.parent_index,
                    demand,
                )?;
                let (_, read, supplied, edge_rows) = records
                    .get(cursor)
                    .ok_or(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch)?;
                registration_query_is_exact(read, supplied, edge_rows, &expected)?;
                cursor += 1;
                let mut found = false;
                for edge_row in *edge_rows {
                    let Some(target_filters) =
                        registration_relation_filters(edge_row, &edge.target_join)
                    else {
                        continue;
                    };
                    let expected = registration_query_plan(
                        &edge.target_table,
                        &edge.target_visibility,
                        target_filters,
                        Vec::new(),
                        1,
                        &edge.target_index,
                        demand,
                    )?;
                    let (_, read, supplied, target_rows) = records
                        .get(cursor)
                        .ok_or(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch)?;
                    registration_query_is_exact(read, supplied, target_rows, &expected)?;
                    cursor += 1;
                    if !target_rows.is_empty() {
                        found = true;
                        break;
                    }
                }
                found
            }
        };
        if !found {
            break;
        }
        actual_matched = actual_matched
            .checked_add(1)
            .ok_or(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch)?;
    }
    if cursor != records.len() || actual_matched != *matched_count {
        return Err(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch);
    }
    Ok(match mode {
        GraphExistsModeV1::Exists => actual_matched == 1,
        GraphExistsModeV1::All => actual_matched == required_matches,
    })
}

#[allow(clippy::too_many_arguments)]
fn attest_principal_facts(
    demand: &GraphSubscriptionRegistrationDemandV1,
    _node: &GraphNodeV1,
    table: &str,
    visibility: &TableVisibilityV1,
    parent_join: &[crate::manifest::JoinEquality],
    principal_field: &str,
    access_index: &str,
    binding: Option<&crate::manifest::GraphPrincipalBindingV1>,
    filters: &[FilterExpr],
    parent_rows: &RegistrationRows,
    facts: &[&GraphRegistrationFact<'_>],
    node_output: &mut RegistrationRows,
) -> Result<(), GraphDemandTimeRefusalReasonV1> {
    let expected_parents = parent_rows.keys().cloned().collect::<BTreeSet<_>>();
    exact_parent_fact_set(facts, &expected_parents, |dependency| match dependency {
        GraphCapturedDependencyV1::PrincipalField {
            table: captured_table,
            field,
            parent_key: Some(parent_key),
            ..
        } if captured_table == table && field == principal_field => Some(parent_key),
        _ => None,
    })?;
    let auth_user = demand
        .input
        .auth
        .user_id
        .as_deref()
        .ok_or(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch)?;
    let mut principal = Some(auth_user.to_owned());
    if let Some(binding) = binding {
        let principal_fact = facts
            .iter()
            .find(|fact| {
                matches!(
                    &fact.graph.dependency,
                    GraphCapturedDependencyV1::PrincipalField {
                        table,
                        field,
                        parent_key: None,
                        ..
                    } if table == &binding.table && field == &binding.principal_field
                )
            })
            .ok_or(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch)?;
        let records = registration_query_records(principal_fact)?;
        if records.len() != 1 {
            return Err(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch);
        }
        let expected = registration_query_plan(
            &binding.table,
            &binding.visibility,
            vec![FilterExpr {
                field: binding.principal_field.clone(),
                op: FilterOp::Eq,
                value: ValueExpr::Literal(Value::String(auth_user.to_owned())),
            }],
            Vec::new(),
            1,
            &binding.unique_index,
            demand,
        )?;
        let (_, read, supplied, rows) = &records[0];
        registration_query_is_exact(read, supplied, rows, &expected)?;
        let GraphCapturedDependencyV1::PrincipalField {
            value_digest,
            found,
            ..
        } = &principal_fact.graph.dependency
        else {
            unreachable!()
        };
        if value_digest
            != &registration_value_digest(
                b"snapback:g0-corpus-principal-value:v1:",
                &Value::String(auth_user.to_owned()),
            )?
            || *found != !rows.is_empty()
        {
            return Err(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch);
        }
        principal = rows
            .first()
            .and_then(|row| row.get(&binding.value_field))
            .and_then(Value::as_str)
            .map(str::to_owned);
        let value_fact = facts.iter().find(|fact| {
            matches!(
                &fact.graph.dependency,
                GraphCapturedDependencyV1::PrincipalField {
                    table,
                    field,
                    parent_key: None,
                    ..
                } if table == &binding.table && field == &binding.value_field
            )
        });
        match (principal.as_ref(), value_fact) {
            (Some(value), Some(value_fact))
                if registration_query_records(value_fact)?.is_empty()
                    && matches!(
                        &value_fact.graph.dependency,
                        GraphCapturedDependencyV1::PrincipalField {
                            value_digest,
                            found: true,
                            ..
                        } if value_digest == &registration_value_digest(
                            b"snapback:g0-corpus-principal-value:v1:",
                            &Value::String(value.clone()),
                        )?
                    ) => {}
            (None, None) => {}
            _ => return Err(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch),
        }
    }

    for parent_key in expected_parents {
        let fact = facts
            .iter()
            .find(|fact| {
                matches!(
                    &fact.graph.dependency,
                    GraphCapturedDependencyV1::PrincipalField {
                        table: captured_table,
                        field,
                        parent_key: Some(captured_parent),
                        ..
                    } if captured_table == table
                        && field == principal_field
                        && captured_parent == &parent_key
                )
            })
            .ok_or(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch)?;
        let parent = parent_rows
            .get(&parent_key)
            .ok_or(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch)?;
        let records = registration_query_records(fact)?;
        let GraphCapturedDependencyV1::PrincipalField {
            value_digest,
            found,
            ..
        } = &fact.graph.dependency
        else {
            unreachable!()
        };
        let Some(principal) = principal.as_ref() else {
            if *found || !records.is_empty() {
                return Err(demand_mismatch("principal-unbound-parent"));
            }
            continue;
        };
        if value_digest
            != &registration_value_digest(
                b"snapback:g0-corpus-principal-value:v1:",
                &Value::String(principal.clone()),
            )?
        {
            return Err(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch);
        }
        if let Some(mut relation) = registration_relation_filters(parent, parent_join) {
            if records.len() != 1 {
                return Err(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch);
            }
            relation.push(FilterExpr {
                field: principal_field.to_owned(),
                op: FilterOp::Eq,
                value: ValueExpr::Literal(Value::String(principal.clone())),
            });
            relation.extend(filters.to_vec());
            let expected = registration_query_plan(
                table,
                visibility,
                relation,
                Vec::new(),
                1,
                access_index,
                demand,
            )?;
            let (_, read, supplied, rows) = &records[0];
            registration_query_is_exact(read, supplied, rows, &expected)?;
            if *found != !rows.is_empty() {
                return Err(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch);
            }
            insert_registration_rows(node_output, table, rows)?;
        } else if !records.is_empty() || *found {
            return Err(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch);
        }
    }
    Ok(())
}

fn attest_registration_semantics(
    carrier: &GraphQueryCarrierV1,
    schema: &SchemaManifest,
    demand: &GraphSubscriptionRegistrationDemandV1,
    facts: &[GraphRegistrationFact<'_>],
) -> Result<(Vec<Vec<GraphRowKeyV1>>, Sha256V1, Sha256V1, Sha256V1), GraphDemandTimeRefusalReasonV1>
{
    let mut by_node = BTreeMap::<String, Vec<&GraphRegistrationFact<'_>>>::new();
    for fact in facts {
        registration_query_rows_are_attested(fact)?;
        by_node
            .entry(fact.graph.node_id.clone())
            .or_default()
            .push(fact);
    }
    let mut outputs = BTreeMap::<String, RegistrationRows>::new();
    let mut closures = vec![Vec::new(); carrier.normalized_plan.nodes.len()];
    for (node_index, node) in carrier.normalized_plan.nodes.iter().enumerate() {
        let node_facts = by_node
            .get(node.node_id())
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        let parent_rows = node
            .parent_node_id()
            .map(|parent| outputs.get(parent).cloned().unwrap_or_default())
            .unwrap_or_default();
        let expected_parents = parent_rows.keys().cloned().collect::<BTreeSet<_>>();
        closures[node_index] = expected_parents.iter().cloned().collect();
        let mut node_output = RegistrationRows::new();
        match node {
            GraphNodeV1::RootWindow {
                table,
                visibility,
                filters,
                access_index,
                order,
                ..
            } => {
                if node_facts.len() != 1 {
                    return Err(demand_mismatch("root-window-fact-count"));
                }
                let GraphCapturedDependencyV1::RootRange {
                    direction: Some(direction),
                    lower: Some(lower),
                    upper: Some(upper),
                    limit,
                    ..
                } = &node_facts[0].graph.dependency
                else {
                    return Err(demand_mismatch("root-window-range"));
                };
                let window = registration_window(demand, node.node_id(), None)?;
                if direction != &window.direction
                    || lower != &window.lower
                    || upper != &window.upper
                    || *limit != window.take
                    || window.order != *order
                {
                    return Err(demand_mismatch("root-window-order"));
                }
                let records = registration_query_records(node_facts[0])?;
                if records.len() != 1 {
                    return Err(demand_mismatch("root-window-query-count"));
                }
                let (_, read, supplied, rows) = &records[0];
                let expected = registration_query_plan(
                    table,
                    visibility,
                    filters.clone(),
                    order.clone(),
                    *limit,
                    access_index,
                    demand,
                )?;
                registration_query_is_exact(read, supplied, rows, &expected)?;
                insert_registration_rows(&mut node_output, table, rows)?;
            }
            GraphNodeV1::EqualityToOne {
                table,
                visibility,
                join_on,
                access_index,
                filters,
                ..
            } => {
                exact_parent_fact_set(
                    node_facts,
                    &expected_parents,
                    |dependency| match dependency {
                        GraphCapturedDependencyV1::ParentPoint { parent_key, .. }
                        | GraphCapturedDependencyV1::ParentLookupSkipped { parent_key, .. } => {
                            Some(parent_key)
                        }
                        _ => None,
                    },
                )?;
                for fact in node_facts {
                    let parent_key = match &fact.graph.dependency {
                        GraphCapturedDependencyV1::ParentPoint { parent_key, .. }
                        | GraphCapturedDependencyV1::ParentLookupSkipped { parent_key, .. } => {
                            parent_key
                        }
                        _ => return Err(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch),
                    };
                    let parent = parent_rows
                        .get(parent_key)
                        .ok_or(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch)?;
                    let relation = registration_relation_filters(parent, join_on);
                    let records = registration_query_records(fact)?;
                    match (&fact.graph.dependency, relation) {
                        (GraphCapturedDependencyV1::ParentLookupSkipped { .. }, None)
                            if records.is_empty() => {}
                        (
                            GraphCapturedDependencyV1::ParentPoint {
                                lookup_key,
                                child_key,
                                found,
                                row_version,
                                ..
                            },
                            Some(mut relation),
                        ) if records.len() == 1 => {
                            let expected_lookup = join_on
                                .iter()
                                .map(|join| parent.get(&join.root_field).cloned().unwrap())
                                .collect::<Vec<_>>();
                            if lookup_key != &expected_lookup {
                                return Err(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch);
                            }
                            relation.extend(filters.clone().unwrap_or_default());
                            let expected = registration_query_plan(
                                table,
                                visibility,
                                relation,
                                Vec::new(),
                                1,
                                access_index,
                                demand,
                            )?;
                            let (_, read, supplied, rows) = &records[0];
                            registration_query_is_exact(read, supplied, rows, &expected)?;
                            let actual_key = rows
                                .first()
                                .map(|row| registration_row_key(table, row))
                                .transpose()?;
                            let actual_version = rows
                                .first()
                                .and_then(|row| row.get("_version"))
                                .and_then(Value::as_u64);
                            if *found != !rows.is_empty()
                                || child_key != &actual_key
                                || row_version != &actual_version
                            {
                                return Err(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch);
                            }
                            insert_registration_rows(&mut node_output, table, rows)?;
                        }
                        _ => return Err(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch),
                    }
                }
            }
            GraphNodeV1::BoundedToMany {
                table,
                visibility,
                join_on,
                access_index,
                order,
                page,
                filters,
                ..
            } => {
                exact_parent_fact_set(
                    node_facts,
                    &expected_parents,
                    |dependency| match dependency {
                        GraphCapturedDependencyV1::ParentRange { parent_key, .. } => {
                            Some(parent_key)
                        }
                        _ => None,
                    },
                )?;
                for fact in node_facts {
                    let GraphCapturedDependencyV1::ParentRange {
                        parent_key,
                        predicate,
                        direction: Some(direction),
                        lower: Some(lower),
                        upper: Some(upper),
                        limit,
                        complete,
                        ..
                    } = &fact.graph.dependency
                    else {
                        return Err(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch);
                    };
                    let parent = parent_rows
                        .get(parent_key)
                        .ok_or(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch)?;
                    let literal_window;
                    let window = match page {
                        GraphChildPageV1::Demand(_) => {
                            registration_window(demand, node.node_id(), Some(parent_key))?
                        }
                        GraphChildPageV1::Literal(page) => {
                            literal_window = crate::manifest::GraphWindowIdentityV1 {
                                order: order.clone(),
                                direction: page.direction,
                                lower: page.lower.clone(),
                                upper: page.upper.clone(),
                                take: page.take,
                            };
                            &literal_window
                        }
                    };
                    if predicate.as_slice() != filters.as_deref().unwrap_or_default()
                        || direction != &window.direction
                        || lower != &window.lower
                        || upper != &window.upper
                        || *limit != window.take
                        || window.order != *order
                    {
                        return Err(demand_mismatch("child-window-order"));
                    }
                    let relation = registration_relation_filters(parent, join_on);
                    let records = registration_query_records(fact)?;
                    if let Some(mut relation) = relation {
                        if records.len() != 1 {
                            return Err(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch);
                        }
                        relation.extend(filters.clone().unwrap_or_default());
                        let expected = registration_query_plan(
                            table,
                            visibility,
                            relation,
                            order.clone(),
                            *limit,
                            access_index,
                            demand,
                        )?;
                        let (_, read, supplied, rows) = &records[0];
                        registration_query_is_exact(read, supplied, rows, &expected)?;
                        insert_registration_rows(&mut node_output, table, rows)?;
                    } else if !records.is_empty() || *complete {
                        return Err(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch);
                    }
                }
            }
            GraphNodeV1::ExistsSemiJoin {
                mode,
                edge,
                filters,
                argument_id,
                parent_node_id,
                ..
            } => {
                exact_parent_fact_set(
                    node_facts,
                    &expected_parents,
                    |dependency| match dependency {
                        GraphCapturedDependencyV1::Membership { parent_key, .. } => {
                            Some(parent_key)
                        }
                        _ => None,
                    },
                )?;
                let mut retained_parents = RegistrationRows::new();
                for fact in node_facts {
                    let GraphCapturedDependencyV1::Membership { parent_key, .. } =
                        &fact.graph.dependency
                    else {
                        return Err(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch);
                    };
                    if attest_membership_fact(
                        carrier,
                        schema,
                        demand,
                        node,
                        mode,
                        edge,
                        filters.as_deref().unwrap_or_default(),
                        argument_id.as_deref(),
                        &parent_rows,
                        fact,
                    )? {
                        retained_parents.insert(
                            parent_key.clone(),
                            parent_rows
                                .get(parent_key)
                                .ok_or(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch)?
                                .clone(),
                        );
                    }
                }
                // @ref LLP 0209#51-captured-vocabulary-by-normalized-node — a
                // predicate-only semi-join narrows the immediate parent
                // population before later sibling captures are attested.
                outputs.insert(parent_node_id.clone(), retained_parents);
            }
            GraphNodeV1::PrincipalBound {
                table,
                visibility,
                parent_join,
                principal_field,
                access_index,
                binding,
                filters,
                ..
            } => {
                attest_principal_facts(
                    demand,
                    node,
                    table,
                    visibility,
                    parent_join,
                    principal_field,
                    access_index,
                    binding.as_ref(),
                    filters.as_deref().unwrap_or_default(),
                    &parent_rows,
                    node_facts,
                    &mut node_output,
                )?;
            }
            GraphNodeV1::SearchMembership { .. } => {
                if !node_facts.is_empty() {
                    return Err(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch);
                }
            }
            GraphNodeV1::ClosedProjection { .. } => {
                if node_facts.len() != 1
                    || !registration_query_records(node_facts[0])?.is_empty()
                    || !matches!(
                        node_facts[0].graph.dependency,
                        GraphCapturedDependencyV1::Projection { .. }
                    )
                {
                    return Err(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch);
                }
            }
        }
        outputs.insert(node.node_id().to_owned(), node_output);
    }

    let evaluated_parents = carrier
        .normalized_plan
        .nodes
        .iter()
        .enumerate()
        .filter_map(|(index, node)| {
            matches!(
                node,
                GraphNodeV1::BoundedToMany {
                    page: GraphChildPageV1::Demand(_),
                    ..
                }
            )
            .then(|| (node.node_id().to_owned(), closures[index].clone()))
        })
        .collect::<BTreeMap<_, _>>();
    let instance = graph_instance_identity_v1(
        carrier,
        &demand.args,
        demand.windows.clone(),
        &evaluated_parents,
    )?;
    if facts
        .iter()
        .any(|fact| fact.graph.instance_hash != instance.instance_hash)
    {
        return Err(demand_mismatch("instance-hash"));
    }

    let mut materialization_preimage = demand.materialization.preimage.clone();
    materialization_preimage.graph_instance_hash = instance.instance_hash.clone();
    if materialization_preimage.function.result_contract_hash
        != carrier.normalized_plan.result_contract_hash
    {
        return Err(demand_mismatch("result-contract-hash"));
    }
    let materialization = graph_materialization_identity_v1(materialization_preimage)?;
    if materialization != demand.materialization {
        return Err(demand_mismatch("materialization-hash"));
    }

    let declared_class2 = carrier
        .normalized_plan
        .authority_partition_rule
        .class2_inputs
        .iter()
        .map(|input| {
            (
                input.node_id.clone(),
                input.declaration_id.clone(),
                input.policy_identity.clone(),
            )
        })
        .collect::<BTreeSet<_>>();
    let supplied_class2 = demand
        .partition
        .preimage
        .class2
        .iter()
        .map(|input| {
            (
                input.node_id.clone(),
                input.declaration_id.clone(),
                input.policy_identity.clone(),
            )
        })
        .collect::<BTreeSet<_>>();
    let needs_class3 = carrier.normalized_plan.nodes.iter().any(|node| {
        node.authority().declared_class == crate::manifest::GraphAuthorityClassV1::PRINCIPAL_SCOPED
    });
    if declared_class2 != supplied_class2
        || demand.partition.preimage.class2.len() != supplied_class2.len()
        || needs_class3 != demand.partition.preimage.class3.is_some()
    {
        return Err(demand_mismatch("authority-partition-inputs"));
    }
    let mut partition_preimage = demand.partition.preimage.clone();
    partition_preimage.graph_plan_hash = carrier.plan_hash.clone();
    let partition = graph_authority_partition_identity_v1(partition_preimage)?;
    if partition != demand.partition
        || facts.iter().any(|fact| {
            matches!(
                &fact.graph.dependency,
                GraphCapturedDependencyV1::PrincipalField { partition_hash, .. }
                    if partition_hash != &partition.partition_hash
            )
        })
    {
        return Err(demand_mismatch("authority-partition-hash"));
    }
    Ok((
        closures,
        instance.instance_hash,
        materialization.materialization_hash,
        partition.partition_hash,
    ))
}

/// Validate evaluator-authored graph reads and mint the only object the graph
/// matcher consumes. G2-C routes serving through this same attestation seam;
/// raw evaluator reads never become matcher authority on their own.
pub fn attest_graph_subscription_dependencies(
    carrier: &GraphQueryCarrierV1,
    schema: &SchemaManifest,
    demand: &GraphSubscriptionRegistrationDemandV1,
    reads: &[CapturedReadDependency],
    attachments: &[GraphCapturedReadAttachmentV1],
    query_outputs: &[GraphCapturedQueryOutputV1],
) -> Result<RegisteredGraphSubscriptionDependenciesV1, GraphDemandTimeRefusalReasonV1> {
    let (facts, per_node_capture_cardinalities) =
        registration_facts(carrier, reads, attachments, query_outputs)?;
    let (parent_key_closure, instance_hash, materialization_hash, partition_hash) =
        attest_registration_semantics(carrier, schema, demand, &facts)?;
    Ok(RegisteredGraphSubscriptionDependenciesV1 {
        graph_plan_hash: carrier.plan_hash.clone(),
        instance_hash,
        materialization_hash,
        partition_hash,
        normalized_node_ids: carrier
            .normalized_plan
            .nodes
            .iter()
            .map(|node| node.node_id().to_owned())
            .collect(),
        per_node_capture_cardinalities,
        parent_key_closure,
        reads: reads.to_vec(),
        attachments: attachments.to_vec(),
    })
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
            graph: None,
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
                    graph: None,
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
        graph: None,
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
    live_subscription_match_decision(definition, input, read_dependencies, changes).outcome
}

pub fn live_subscription_match_decision(
    definition: &FunctionDefinition,
    input: &HandlerInput,
    read_dependencies: &[CapturedReadDependency],
    changes: &[ChangedRow],
) -> LiveMatchDecisionV1 {
    live_subscription_match_decision_with_optional_graph_registration(
        definition,
        input,
        read_dependencies,
        None,
        changes,
    )
}

/// Serving bridge for the graph arm. The registered value is sync-attested;
/// this function deliberately has no raw-read overload.
pub fn live_subscription_match_decision_with_graph_registration(
    definition: &FunctionDefinition,
    input: &HandlerInput,
    registration: &RegisteredGraphSubscriptionDependenciesV1,
    changes: &[ChangedRow],
) -> LiveMatchDecisionV1 {
    live_subscription_match_decision_with_optional_graph_registration(
        definition,
        input,
        registration.reads(),
        Some(registration),
        changes,
    )
}

fn live_subscription_match_decision_with_optional_graph_registration(
    definition: &FunctionDefinition,
    input: &HandlerInput,
    read_dependencies: &[CapturedReadDependency],
    graph_registration: Option<&RegisteredGraphSubscriptionDependenciesV1>,
    changes: &[ChangedRow],
) -> LiveMatchDecisionV1 {
    if let FunctionRuntime::HostPlan(HandlerPlan::GraphQuery(carrier)) = &definition.runtime {
        let Some(registration) = graph_registration else {
            return LiveMatchDecisionV1 {
                outcome: LiveMatchOutcome::ConservativeFallback,
                graph_nodes: Vec::new(),
            };
        };
        return graph_subscription_match_decision(carrier, input, registration, changes);
    }
    LiveMatchDecisionV1 {
        outcome: live_subscription_match_outcome_non_graph(
            definition,
            input,
            read_dependencies,
            changes,
        ),
        graph_nodes: Vec::new(),
    }
}

fn live_subscription_match_outcome_non_graph(
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
    // Direct callers cannot reach this arm through the public decision path;
    // keep it conservative as defense in depth.
    if matches!(
        definition.runtime,
        FunctionRuntime::HostPlan(HandlerPlan::GraphQuery(_))
    ) {
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
        FunctionRuntime::HostPlan(HandlerPlan::GraphQuery(_))
        | FunctionRuntime::HostPlan(HandlerPlan::Mutation(_))
        | FunctionRuntime::HostPlan(HandlerPlan::WriteWithActivity(_))
        | FunctionRuntime::HostPlan(HandlerPlan::Action(_)) => {
            LiveMatchOutcome::ConservativeFallback
        }
    }
}

struct GraphCaptureFact<'a> {
    graph: &'a GraphCapturedReadV1,
    ordinary: Vec<&'a CapturedReadDependency>,
}

fn graph_capture_facts(
    registration: &RegisteredGraphSubscriptionDependenciesV1,
) -> Option<Vec<GraphCaptureFact<'_>>> {
    registration
        .attachments
        .iter()
        .map(|attachment| {
            let graph = registration
                .reads
                .get(usize::try_from(attachment.graph_read_index).ok()?)?
                .graph
                .as_ref()?;
            let ordinary = attachment
                .ordinary_read_indices
                .iter()
                .map(|index| registration.reads.get(usize::try_from(*index).ok()?))
                .collect::<Option<Vec<_>>>()?;
            Some(GraphCaptureFact { graph, ordinary })
        })
        .collect()
}

fn graph_fact_parent_key(dependency: &GraphCapturedDependencyV1) -> Option<&GraphRowKeyV1> {
    match dependency {
        GraphCapturedDependencyV1::ParentPoint { parent_key, .. }
        | GraphCapturedDependencyV1::ParentLookupSkipped { parent_key, .. }
        | GraphCapturedDependencyV1::ParentRange { parent_key, .. }
        | GraphCapturedDependencyV1::Membership { parent_key, .. } => Some(parent_key),
        GraphCapturedDependencyV1::PrincipalField {
            parent_key: Some(parent_key),
            ..
        } => Some(parent_key),
        _ => None,
    }
}

fn graph_parent_key_closure_is_exact(
    facts: &[&GraphCaptureFact<'_>],
    expected: &[GraphRowKeyV1],
    permit_node_global_facts: bool,
) -> bool {
    let expected_set = expected.iter().cloned().collect::<BTreeSet<_>>();
    if expected_set.len() != expected.len() {
        return false;
    }
    let actual = facts
        .iter()
        .filter_map(|fact| graph_fact_parent_key(&fact.graph.dependency).cloned())
        .collect::<Vec<_>>();
    actual.len() == expected.len()
        && actual.into_iter().collect::<BTreeSet<_>>() == expected_set
        && (permit_node_global_facts || facts.len() == expected.len())
}

fn graph_query_companion<'a>(
    fact: &GraphCaptureFact<'a>,
) -> Option<(&'a CapturedReadDependency, QueryPlan)> {
    let mut queries = fact
        .ordinary
        .iter()
        .filter(|read| read.kind == CapturedReadKind::Query);
    let query = *queries.next()?;
    if queries.next().is_some() || query.version.is_none() {
        return None;
    }
    let plan = serde_json::from_value::<QueryPlan>(query.predicate.clone()?).ok()?;
    Some((query, plan))
}

fn query_has_exact_row_companions(
    fact: &GraphCaptureFact<'_>,
    query: &CapturedReadDependency,
) -> bool {
    let Some(table) = query.table.as_deref() else {
        return false;
    };
    let expected = query.rows.iter().cloned().collect::<BTreeSet<_>>();
    if expected.len() != query.rows.len() {
        return false;
    }
    let actual = fact
        .ordinary
        .iter()
        .filter(|read| read.kind == CapturedReadKind::Row)
        .filter_map(|read| {
            (read.table.as_deref() == Some(table) && read.version.is_some())
                .then(|| read.id.clone())
                .flatten()
        })
        .collect::<Vec<_>>();
    actual.len() == expected.len()
        && actual.into_iter().collect::<BTreeSet<_>>() == expected
        && fact.ordinary.iter().all(|read| match read.kind {
            CapturedReadKind::Query => true,
            CapturedReadKind::Row => {
                read.table.as_deref() == Some(table)
                    && read.id.as_ref().is_some_and(|id| expected.contains(id))
                    && read.version.is_some()
            }
            _ => false,
        })
}

fn graph_range_query_companion_is_complete(
    fact: &GraphCaptureFact<'_>,
    table: &str,
    index: &str,
    declared_order: &[OrderExpr],
    limit: u64,
    result_count: u64,
    complete: bool,
    boundary: Option<&crate::manifest::KeysetKeyV1>,
) -> bool {
    let Some((query, plan)) = graph_query_companion(fact) else {
        return false;
    };
    let expected_order = if declared_order.is_empty() {
        None
    } else {
        serde_json::to_value(declared_order).ok()
    };
    if query.table.as_deref() != Some(table)
        || plan.table != table
        || plan.indexed_by.as_deref() != (index != "by_id").then_some(index)
        || plan.order != declared_order
        || query.order != expected_order
        || plan.limit.and_then(|value| u64::try_from(value).ok()) != Some(limit)
        || query.limit.and_then(|value| u64::try_from(value).ok()) != Some(limit)
        || query
            .result_count
            .and_then(|count| u64::try_from(count).ok())
            != Some(result_count)
        || u64::try_from(query.rows.len()).ok() != Some(result_count)
        || !query_has_exact_row_companions(fact, query)
    {
        return false;
    }
    let real_boundary = query.boundary.as_ref().and_then(Value::as_object);
    if result_count == 0 {
        if real_boundary.is_some() || !complete {
            return false;
        }
    } else if real_boundary.is_none_or(|value| {
        let Some(first) = value.get("first") else {
            return true;
        };
        let Some(last) = value.get("last") else {
            return true;
        };
        compare_sort_keys(&plan, first, first).is_none()
            || compare_sort_keys(&plan, last, last).is_none()
    }) {
        return false;
    }
    if complete {
        boundary.is_none()
    } else {
        boundary.is_some_and(|boundary| {
            real_boundary
                .and_then(|value| value.get("last"))
                .is_some_and(|last| keyset_sort_key(boundary) == *last)
        })
    }
}

fn graph_node_capture_is_complete(
    node: &GraphNodeV1,
    facts: &[&GraphCaptureFact<'_>],
    expected_parent_keys: &[GraphRowKeyV1],
    input: &HandlerInput,
    identities_valid: bool,
) -> bool {
    if !identities_valid {
        return false;
    }
    let has_query = |fact: &&GraphCaptureFact<'_>| {
        fact.ordinary
            .iter()
            .any(|read| read.kind == CapturedReadKind::Query)
    };
    let query_rows_are_backed_by_points = |fact: &&GraphCaptureFact<'_>| {
        let queries = fact
            .ordinary
            .iter()
            .filter(|read| read.kind == CapturedReadKind::Query)
            .collect::<Vec<_>>();
        !queries.is_empty()
            && queries.iter().all(|query| {
                query.table.as_deref().is_some_and(|table| {
                    query.rows.iter().all(|id| {
                        fact.ordinary.iter().any(|read| {
                            read.kind == CapturedReadKind::Row
                                && read.table.as_deref() == Some(table)
                                && read.id.as_deref() == Some(id.as_str())
                                && read.version.is_some()
                        })
                    })
                })
            })
    };
    match node {
        GraphNodeV1::RootWindow { .. } => {
            facts.len() == 1
                && match &facts[0].graph.dependency {
                    GraphCapturedDependencyV1::RootRange {
                        table,
                        index,
                        order,
                        limit,
                        result_count,
                        boundary,
                        complete,
                        ..
                    } => {
                        graph_range_query_companion_is_complete(
                            facts[0],
                            table,
                            index,
                            order,
                            *limit,
                            *result_count,
                            *complete,
                            boundary.as_ref(),
                        ) && query_rows_are_backed_by_points(&facts[0])
                    }
                    _ => false,
                }
        }
        GraphNodeV1::EqualityToOne { .. } => {
            graph_parent_key_closure_is_exact(facts, expected_parent_keys, false)
                && facts.iter().all(|fact| match &fact.graph.dependency {
                    GraphCapturedDependencyV1::ParentPoint {
                        table,
                        child_key,
                        found,
                        row_version,
                        ..
                    } if *found => child_key.as_ref().is_some_and(|child_key| {
                        child_key.table == *table
                            && fact.ordinary.iter().any(|read| {
                                read.kind == CapturedReadKind::Row
                                    && read.table.as_deref() == Some(table.as_str())
                                    && read.id.as_deref() == Some(child_key.id.as_str())
                                    && read.version == *row_version
                            })
                    }),
                    // The shipped MissingRow carrier identifies only a
                    // physical `_id`, while graph unique points are commonly
                    // secondary-index keys and have no physical id on a miss.
                    // The equivalent empty Query is therefore the only honest
                    // absence dependency for those admitted points.
                    GraphCapturedDependencyV1::ParentPoint { found: false, .. } => {
                        has_query(fact) && query_rows_are_backed_by_points(fact)
                    }
                    GraphCapturedDependencyV1::ParentLookupSkipped { .. } => true,
                    _ => false,
                })
        }
        GraphNodeV1::BoundedToMany { .. } => {
            graph_parent_key_closure_is_exact(facts, expected_parent_keys, false)
                && facts.iter().all(|fact| match &fact.graph.dependency {
                    GraphCapturedDependencyV1::ParentRange {
                        table,
                        index,
                        order,
                        limit,
                        result_count,
                        boundary,
                        complete,
                        ..
                    } => {
                        graph_range_query_companion_is_complete(
                            fact,
                            table,
                            index,
                            order,
                            *limit,
                            *result_count,
                            *complete,
                            boundary.as_ref(),
                        ) && query_rows_are_backed_by_points(fact)
                    }
                    _ => false,
                })
        }
        GraphNodeV1::ExistsSemiJoin {
            mode,
            edge,
            argument_id,
            ..
        } => {
            graph_parent_key_closure_is_exact(facts, expected_parent_keys, false)
                && facts.iter().all(|fact| {
                    let GraphCapturedDependencyV1::Membership {
                        matched_count,
                        complete: true,
                        ..
                    } = &fact.graph.dependency
                    else {
                        return false;
                    };
                    let edge_table = match edge {
                        crate::manifest::GraphEdgeV1::Direct(edge) => edge.table.as_str(),
                        crate::manifest::GraphEdgeV1::Through(edge) => edge.table.as_str(),
                    };
                    let edge_query_count = fact
                        .ordinary
                        .iter()
                        .filter(|read| {
                            read.kind == CapturedReadKind::Query
                                && read.table.as_deref() == Some(edge_table)
                        })
                        .count() as u64;
                    let minimum_consulted_probes = match mode {
                        crate::manifest::GraphExistsModeV1::Exists => u64::from(*matched_count > 0),
                        crate::manifest::GraphExistsModeV1::All => {
                            let argument_count = argument_id
                                .as_ref()
                                .and_then(|argument_id| input.args.get(argument_id))
                                .and_then(Value::as_array)
                                .and_then(|values| {
                                    values
                                        .iter()
                                        .map(snapback_types::rqs_contract::jcs)
                                        .collect::<Result<BTreeSet<_>, _>>()
                                        .ok()
                                })
                                .map(|values| values.len() as u64);
                            let Some(argument_count) = argument_count else {
                                return false;
                            };
                            if *matched_count > argument_count {
                                return false;
                            }
                            matched_count.saturating_add(u64::from(
                                *matched_count > 0 && *matched_count < argument_count,
                            ))
                        }
                    };
                    edge_query_count >= minimum_consulted_probes
                        && (fact
                            .ordinary
                            .iter()
                            .all(|read| read.kind != CapturedReadKind::Query)
                            || query_rows_are_backed_by_points(fact))
                })
        }
        GraphNodeV1::PrincipalBound {
            table,
            principal_field,
            binding,
            ..
        } => {
            if input.auth.user_id.is_none() {
                return facts.is_empty();
            }
            if binding.is_none() && expected_parent_keys.is_empty() {
                return facts.is_empty();
            }
            if !graph_parent_key_closure_is_exact(facts, expected_parent_keys, true) {
                return false;
            }
            let auth_complete = facts
                .iter()
                .flat_map(|fact| fact.ordinary.iter())
                .filter(|read| {
                    read.kind == CapturedReadKind::Auth
                        && read.field.as_deref() == Some("userId")
                        && read.value.as_ref().and_then(Value::as_str)
                            == input.auth.user_id.as_deref()
                })
                .count()
                == 1;
            if !auth_complete
                || facts.iter().any(|fact| {
                    fact.ordinary
                        .iter()
                        .any(|read| read.kind == CapturedReadKind::Query)
                        && !query_rows_are_backed_by_points(fact)
                })
            {
                return false;
            }
            let target_found = facts
                .iter()
                .filter(|fact| {
                    matches!(
                        &fact.graph.dependency,
                        GraphCapturedDependencyV1::PrincipalField {
                            table: captured_table,
                            field,
                            found: true,
                            ..
                        } if captured_table == table && field == principal_field
                    )
                })
                .count();
            let target_rows = facts
                .iter()
                .flat_map(|fact| fact.ordinary.iter())
                .filter(|read| {
                    read.kind == CapturedReadKind::Row
                        && read.table.as_deref() == Some(table.as_str())
                        && read.version.is_some()
                })
                .count();
            if target_rows < target_found {
                return false;
            }
            let binding_complete =
                binding.as_ref().is_none_or(|binding| {
                    let principal = facts.iter().find(|fact| {
                        matches!(
                            &fact.graph.dependency,
                            GraphCapturedDependencyV1::PrincipalField {
                                table,
                                field,
                                ..
                            } if table == &binding.table && field == &binding.principal_field
                        )
                    });
                    principal.is_some()
                        && principal.is_some_and(|principal| match &principal.graph.dependency {
                            GraphCapturedDependencyV1::PrincipalField { found: true, .. } => {
                                let value_field = facts.iter().any(|fact| {
                                matches!(
                                    &fact.graph.dependency,
                                    GraphCapturedDependencyV1::PrincipalField {
                                        table,
                                        field,
                                        ..
                                    } if table == &binding.table && field == &binding.value_field
                                )
                            });
                                let row = facts.iter().flat_map(|fact| fact.ordinary.iter()).any(
                                    |read| {
                                        read.kind == CapturedReadKind::Row
                                            && read.table.as_deref() == Some(binding.table.as_str())
                                            && read.version.is_some()
                                    },
                                );
                                value_field && row
                            }
                            GraphCapturedDependencyV1::PrincipalField { found: false, .. } => true,
                            _ => false,
                        })
                });
            if !binding_complete {
                return false;
            }
            let binding_found = binding.as_ref().is_none_or(|binding| {
                facts.iter().any(|fact| {
                    matches!(
                        &fact.graph.dependency,
                        GraphCapturedDependencyV1::PrincipalField {
                            table,
                            field,
                            found: true,
                            ..
                        } if table == &binding.table && field == &binding.principal_field
                    )
                })
            });
            let expected_targets = if binding_found {
                expected_parent_keys.len()
            } else {
                0
            };
            let target_count = facts
                .iter()
                .filter(|fact| {
                    matches!(
                        &fact.graph.dependency,
                        GraphCapturedDependencyV1::PrincipalField {
                            table: captured_table,
                            field,
                            ..
                        } if captured_table == table && field == principal_field
                    )
                })
                .count();
            expected_targets == target_count
        }
        GraphNodeV1::SearchMembership {
            invalidation_tables,
            ..
        } => {
            let captured = facts
                .iter()
                .filter_map(|fact| match &fact.graph.dependency {
                    GraphCapturedDependencyV1::SearchTable { table, .. } => Some(table.clone()),
                    _ => None,
                })
                .collect::<BTreeSet<_>>();
            captured.len() == facts.len()
                && captured == invalidation_tables.iter().cloned().collect::<BTreeSet<_>>()
        }
        GraphNodeV1::ClosedProjection { .. } => {
            facts.len() == 1
                && matches!(
                    facts[0].graph.dependency,
                    GraphCapturedDependencyV1::Projection { .. }
                )
        }
    }
}

fn keyset_sort_key(key: &crate::manifest::KeysetKeyV1) -> Value {
    let mut values = key
        .entries
        .iter()
        .map(|(_, value)| value.clone())
        .collect::<Vec<_>>();
    values.push(Value::String(key.id.clone()));
    Value::Array(values)
}

fn graph_traversal_plan(plan: &QueryPlan, direction: GraphDirectionV1) -> QueryPlan {
    let mut plan = plan.clone();
    if direction == GraphDirectionV1::Backward {
        for component in &mut plan.order {
            component.direction = match component.direction {
                OrderDirection::Asc => OrderDirection::Desc,
                OrderDirection::Desc => OrderDirection::Asc,
            };
        }
    }
    plan
}

fn graph_interval_contains(
    plan: &QueryPlan,
    row_key: &Value,
    lower: &GraphIntervalEndV1,
    upper: &GraphIntervalEndV1,
) -> Option<bool> {
    let after_lower = match lower {
        GraphIntervalEndV1::Unbounded => true,
        GraphIntervalEndV1::Inclusive { key } => {
            compare_sort_keys(plan, row_key, &keyset_sort_key(key))? != Ordering::Less
        }
        GraphIntervalEndV1::Exclusive { key } => {
            compare_sort_keys(plan, row_key, &keyset_sort_key(key))? == Ordering::Greater
        }
    };
    let before_upper = match upper {
        GraphIntervalEndV1::Unbounded => true,
        GraphIntervalEndV1::Inclusive { key } => {
            compare_sort_keys(plan, row_key, &keyset_sort_key(key))? != Ordering::Greater
        }
        GraphIntervalEndV1::Exclusive { key } => {
            compare_sort_keys(plan, row_key, &keyset_sort_key(key))? == Ordering::Less
        }
    };
    Some(after_lower && before_upper)
}

fn graph_range_update_may_have_moved(plan: &QueryPlan, change: &ChangedRow) -> bool {
    change.op == ChangeOp::Update
        && (change.changed_fields.is_empty()
            || plan.order.iter().any(|order| {
                system_field_changes_on_update(&order.field)
                    || change
                        .changed_fields
                        .iter()
                        .any(|field| field == &order.field)
            }))
}

#[derive(Debug)]
struct GraphFactMatchDecision {
    outcome: LiveMatchOutcome,
    tested_rows: BTreeSet<(String, String)>,
}

fn graph_outcome_rank(outcome: LiveMatchOutcome) -> u8 {
    match outcome {
        LiveMatchOutcome::Skip => 0,
        LiveMatchOutcome::Match => 1,
        LiveMatchOutcome::ConservativeFallback => 2,
    }
}

fn captured_query_fact_decision(
    fact: &GraphCaptureFact<'_>,
    input: &HandlerInput,
    changes: &[ChangedRow],
    direction: GraphDirectionV1,
    lower: &GraphIntervalEndV1,
    upper: &GraphIntervalEndV1,
    complete: bool,
) -> GraphFactMatchDecision {
    // @ref LLP 0209#24-plan-instance-and-contextual-materialization-identity —
    // range disjointness uses the executed direction and exact named interval,
    // while the ordinary companion supplies the real returned-page endpoints.
    let Some((query, declared_plan)) = graph_query_companion(fact) else {
        return GraphFactMatchDecision {
            outcome: LiveMatchOutcome::ConservativeFallback,
            tested_rows: BTreeSet::new(),
        };
    };
    let plan = graph_traversal_plan(&declared_plan, direction);
    let page_boundary = query.boundary.as_ref().and_then(Value::as_object);
    let ordered_page = page_boundary.and_then(|boundary| {
        let first = boundary.get("first")?;
        let last = boundary.get("last")?;
        (compare_sort_keys(&plan, first, last)? != Ordering::Greater).then_some((first, last))
    });
    let mut tested_rows = BTreeSet::new();
    let mut outcome = LiveMatchOutcome::Skip;
    for change in changes.iter().filter(|change| change.table == plan.table) {
        tested_rows.insert((change.table.clone(), change.id.clone()));
        let change_outcome = if change.op == ChangeOp::Delete {
            // A bounded edge delete is decidable from the captured membership
            // itself: removing a returned row wakes. Absence proves the edge
            // is outside this parent only for a complete range; a truncated
            // range did not register its lookahead row.
            if query.rows.iter().any(|id| id == &change.id) {
                LiveMatchOutcome::Match
            } else if complete {
                LiveMatchOutcome::Skip
            } else {
                LiveMatchOutcome::ConservativeFallback
            }
        } else {
            let Some(row) = change.row.as_ref() else {
                outcome = LiveMatchOutcome::ConservativeFallback;
                continue;
            };
            match row_matches_query_filters(&plan, input, row) {
                None => LiveMatchOutcome::ConservativeFallback,
                Some(false) if query.rows.iter().any(|id| id == &change.id) => {
                    LiveMatchOutcome::Match
                }
                Some(false) if update_may_have_changed_query_membership(&plan, change) => {
                    LiveMatchOutcome::ConservativeFallback
                }
                Some(false) => LiveMatchOutcome::Skip,
                Some(true) if query.rows.iter().any(|id| id == &change.id) => {
                    LiveMatchOutcome::Match
                }
                Some(true) => {
                    let Some(row_key) = sort_key(&plan, row) else {
                        outcome = LiveMatchOutcome::ConservativeFallback;
                        continue;
                    };
                    match graph_interval_contains(&plan, &row_key, lower, upper) {
                        None => LiveMatchOutcome::ConservativeFallback,
                        Some(false) if graph_range_update_may_have_moved(&plan, change) => {
                            LiveMatchOutcome::ConservativeFallback
                        }
                        Some(false) => LiveMatchOutcome::Skip,
                        Some(true) if complete => LiveMatchOutcome::Match,
                        Some(true) => match ordered_page {
                            Some((first, last)) => match (
                                compare_sort_keys(&plan, &row_key, first),
                                compare_sort_keys(&plan, &row_key, last),
                            ) {
                                // The evaluator executes a take+1 read but
                                // registers only the returned page rows. A
                                // matching write before/inside the real page
                                // can enter the result; one after `last` but
                                // inside the exact interval can replace the
                                // unregistered lookahead row. Both affect the
                                // graph observation (`hasMore`/continuation),
                                // so every comparable in-interval write wakes.
                                (Some(_to_first), Some(_to_last)) => LiveMatchOutcome::Match,
                                _ => LiveMatchOutcome::ConservativeFallback,
                            },
                            None => LiveMatchOutcome::ConservativeFallback,
                        },
                    }
                }
            }
        };
        if graph_outcome_rank(change_outcome) > graph_outcome_rank(outcome) {
            outcome = change_outcome;
        }
    }
    GraphFactMatchDecision {
        outcome,
        tested_rows,
    }
}

fn captured_principal_digest(value: &Value) -> Option<String> {
    let canonical = snapback_types::rqs_contract::jcs(value).ok()?;
    let mut hasher = Sha256::new();
    hasher.update(b"snapback:g0-corpus-principal-value:v1:");
    hasher.update(canonical.as_bytes());
    Some(format!("sha256:{:x}", hasher.finalize()))
}

fn graph_fact_decision(
    fact: &GraphCaptureFact<'_>,
    input: &HandlerInput,
    changes: &[ChangedRow],
) -> GraphFactMatchDecision {
    let table_decision =
        |tables: &BTreeSet<&str>, outcome: LiveMatchOutcome| GraphFactMatchDecision {
            outcome,
            tested_rows: changes
                .iter()
                .filter(|change| tables.contains(change.table.as_str()))
                .map(|change| (change.table.clone(), change.id.clone()))
                .collect(),
        };
    match &fact.graph.dependency {
        GraphCapturedDependencyV1::RootRange {
            direction: Some(direction),
            lower: Some(lower),
            upper: Some(upper),
            complete,
            ..
        }
        | GraphCapturedDependencyV1::ParentRange {
            direction: Some(direction),
            lower: Some(lower),
            upper: Some(upper),
            complete,
            ..
        } => {
            captured_query_fact_decision(fact, input, changes, *direction, lower, upper, *complete)
        }
        GraphCapturedDependencyV1::RootRange { .. }
        | GraphCapturedDependencyV1::ParentRange { .. } => GraphFactMatchDecision {
            outcome: LiveMatchOutcome::ConservativeFallback,
            tested_rows: BTreeSet::new(),
        },
        GraphCapturedDependencyV1::ParentPoint {
            table,
            child_key: Some(child_key),
            found: true,
            ..
        } => table_decision(
            &BTreeSet::from([table.as_str()]),
            bool_outcome(
                changes
                    .iter()
                    .any(|change| change.table == *table && change.id == child_key.id),
            ),
        ),
        GraphCapturedDependencyV1::ParentPoint { found: false, .. } => {
            let Some((query, plan)) = graph_query_companion(fact) else {
                return GraphFactMatchDecision {
                    outcome: LiveMatchOutcome::ConservativeFallback,
                    tested_rows: BTreeSet::new(),
                };
            };
            let mut tested_rows = BTreeSet::new();
            let outcome = changes
                .iter()
                .filter(|change| change.table == plan.table)
                .map(|change| {
                    tested_rows.insert((change.table.clone(), change.id.clone()));
                    query_plan_change_outcome(&plan, input, change, Some(query))
                })
                .max_by_key(|outcome| graph_outcome_rank(*outcome))
                .unwrap_or(LiveMatchOutcome::Skip);
            GraphFactMatchDecision {
                outcome,
                tested_rows,
            }
        }
        GraphCapturedDependencyV1::ParentPoint { .. } => GraphFactMatchDecision {
            outcome: LiveMatchOutcome::ConservativeFallback,
            tested_rows: BTreeSet::new(),
        },
        GraphCapturedDependencyV1::ParentLookupSkipped { .. }
        | GraphCapturedDependencyV1::Projection { .. } => GraphFactMatchDecision {
            outcome: LiveMatchOutcome::Skip,
            tested_rows: BTreeSet::new(),
        },
        GraphCapturedDependencyV1::Membership {
            tables, complete, ..
        } => {
            if !complete {
                GraphFactMatchDecision {
                    outcome: LiveMatchOutcome::ConservativeFallback,
                    tested_rows: BTreeSet::new(),
                }
            } else {
                table_decision(
                    &tables.iter().map(String::as_str).collect(),
                    bool_outcome(changes.iter().any(|change| tables.contains(&change.table))),
                )
            }
        }
        GraphCapturedDependencyV1::PrincipalField {
            table,
            field,
            value_digest,
            ..
        } => {
            let relevant = changes
                .iter()
                .filter(|change| change.table == *table)
                .collect::<Vec<_>>();
            let outcome = relevant
                .iter()
                .map(|change| {
                    let change = *change;
                    let Some(row) = change.row.as_ref() else {
                        return LiveMatchOutcome::ConservativeFallback;
                    };
                    let Some(value) = row.get(field) else {
                        return LiveMatchOutcome::ConservativeFallback;
                    };
                    if captured_principal_digest(value).as_deref() == Some(value_digest.as_str()) {
                        LiveMatchOutcome::Match
                    } else if change.op == ChangeOp::Update
                        && (change.changed_fields.is_empty()
                            || change.changed_fields.iter().any(|changed| changed == field))
                    {
                        LiveMatchOutcome::ConservativeFallback
                    } else {
                        LiveMatchOutcome::Skip
                    }
                })
                .max_by_key(|outcome| graph_outcome_rank(*outcome))
                .unwrap_or(LiveMatchOutcome::Skip);
            GraphFactMatchDecision {
                outcome,
                tested_rows: relevant
                    .into_iter()
                    .map(|change| (change.table.clone(), change.id.clone()))
                    .collect(),
            }
        }
        GraphCapturedDependencyV1::SearchTable { table, .. } => table_decision(
            &BTreeSet::from([table.as_str()]),
            bool_outcome(changes.iter().any(|change| change.table == *table)),
        ),
    }
}

#[cfg(test)]
fn graph_fact_outcome(
    fact: &GraphCaptureFact<'_>,
    input: &HandlerInput,
    changes: &[ChangedRow],
) -> LiveMatchOutcome {
    graph_fact_decision(fact, input, changes).outcome
}

fn graph_subscription_match_decision(
    carrier: &GraphQueryCarrierV1,
    input: &HandlerInput,
    registration: &RegisteredGraphSubscriptionDependenciesV1,
    changes: &[ChangedRow],
) -> LiveMatchDecisionV1 {
    // Seed/reset/refresh deliberately carries no row delta. It is an affected
    // signal, exactly as on every non-graph lane, and must short-circuit before
    // storage-free projection or empty-node facts can manufacture `Skip`.
    if changes.is_empty() {
        return LiveMatchDecisionV1 {
            outcome: LiveMatchOutcome::ConservativeFallback,
            graph_nodes: Vec::new(),
        };
    }
    let normalized_node_ids = carrier
        .normalized_plan
        .nodes
        .iter()
        .map(|node| node.node_id().to_owned())
        .collect::<Vec<_>>();
    if registration.graph_plan_hash != carrier.plan_hash
        || registration.normalized_node_ids != normalized_node_ids
    {
        return LiveMatchDecisionV1 {
            outcome: LiveMatchOutcome::ConservativeFallback,
            graph_nodes: Vec::new(),
        };
    }
    let Some(facts) = graph_capture_facts(registration) else {
        return LiveMatchDecisionV1 {
            outcome: LiveMatchOutcome::ConservativeFallback,
            graph_nodes: Vec::new(),
        };
    };
    let mut by_node: BTreeMap<String, Vec<&GraphCaptureFact<'_>>> = BTreeMap::new();
    for fact in &facts {
        by_node
            .entry(fact.graph.node_id.clone())
            .or_default()
            .push(fact);
    }
    let instance_hash = registration.instance_hash.as_str().to_owned();
    let mut rows = Vec::with_capacity(carrier.normalized_plan.nodes.len());
    for (node_index, node) in carrier.normalized_plan.nodes.iter().enumerate() {
        let node_facts = by_node
            .get(node.node_id())
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        let identities_valid = node_facts.len() as u64
            == registration.per_node_capture_cardinalities[node_index]
            && node_facts.iter().all(|fact| {
                fact.graph.graph_plan_hash == carrier.plan_hash
                    && fact.graph.instance_hash == registration.instance_hash
                    && validate_graph_captured_read_v1(fact.graph, &carrier.normalized_plan).is_ok()
            });
        let capture_complete = graph_node_capture_is_complete(
            node,
            node_facts,
            &registration.parent_key_closure[node_index],
            input,
            identities_valid,
        );
        let mut tested_rows = BTreeSet::new();
        let (disposition, reason) = if !capture_complete {
            let reason = if matches!(node, GraphNodeV1::SearchMembership { .. }) {
                GraphNodeMatchReasonV1::SearchCaptureIncomplete
            } else {
                GraphNodeMatchReasonV1::CaptureIncomplete
            };
            (GraphNodeMatchDispositionV1::ConservativeFallback, reason)
        } else if matches!(node, GraphNodeV1::ClosedProjection { .. }) {
            (
                GraphNodeMatchDispositionV1::Skip,
                GraphNodeMatchReasonV1::ProjectionOnly,
            )
        } else {
            let outcome = node_facts
                .iter()
                .fold(LiveMatchOutcome::Skip, |outcome, fact| {
                    let decision = graph_fact_decision(fact, input, changes);
                    tested_rows.extend(decision.tested_rows);
                    if graph_outcome_rank(decision.outcome) > graph_outcome_rank(outcome) {
                        decision.outcome
                    } else {
                        outcome
                    }
                });
            let disposition = match outcome {
                LiveMatchOutcome::Skip => GraphNodeMatchDispositionV1::Skip,
                LiveMatchOutcome::Match => GraphNodeMatchDispositionV1::Match,
                LiveMatchOutcome::ConservativeFallback => {
                    GraphNodeMatchDispositionV1::ConservativeFallback
                }
            };
            let reason = if matches!(node, GraphNodeV1::SearchMembership { .. })
                && disposition == GraphNodeMatchDispositionV1::Match
            {
                GraphNodeMatchReasonV1::SearchTableWrite
            } else {
                match disposition {
                    GraphNodeMatchDispositionV1::Skip => GraphNodeMatchReasonV1::CapturedDisjoint,
                    GraphNodeMatchDispositionV1::Match => {
                        GraphNodeMatchReasonV1::CapturedIntersects
                    }
                    GraphNodeMatchDispositionV1::ConservativeFallback => {
                        GraphNodeMatchReasonV1::StaticTableIntersects
                    }
                }
            };
            (disposition, reason)
        };
        let mut dependency_kinds = node_facts
            .iter()
            .flat_map(|fact| {
                std::iter::once(&CapturedReadKind::GraphNode)
                    .chain(fact.ordinary.iter().map(|read| &read.kind))
            })
            .cloned()
            .collect::<Vec<_>>();
        dependency_kinds.sort_by_key(captured_read_kind_rank);
        dependency_kinds.dedup();
        let captured_dependency_count = node_facts
            .iter()
            .map(|fact| 1_u64.saturating_add(fact.ordinary.len() as u64))
            .sum::<u64>();
        rows.push(GraphNodeDecisionLedgerV1 {
            graph_plan_hash: carrier.plan_hash.as_str().to_owned(),
            instance_hash: instance_hash.clone(),
            node_id: node.node_id().to_owned(),
            node_kind: node.kind(),
            authority_class: node.authority().declared_class,
            capture_complete,
            dependency_kinds,
            captured_dependency_count,
            changed_row_count: tested_rows.len() as u64,
            disposition,
            reason,
        });
    }
    let outcome = if rows
        .iter()
        .any(|row| row.disposition == GraphNodeMatchDispositionV1::ConservativeFallback)
    {
        LiveMatchOutcome::ConservativeFallback
    } else if rows
        .iter()
        .any(|row| row.disposition == GraphNodeMatchDispositionV1::Match)
    {
        LiveMatchOutcome::Match
    } else {
        LiveMatchOutcome::Skip
    };
    LiveMatchDecisionV1 {
        outcome,
        graph_nodes: rows,
    }
}

fn captured_read_kind_rank(kind: &CapturedReadKind) -> u8 {
    match kind {
        CapturedReadKind::Row => 0,
        CapturedReadKind::MissingRow => 1,
        CapturedReadKind::Query => 2,
        CapturedReadKind::Auth => 3,
        CapturedReadKind::Permission => 4,
        CapturedReadKind::GraphNode => 5,
    }
}

pub fn rollup_graph_node_decisions(
    decisions: &[GraphNodeDecisionLedgerV1],
) -> Vec<GraphNodeDecisionStatsV1> {
    let mut groups = BTreeMap::<
        (
            String,
            GraphNodeKindV1,
            GraphNodeMatchDispositionV1,
            GraphNodeMatchReasonV1,
        ),
        GraphNodeDecisionStatsV1,
    >::new();
    for decision in decisions {
        let key = (
            decision.graph_plan_hash.clone(),
            decision.node_kind,
            decision.disposition,
            decision.reason,
        );
        let row = groups
            .entry(key)
            .or_insert_with(|| GraphNodeDecisionStatsV1 {
                graph_plan_hash: decision.graph_plan_hash.clone(),
                node_kind: decision.node_kind,
                disposition: decision.disposition,
                reason: decision.reason,
                decisions: 0,
                skips: 0,
                matches: 0,
                conservative_fallbacks: 0,
                capture_incomplete: 0,
            });
        row.decisions = row.decisions.saturating_add(1);
        match decision.disposition {
            GraphNodeMatchDispositionV1::Skip => row.skips = row.skips.saturating_add(1),
            GraphNodeMatchDispositionV1::Match => row.matches = row.matches.saturating_add(1),
            GraphNodeMatchDispositionV1::ConservativeFallback => {
                row.conservative_fallbacks = row.conservative_fallbacks.saturating_add(1)
            }
        }
        if !decision.capture_complete {
            row.capture_incomplete = row.capture_incomplete.saturating_add(1);
        }
    }
    groups.into_values().collect()
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
            CapturedReadKind::Auth | CapturedReadKind::Permission | CapturedReadKind::GraphNode => {
            }
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
            graph: None,
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

    #[test]
    fn graph_query_v1_no_executor_matcher_is_fail_closed_before_dependencies() {
        let carrier: crate::manifest::GraphQueryCarrierV1 = serde_json::from_str(include_str!(
            "../../../tests/conformance/graph/minimal-carrier.v1.json"
        ))
        .unwrap();
        let definition = FunctionDefinition::new(
            "graphIssues",
            FunctionKind::LiveQuery,
            FunctionRuntime::HostPlan(HandlerPlan::GraphQuery(carrier)),
        );
        let forged_query_dependency = CapturedReadDependency {
            graph: None,
            kind: CapturedReadKind::Query,
            table: Some("unrelated".to_owned()),
            id: None,
            version: Some(1),
            predicate: Some(
                serde_json::to_value(QueryPlan {
                    table_visibility: None,
                    table: "unrelated".to_owned(),
                    filters: Vec::new(),
                    order: Vec::new(),
                    limit: None,
                    membership_filters: Vec::new(),
                    indexed_by: None,
                })
                .unwrap(),
            ),
            rows: Vec::new(),
            field: None,
            value: None,
            order: None,
            limit: None,
            result_count: None,
            boundary: None,
        };
        assert_eq!(
            live_subscription_match_outcome(
                &definition,
                &input(),
                &[forged_query_dependency],
                &[update("other", "1", json!({"_id":"1"}), &["value"])],
            ),
            LiveMatchOutcome::ConservativeFallback
        );
    }

    fn graph_fact(
        dependency: Value,
        ordinary: Vec<&CapturedReadDependency>,
    ) -> GraphCaptureFact<'_> {
        let graph = Box::leak(Box::new(
            serde_json::from_value::<GraphCapturedReadV1>(json!({
                "format":"snapback.graph-captured-read.v1",
                "graphPlanHash":"sha256:0000000000000000000000000000000000000000000000000000000000000000",
                "instanceHash":"sha256:1111111111111111111111111111111111111111111111111111111111111111",
                "nodeId":"n0",
                "nodeKind":"root-window",
                "authorityClass":1,
                "dependency":dependency,
            }))
            .unwrap(),
        ));
        GraphCaptureFact { graph, ordinary }
    }

    fn ordered_range_query_dependency(
        rows: &[&str],
        first: Value,
        last: Value,
    ) -> CapturedReadDependency {
        let order = vec![OrderExpr {
            field: "rank".to_owned(),
            direction: OrderDirection::Asc,
            max_encoded_bytes: None,
        }];
        let plan = QueryPlan {
            table_visibility: None,
            table: "todos".to_owned(),
            filters: Vec::new(),
            order: order.clone(),
            limit: Some(2),
            membership_filters: Vec::new(),
            indexed_by: Some("by_rank".to_owned()),
        };
        CapturedReadDependency {
            graph: None,
            kind: CapturedReadKind::Query,
            table: Some("todos".to_owned()),
            id: None,
            version: Some(1),
            predicate: Some(serde_json::to_value(plan).unwrap()),
            rows: rows.iter().map(|id| (*id).to_owned()).collect(),
            field: None,
            value: None,
            order: Some(serde_json::to_value(order).unwrap()),
            limit: Some(2),
            result_count: Some(rows.len()),
            boundary: Some(json!({"first":first,"last":last,"complete":false})),
        }
    }

    fn minimal_graph_registration(
        query_table: &str,
        include_projection: bool,
    ) -> (
        GraphQueryCarrierV1,
        Result<RegisteredGraphSubscriptionDependenciesV1, GraphDemandTimeRefusalReasonV1>,
    ) {
        let carrier: GraphQueryCarrierV1 = serde_json::from_str(include_str!(
            "../../../tests/conformance/graph/minimal-carrier.v1.json"
        ))
        .unwrap();
        let order = vec![OrderExpr {
            field: "updatedAt".to_owned(),
            direction: OrderDirection::Desc,
            max_encoded_bytes: None,
        }];
        let windows = vec![GraphNodeWindowIdentityV1 {
            node_id: "n0".to_owned(),
            intervals: vec![crate::manifest::GraphParentWindowIdentityV1 {
                parent_key: None,
                window: crate::manifest::GraphWindowIdentityV1 {
                    order: order.clone(),
                    direction: GraphDirectionV1::Forward,
                    lower: GraphIntervalEndV1::Unbounded,
                    upper: GraphIntervalEndV1::Unbounded,
                    take: 2,
                },
            }],
        }];
        let instance =
            graph_instance_identity_v1(&carrier, &json!({}), windows.clone(), &BTreeMap::new())
                .unwrap();
        let materialization_preimage: crate::manifest::GraphMaterializationPreimageV1 =
            serde_json::from_value(json!({
                "format":"snapback.graph-materialization.v1",
                "appId":"registration-test", "databaseId":"database",
                "deploymentId":"deployment", "targetProfileId":"local",
                "activationHash":"sha256:0000000000000000000000000000000000000000000000000000000000000000",
                "function":{
                    "artifactKind":"functionReference", "schemaVersion":"snapback.v1",
                    "appId":"registration-test", "id":"graph-test", "name":"graphTest",
                    "kind":"LiveQuery",
                    "implementationHash":"sha256:0000000000000000000000000000000000000000000000000000000000000000",
                    "argsContractHash":"sha256:0000000000000000000000000000000000000000000000000000000000000000",
                    "resultContractHash":carrier.normalized_plan.result_contract_hash,
                    "expectedGeneration":{"schemaVersion":"snapback.v1","appId":"registration-test","schemaHash":"schema","bundleHash":"bundle","inputsHash":"inputs"}
                },
                "graphInstanceHash":instance.instance_hash,
            }))
            .unwrap();
        let materialization = graph_materialization_identity_v1(materialization_preimage).unwrap();
        let partition = graph_authority_partition_identity_v1(
            crate::manifest::GraphAuthorityPartitionPreimageV1 {
                format: "snapback.graph-authority-partition.v1".to_owned(),
                graph_plan_hash: carrier.plan_hash.clone(),
                class2: Vec::new(),
                class3: None,
            },
        )
        .unwrap();
        let demand = GraphSubscriptionRegistrationDemandV1 {
            args: json!({}),
            windows,
            input: input(),
            permission_values_by_table: BTreeMap::new(),
            materialization,
            partition,
        };
        let instance_hash = demand.materialization.preimage.graph_instance_hash.clone();
        let root = CapturedReadDependency {
            graph: Some(
                serde_json::from_value(json!({
                    "format":"snapback.graph-captured-read.v1",
                    "graphPlanHash":carrier.plan_hash,
                    "instanceHash":instance_hash,
                    "nodeId":"n0", "nodeKind":"root-window", "authorityClass":1,
                    "dependency":{
                        "kind":"root-range", "table":"issues", "index":"by_updated",
                        "predicate":[], "order":order, "direction":"forward",
                        "lower":{"kind":"unbounded"}, "upper":{"kind":"unbounded"},
                        "limit":2, "resultCount":0, "boundary":null, "complete":true
                    }
                }))
                .unwrap(),
            ),
            ..empty_dependency(CapturedReadKind::GraphNode)
        };
        let query_plan = QueryPlan {
            table_visibility: None,
            table: query_table.to_owned(),
            filters: Vec::new(),
            order: order.clone(),
            limit: Some(2),
            membership_filters: Vec::new(),
            indexed_by: Some("by_updated".to_owned()),
        };
        let query = CapturedReadDependency {
            graph: None,
            kind: CapturedReadKind::Query,
            table: Some(query_table.to_owned()),
            id: None,
            version: Some(1),
            predicate: Some(serde_json::to_value(query_plan).unwrap()),
            rows: Vec::new(),
            field: None,
            value: None,
            order: Some(serde_json::to_value(order).unwrap()),
            limit: Some(2),
            result_count: Some(0),
            boundary: None,
        };
        let projection = CapturedReadDependency {
            graph: Some(
                serde_json::from_value(json!({
                    "format":"snapback.graph-captured-read.v1",
                    "graphPlanHash":carrier.plan_hash,
                    "instanceHash":instance_hash,
                    "nodeId":"n1", "nodeKind":"closed-projection", "authorityClass":1,
                    "dependency":{"kind":"projection","sourceNodeIds":["n0"]}
                }))
                .unwrap(),
            ),
            ..empty_dependency(CapturedReadKind::GraphNode)
        };
        let mut reads = vec![root, query];
        let mut attachments = vec![GraphCapturedReadAttachmentV1 {
            graph_read_index: 0,
            ordinary_read_indices: vec![1],
        }];
        if include_projection {
            reads.push(projection);
            attachments.push(GraphCapturedReadAttachmentV1 {
                graph_read_index: 2,
                ordinary_read_indices: Vec::new(),
            });
        }
        let registration = attest_graph_subscription_dependencies(
            &carrier,
            &SchemaManifest::default(),
            &demand,
            &reads,
            &attachments,
            &[GraphCapturedQueryOutputV1 {
                query_read_index: 1,
                rows: Vec::new(),
            }],
        );
        (carrier, registration)
    }

    #[test]
    fn complete_graph_capture_empty_changes_is_seed_refresh_not_skip() {
        let (carrier, registration) = minimal_graph_registration("issues", true);
        let registration = registration.unwrap();
        let definition = FunctionDefinition::new(
            "graphIssues",
            FunctionKind::LiveQuery,
            FunctionRuntime::HostPlan(HandlerPlan::GraphQuery(carrier)),
        );
        let decision = live_subscription_match_decision_with_graph_registration(
            &definition,
            &input(),
            &registration,
            &[],
        );
        assert_eq!(decision.outcome, LiveMatchOutcome::ConservativeFallback);
        assert!(decision.graph_nodes.is_empty());
    }

    #[test]
    fn attested_graph_registration_rejects_forged_companion_and_missing_node_as_incomplete() {
        for (query_table, include_projection) in [("unrelated", true), ("issues", false)] {
            let (_, registration) = minimal_graph_registration(query_table, include_projection);
            assert!(
                registration.is_err(),
                "semantic companion or node omission must be refused at registration"
            );
        }
    }

    #[test]
    fn range_capture_uses_executed_direction_real_page_and_lookahead_interval() {
        let backward_query =
            ordered_range_query_dependency(&["e", "d"], json!([5, "e"]), json!([4, "d"]));
        let backward_insert = ChangedRow {
            table: "todos".to_owned(),
            id: "f".to_owned(),
            op: ChangeOp::Insert,
            row: Some(json!({"_id":"f","rank":6})),
            changed_fields: Vec::new(),
        };
        let forward_query =
            ordered_range_query_dependency(&["a", "b"], json!([1, "a"]), json!([2, "b"]));
        let lookahead_insert = ChangedRow {
            table: "todos".to_owned(),
            id: "c".to_owned(),
            op: ChangeOp::Insert,
            row: Some(json!({"_id":"c","rank":3})),
            changed_fields: Vec::new(),
        };
        for parent in [false, true] {
            let parent_key = parent.then(|| json!({"table":"parents","id":"p1"}));
            let backward = graph_fact(
                if let Some(parent_key) = parent_key.clone() {
                    json!({
                        "kind":"parent-range", "table":"todos", "index":"by_rank",
                        "parentKey":parent_key, "predicate":[],
                        "order":[{"field":"rank","direction":"Asc"}],
                        "direction":"backward", "lower":{"kind":"unbounded"},
                        "upper":{"kind":"unbounded"}, "limit":2, "resultCount":2,
                        "boundary":{"entries":[["rank",4]],"id":"d"},
                        "complete":false
                    })
                } else {
                    json!({
                        "kind":"root-range", "table":"todos", "index":"by_rank",
                        "predicate":[], "order":[{"field":"rank","direction":"Asc"}],
                        "direction":"backward", "lower":{"kind":"unbounded"},
                        "upper":{"kind":"unbounded"}, "limit":2, "resultCount":2,
                        "boundary":{"entries":[["rank",4]],"id":"d"},
                        "complete":false
                    })
                },
                vec![&backward_query],
            );
            assert_eq!(
                graph_fact_outcome(&backward, &input(), &[backward_insert.clone()]),
                LiveMatchOutcome::Match,
                "ascending-declared backward top-N insert must wake (parent={parent})"
            );

            let forward = graph_fact(
                if let Some(parent_key) = parent_key {
                    json!({
                        "kind":"parent-range", "table":"todos", "index":"by_rank",
                        "parentKey":parent_key, "predicate":[],
                        "order":[{"field":"rank","direction":"Asc"}],
                        "direction":"forward",
                        "lower":{"kind":"inclusive","key":{"entries":[["rank",1]],"id":"a"}},
                        "upper":{"kind":"exclusive","key":{"entries":[["rank",5]],"id":"e"}},
                        "limit":2, "resultCount":2,
                        "boundary":{"entries":[["rank",2]],"id":"b"},
                        "complete":false
                    })
                } else {
                    json!({
                        "kind":"root-range", "table":"todos", "index":"by_rank",
                        "predicate":[], "order":[{"field":"rank","direction":"Asc"}],
                        "direction":"forward",
                        "lower":{"kind":"inclusive","key":{"entries":[["rank",1]],"id":"a"}},
                        "upper":{"kind":"exclusive","key":{"entries":[["rank",5]],"id":"e"}},
                        "limit":2, "resultCount":2,
                        "boundary":{"entries":[["rank",2]],"id":"b"},
                        "complete":false
                    })
                },
                vec![&forward_query],
            );
            assert_eq!(
                graph_fact_outcome(&forward, &input(), &[lookahead_insert.clone()]),
                LiveMatchOutcome::Match,
                "truncated forward lookahead insert must wake (parent={parent})"
            );
            assert_eq!(
                graph_fact_outcome(
                    &forward,
                    &input(),
                    &[ChangedRow {
                        table: "todos".to_owned(),
                        id: "c".to_owned(),
                        op: ChangeOp::Delete,
                        row: None,
                        changed_fields: Vec::new(),
                    }],
                ),
                LiveMatchOutcome::ConservativeFallback,
                "an uncaptured lookahead delete is not disjoint (parent={parent})"
            );
        }

        let missing_window_identity = graph_fact(
            json!({
                "kind":"root-range", "table":"todos", "index":"by_rank",
                "predicate":[], "order":[{"field":"rank","direction":"Asc"}],
                "limit":2, "resultCount":2,
                "boundary":{"entries":[["rank",2]],"id":"b"}, "complete":false
            }),
            vec![&forward_query],
        );
        assert_eq!(
            graph_fact_outcome(&missing_window_identity, &input(), &[lookahead_insert]),
            LiveMatchOutcome::ConservativeFallback
        );
    }

    #[test]
    fn graph_node_dependency_kinds_prove_skip_match_and_conservative_fallback() {
        let query = completed_todos_query_dependency();
        let disjoint = update("other", "1", json!({"_id":"1"}), &["value"]);
        let relevant = ChangedRow {
            table: "todos".to_owned(),
            id: "2".to_owned(),
            op: ChangeOp::Insert,
            row: Some(json!({"_id":"2", "completed":true})),
            changed_fields: Vec::new(),
        };
        let unprovable = ChangedRow {
            table: "todos".to_owned(),
            id: "2".to_owned(),
            op: ChangeOp::Delete,
            row: None,
            changed_fields: Vec::new(),
        };
        for (dependency, delete_outcome) in [
            (
                json!({
                    "kind":"root-range", "table":"todos", "index":"by_completed",
                    "predicate":[], "order":[], "direction":"forward",
                    "lower":{"kind":"unbounded"}, "upper":{"kind":"unbounded"},
                    "limit":10, "resultCount":0,
                    "boundary":null, "complete":true
                }),
                LiveMatchOutcome::Skip,
            ),
            (
                json!({
                    "kind":"parent-range", "table":"todos", "index":"by_completed",
                    "parentKey":{"table":"parents","id":"p1"}, "predicate":[],
                    "order":[], "direction":"forward",
                    "lower":{"kind":"unbounded"}, "upper":{"kind":"unbounded"},
                    "limit":10, "resultCount":0,
                    "boundary":null, "complete":true
                }),
                LiveMatchOutcome::Skip,
            ),
            (
                json!({
                    "kind":"parent-point", "table":"todos", "index":"by_completed",
                    "parentKey":{"table":"parents","id":"p1"}, "lookupKey":[true],
                    "childKey":null, "found":false, "rowVersion":null
                }),
                LiveMatchOutcome::ConservativeFallback,
            ),
        ] {
            let fact = graph_fact(dependency, vec![&query]);
            assert_eq!(
                graph_fact_outcome(&fact, &input(), &[disjoint.clone()]),
                LiveMatchOutcome::Skip
            );
            assert_eq!(
                graph_fact_outcome(&fact, &input(), &[relevant.clone()]),
                LiveMatchOutcome::Match
            );
            assert_eq!(
                graph_fact_outcome(&fact, &input(), &[unprovable.clone()]),
                delete_outcome
            );
        }

        let complete_membership = graph_fact(
            json!({
                "kind":"membership", "tables":["memberships"], "indexes":["by_parent_member"],
                "parentKey":{"table":"parents","id":"p1"}, "argumentId":null,
                "matchedCount":0, "complete":true
            }),
            Vec::new(),
        );
        assert_eq!(
            graph_fact_outcome(&complete_membership, &input(), &[disjoint.clone()]),
            LiveMatchOutcome::Skip
        );
        assert_eq!(
            graph_fact_outcome(
                &complete_membership,
                &input(),
                &[update("memberships", "m1", json!({"_id":"m1"}), &["value"])]
            ),
            LiveMatchOutcome::Match
        );
        let incomplete_membership = graph_fact(
            json!({
                "kind":"membership", "tables":["memberships"], "indexes":["by_parent_member"],
                "parentKey":{"table":"parents","id":"p1"}, "argumentId":null,
                "matchedCount":0, "complete":false
            }),
            Vec::new(),
        );
        assert_eq!(
            graph_fact_outcome(&incomplete_membership, &input(), &[disjoint.clone()]),
            LiveMatchOutcome::ConservativeFallback
        );

        let principal_value = json!("ada");
        let principal = graph_fact(
            json!({
                "kind":"principal-field", "table":"viewState", "index":"by_user",
                "parentKey":{"table":"issues","id":"i1"},
                "partitionHash":"sha256:2222222222222222222222222222222222222222222222222222222222222222",
                "field":"userId", "valueDigest":captured_principal_digest(&principal_value).unwrap(),
                "found":false
            }),
            Vec::new(),
        );
        assert_eq!(
            graph_fact_outcome(
                &principal,
                &input(),
                &[update("other", "1", json!({"_id":"1"}), &["value"])]
            ),
            LiveMatchOutcome::Skip
        );
        assert_eq!(
            graph_fact_outcome(
                &principal,
                &input(),
                &[ChangedRow {
                    table: "viewState".to_owned(),
                    id: "v1".to_owned(),
                    op: ChangeOp::Insert,
                    row: Some(json!({"_id":"v1", "userId":"ada"})),
                    changed_fields: Vec::new(),
                }]
            ),
            LiveMatchOutcome::Match
        );
        assert_eq!(
            graph_fact_outcome(
                &principal,
                &input(),
                &[update(
                    "viewState",
                    "v1",
                    json!({"_id":"v1", "userId":"grace"}),
                    &["userId"]
                )]
            ),
            LiveMatchOutcome::ConservativeFallback
        );

        let search = graph_fact(
            json!({
                "kind":"search-table", "table":"searchDocs",
                "membershipIdentity":{
                    "format":"snapback.graph-search-membership-identity.v1",
                    "providerPlanHash":"sha256:3333333333333333333333333333333333333333333333333333333333333333",
                    "argumentContractHash":"sha256:4444444444444444444444444444444444444444444444444444444444444444",
                    "scopeContractHash":"sha256:5555555555555555555555555555555555555555555555555555555555555555",
                    "authorityClass":1, "providerVersion":"v1",
                    "providerCompletenessClass":"complete-membership-v1",
                    "membershipHash":"sha256:6666666666666666666666666666666666666666666666666666666666666666"
                },
                "providerVersion":"v1"
            }),
            Vec::new(),
        );
        assert_eq!(
            graph_fact_outcome(&search, &input(), &[disjoint]),
            LiveMatchOutcome::Skip
        );
        assert_eq!(
            graph_fact_outcome(
                &search,
                &input(),
                &[update("searchDocs", "s1", json!({"_id":"s1"}), &["text"])]
            ),
            LiveMatchOutcome::Match
        );
        let skipped = graph_fact(
            json!({
                "kind":"parent-lookup-skipped", "table":"todos", "index":"by_completed",
                "parentKey":{"table":"parents","id":"p1"}, "reason":"null-or-omitted-key"
            }),
            Vec::new(),
        );
        assert_eq!(
            graph_fact_outcome(&skipped, &input(), &[relevant]),
            LiveMatchOutcome::Skip
        );
        let projection = graph_fact(
            json!({"kind":"projection", "sourceNodeIds":["n0"]}),
            Vec::new(),
        );
        assert_eq!(
            graph_fact_outcome(&projection, &input(), &[unprovable]),
            LiveMatchOutcome::Skip
        );
    }

    fn point_dependency(kind: CapturedReadKind, table: &str, id: &str) -> CapturedReadDependency {
        CapturedReadDependency {
            graph: None,
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
            graph: None,
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
            graph: None,
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
            graph: None,
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
            graph: None,
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
