//! LLP 0309 Stage-B re-derivation audit.
//!
//! Divergences are evidence, not test failures. The audit fails only when a
//! fixture cannot be replayed or a divergence has no D4.2 classification.

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;

use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use snapback::ephemeral::RealtimeEnvelope;
use snapback::live_matcher::{LiveDeltaKind, LiveDeltaOutcome, compute_live_delta};
use snapback::local::{LiveSubscribeInput, LocalSnapback};
use snapback::manifest::{
    AuthInput, FieldManifest, FieldType, FilterExpr, FilterOp as ShippedFilterOp,
    FunctionDefinition, FunctionKind, FunctionManifest, FunctionResultContract, FunctionRuntime,
    GraphNodeV1, GraphProjectionObjectV1, GraphProjectionValueV1, GraphToOnePresenceV1,
    HandlerInput, HandlerPlan, MutationPlan, MutationStep, OrderDirection, OrderExpr, QueryPlan,
    ResultObjectFieldContract, ResultValueContract, ReturnValue, SchemaManifest, TableManifest,
    TableVisibilityArmV1, TableVisibilityV1, ValueExpr,
};
use snapback_delta_semantics::{
    Admission, AdmissionGrain, AdmitConfig, AdmitInput, AdmitState, AppBatch, AppChange,
    ChangeOp as ReferenceChangeOp, CompletenessLabel, DeltaZBatch, DeltaZEntry, Direction,
    FallbackReason, Filter as ReferenceFilter, FilterOp as ReferenceFilterOp, FormVerdict,
    Interval, LookupConfig, LookupDeltaOp, LookupInput, LookupScopeState, LookupState, OrderField,
    Presence, RankKey, RankedRow, ReadPair, ReadRequest, ReadResponse, ReadTranscript, SeqOp,
    SupportConfig, SupportEdgeKind, SupportInput, SupportMode, SupportState, Visibility,
    WindowConfig, WindowState, evaluate_admit, evaluate_lookup, evaluate_support, evaluate_window,
};
use snapback_kernel::storage::{ChangeOp as ShippedChangeOp, ChangedRow};

#[path = "support/graph_stage_b.rs"]
mod graph_stage_b;

const AUDITED_COMMIT: &str = "b2ecdc3beca6f8434f3fcfc12261cf369d0828bc";
const GRAPH_DISPOSITIONS: &str = "tests/conformance/graph/delta-dispositions.v1.json";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum DivergenceClass {
    ReferenceError,
    ShippedDefect,
    ConservativeApproximation,
    Unclassified,
}

#[derive(Debug)]
struct Divergence {
    axis: &'static str,
    case: String,
    shipped: String,
    reference: String,
    class: DivergenceClass,
    evidence: String,
}

impl Divergence {
    fn conservative(
        axis: &'static str,
        case: impl Into<String>,
        shipped: impl Into<String>,
        reference: impl Into<String>,
        evidence: impl Into<String>,
    ) -> Self {
        Self {
            axis,
            case: case.into(),
            shipped: shipped.into(),
            reference: reference.into(),
            class: DivergenceClass::ConservativeApproximation,
            evidence: evidence.into(),
        }
    }
}

fn repository_path(relative: &str) -> PathBuf {
    PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../..")).join(relative)
}

fn row(value: Value) -> BTreeMap<String, Value> {
    serde_json::from_value(value).expect("audit row is an object")
}

fn handler_input(args: Value, user: Option<&str>) -> HandlerInput {
    HandlerInput {
        args,
        auth: AuthInput {
            user_id: user.map(str::to_owned),
            ..AuthInput::default()
        },
        ..HandlerInput::default()
    }
}

fn changed(
    table: &str,
    id: &str,
    op: ShippedChangeOp,
    row: Option<Value>,
    changed_fields: &[&str],
) -> ChangedRow {
    ChangedRow {
        table: table.to_owned(),
        id: id.to_owned(),
        op,
        row,
        changed_fields: changed_fields
            .iter()
            .map(|field| (*field).to_owned())
            .collect(),
    }
}

fn base_plan() -> QueryPlan {
    QueryPlan {
        table: "todos".to_owned(),
        table_visibility: None,
        filters: Vec::new(),
        order: Vec::new(),
        limit: None,
        membership_filters: Vec::new(),
        indexed_by: None,
    }
}

fn user_plan() -> QueryPlan {
    QueryPlan {
        filters: vec![FilterExpr {
            field: "userId".to_owned(),
            op: ShippedFilterOp::Eq,
            value: ValueExpr::Arg("userId".to_owned()),
        }],
        ..base_plan()
    }
}

fn audit_row(id: &str, user: &str) -> Value {
    json!({
        "_id": id,
        "_version": 1,
        "_createdAt": 1,
        "_updatedAt": 1,
        "title": "t",
        "userId": user,
    })
}

fn reference_filter(filter: &FilterExpr, input: &HandlerInput) -> Option<ReferenceFilter> {
    let (argument, literal) = match &filter.value {
        ValueExpr::Arg(name) => (input.args.get(name).cloned(), None),
        ValueExpr::Literal(value) => (None, Some(value.clone())),
        ValueExpr::AuthUserId => (input.auth.user_id.clone().map(Value::String), None),
        _ => return None,
    };
    let op = match filter.op {
        ShippedFilterOp::Eq => ReferenceFilterOp::Eq,
        ShippedFilterOp::In => ReferenceFilterOp::In,
        ShippedFilterOp::Lt => ReferenceFilterOp::Lt,
        ShippedFilterOp::Lte => ReferenceFilterOp::Lte,
        ShippedFilterOp::Gt => ReferenceFilterOp::Gt,
        ShippedFilterOp::Gte => ReferenceFilterOp::Gte,
    };
    Some(ReferenceFilter {
        field: filter.field.clone(),
        op,
        argument,
        literal,
    })
}

fn reference_visibility(plan: &QueryPlan, input: &HandlerInput) -> Option<Visibility> {
    match plan.table_visibility.as_ref() {
        None | Some(TableVisibilityV1::PublicRead) => Some(Visibility::PublicRead),
        Some(TableVisibilityV1::Owner { field }) => Some(Visibility::Owner {
            field: field.clone(),
            user_id: input.auth.user_id.clone()?,
        }),
        Some(TableVisibilityV1::AnyOf { arms }) => arms
            .iter()
            .map(|arm| match arm {
                TableVisibilityArmV1::Owner { field } => Some(Visibility::Owner {
                    field: field.clone(),
                    user_id: input.auth.user_id.clone()?,
                }),
                TableVisibilityArmV1::Membership { .. } => None,
            })
            .collect::<Option<Vec<_>>>()
            .map(|arms| Visibility::AnyOf { arms }),
        Some(TableVisibilityV1::Membership { .. }) => None,
    }
}

fn reference_dk3(
    plan: &QueryPlan,
    input: &HandlerInput,
    prior_ids: &BTreeSet<String>,
    changes: &[ChangedRow],
) -> Option<Value> {
    let visibility = reference_visibility(plan, input)?;
    let filters = plan
        .filters
        .iter()
        .map(|filter| reference_filter(filter, input))
        .collect::<Option<Vec<_>>>()?;
    let retained = prior_ids
        .iter()
        .map(|id| (id.clone(), row(json!({"_id":id}))))
        .collect();
    let changes = changes
        .iter()
        .filter(|change| change.table == plan.table)
        .map(|change| AppChange {
            row_key: change.id.clone(),
            op: match change.op {
                ShippedChangeOp::Insert => ReferenceChangeOp::Insert,
                ShippedChangeOp::Update => ReferenceChangeOp::Update,
                ShippedChangeOp::Delete => ReferenceChangeOp::Delete,
            },
            post_image: change.row.clone().map(row),
            pre_image: None,
            changed_fields: change.changed_fields.iter().cloned().collect(),
        })
        .collect();
    let verdict = evaluate_admit(
        &AdmitConfig {
            visibility,
            filters,
            grain: AdmissionGrain::CompleteScope,
            rank_order: Vec::new(),
            probe_relation: false,
        },
        AdmitState { retained },
        AdmitInput {
            changes: AppBatch { changes },
            ..AdmitInput::default()
        },
        &ReadTranscript::default(),
    );
    Some(match verdict {
        FormVerdict::Fallback { reason } => json!({"verdict":"Replace","reason":reason}),
        FormVerdict::Maintain { delta_out, .. } => {
            let ops = delta_out
                .entries
                .into_iter()
                .filter_map(|entry| match entry.admit {
                    Admission::Enter => Some(json!({
                        "op":"add", "id":entry.row_key, "row":entry.post_image
                    })),
                    Admission::StayIn => Some(json!({
                        "op":"update", "id":entry.row_key, "row":entry.post_image
                    })),
                    Admission::Leave => Some(json!({
                        "op":"remove", "id":entry.row_key, "row":Value::Null
                    })),
                    Admission::StayOut => None,
                })
                .collect::<Vec<_>>();
            json!({"verdict":"Delta","ops":ops})
        }
    })
}

fn shipped_dk3(
    plan: &QueryPlan,
    input: &HandlerInput,
    prior_ids: &BTreeSet<String>,
    changes: &[ChangedRow],
) -> Value {
    match compute_live_delta(plan, input, prior_ids, changes) {
        LiveDeltaOutcome::Replace => json!({"verdict":"Replace"}),
        LiveDeltaOutcome::Delta(ops) => json!({
            "verdict":"Delta",
            "ops":ops.into_iter().map(|operation| json!({
                "op":match operation.kind {
                    LiveDeltaKind::Add => "add",
                    LiveDeltaKind::Update => "update",
                    LiveDeltaKind::Remove => "remove",
                },
                "id":operation.id,
                "row":operation.row,
            })).collect::<Vec<_>>(),
        }),
    }
}

fn assert_dk3_agreement(
    case: &str,
    plan: &QueryPlan,
    input: &HandlerInput,
    prior_ids: &[&str],
    changes: &[ChangedRow],
) {
    let prior_ids = prior_ids
        .iter()
        .map(|id| (*id).to_owned())
        .collect::<BTreeSet<_>>();
    let shipped = shipped_dk3(plan, input, &prior_ids, changes);
    let reference = reference_dk3(plan, input, &prior_ids, changes)
        .unwrap_or_else(|| panic!("{case}: reference adapter rejected an admitted DK-3 shape"));
    assert_eq!(shipped, reference, "{case}: shipped/reference disagreement");
}

fn reference_admit_batch(
    plan: &QueryPlan,
    input: &HandlerInput,
    retained: BTreeMap<String, BTreeMap<String, Value>>,
    changes: &[ChangedRow],
    grain: AdmissionGrain,
    rank_order: Vec<OrderField>,
) -> FormVerdict<DeltaZBatch, AdmitState> {
    let visibility = reference_visibility(plan, input)
        .expect("reference admission shape has row-local visibility");
    let filters = plan
        .filters
        .iter()
        .map(|filter| reference_filter(filter, input))
        .collect::<Option<Vec<_>>>()
        .expect("reference admission filters are representable");
    evaluate_admit(
        &AdmitConfig {
            visibility,
            filters,
            grain,
            rank_order,
            probe_relation: false,
        },
        AdmitState { retained },
        AdmitInput {
            changes: AppBatch {
                changes: changes
                    .iter()
                    .filter(|change| change.table == plan.table)
                    .map(|change| AppChange {
                        row_key: change.id.clone(),
                        op: match change.op {
                            ShippedChangeOp::Insert => ReferenceChangeOp::Insert,
                            ShippedChangeOp::Update => ReferenceChangeOp::Update,
                            ShippedChangeOp::Delete => ReferenceChangeOp::Delete,
                        },
                        post_image: change.row.clone().map(row),
                        pre_image: None,
                        changed_fields: change.changed_fields.iter().cloned().collect(),
                    })
                    .collect(),
            },
            ..AdmitInput::default()
        },
        &ReadTranscript::default(),
    )
}

fn execute_dk3_window_reference(
    plan: &QueryPlan,
    input: &HandlerInput,
    retained_rows: Vec<BTreeMap<String, Value>>,
    changes: &[ChangedRow],
    order: Vec<OrderField>,
    take: usize,
    complete: bool,
) -> FormVerdict<snapback_delta_semantics::DeltaSeq, WindowState> {
    let retained = retained_rows
        .iter()
        .map(|row| {
            (
                row.get("_id").and_then(Value::as_str).unwrap().to_owned(),
                row.clone(),
            )
        })
        .collect::<BTreeMap<_, _>>();
    let admit = reference_admit_batch(
        plan,
        input,
        retained.clone(),
        changes,
        AdmissionGrain::Window,
        order.clone(),
    );
    let FormVerdict::Maintain { delta_out, .. } = admit else {
        let FormVerdict::Fallback { reason } = admit else {
            unreachable!()
        };
        return FormVerdict::Fallback { reason };
    };
    let rows = retained
        .iter()
        .map(|(row_key, row)| RankedRow {
            row_key: row_key.clone(),
            rank_keys: reference_rank(row, &order, row_key),
            row: row.clone(),
        })
        .collect::<Vec<_>>();
    let boundary = rows.last().map(|row| row.rank_keys.clone());
    evaluate_window(
        &WindowConfig {
            window_id: "dk3-reference-window".to_owned(),
            order,
            interval: Interval::default(),
            take,
            projection_fields: BTreeSet::from([
                "_id".to_owned(),
                "title".to_owned(),
                "userId".to_owned(),
            ]),
        },
        WindowState {
            result_count: rows.len(),
            rows,
            boundary: boundary.clone(),
            complete,
            label: if complete {
                CompletenessLabel::Complete
            } else {
                CompletenessLabel::Incomplete
            },
            continuation: boundary,
        },
        delta_out,
        &ReadTranscript::default(),
    )
}

fn execute_membership_reference(
    plan: &QueryPlan,
    input: &HandlerInput,
    change: &ChangedRow,
) -> FormVerdict<snapback_delta_semantics::DeltaBit, SupportState> {
    let mut admitted_plan = plan.clone();
    admitted_plan.membership_filters.clear();
    admitted_plan.table_visibility = Some(TableVisibilityV1::PublicRead);
    let admit = reference_admit_batch(
        &admitted_plan,
        input,
        BTreeMap::new(),
        std::slice::from_ref(change),
        AdmissionGrain::CompleteScope,
        Vec::new(),
    );
    let FormVerdict::Maintain { delta_out, .. } = admit else {
        panic!("membership carrier E0 must maintain");
    };
    let scope = change.id.clone();
    evaluate_support(
        &SupportConfig {
            edge: "todo_members".to_owned(),
            edge_kind: SupportEdgeKind::Direct,
            mode: SupportMode::Exists,
            parent_join_fields: vec!["projectId".to_owned()],
            support_join_fields: vec!["projectId".to_owned()],
            through_target_field: None,
        },
        SupportState::default(),
        SupportInput {
            parent: delta_out,
            ..SupportInput::default()
        },
        &ReadTranscript(vec![ReadPair {
            request: ReadRequest::Probe {
                edge: "todo_members".to_owned(),
                scope,
                element: None,
            },
            response: ReadResponse::Probe {
                rows: vec![row(json!({"_id":"member-1","projectId":"p1"}))],
            },
        }]),
    )
}

#[derive(Debug)]
enum GraphReferenceState {
    Window {
        node_id: String,
        admissions: Vec<(String, Admission)>,
        state: WindowState,
    },
    Lookup {
        node_id: String,
        state: LookupState,
    },
    Composite(Vec<GraphReferenceState>),
}

#[derive(Debug)]
struct ReferenceWirePatch {
    node_id: String,
    root_key: String,
    key: String,
    row: BTreeMap<String, Value>,
}

#[derive(Debug)]
enum GraphReferenceMirror {
    Maintain {
        form: &'static str,
        projected_fields: BTreeSet<String>,
        patches: Vec<ReferenceWirePatch>,
        next_state: GraphReferenceState,
    },
    Fallback {
        form: &'static str,
        reason: FallbackReason,
    },
    Gap(String),
}

fn graph_projection_fields(
    object: &GraphProjectionObjectV1,
    fields: &mut BTreeMap<String, BTreeSet<String>>,
) {
    for field in &object.fields {
        match &field.value {
            GraphProjectionValueV1::Field { node_id, field } => {
                fields
                    .entry(node_id.clone())
                    .or_default()
                    .insert(field.clone());
            }
            GraphProjectionValueV1::Object { object, .. }
            | GraphProjectionValueV1::Array { item: object, .. } => {
                graph_projection_fields(object, fields);
            }
            GraphProjectionValueV1::Literal { .. } | GraphProjectionValueV1::Exists { .. } => {}
        }
    }
}

fn projection_fields_by_node(
    plan: &snapback::manifest::GraphQueryPlanV1,
) -> BTreeMap<String, BTreeSet<String>> {
    let mut fields = BTreeMap::new();
    let projection = plan
        .nodes
        .iter()
        .find_map(|node| match node {
            GraphNodeV1::ClosedProjection { object, .. } => Some(object),
            _ => None,
        })
        .expect("closed graph projection");
    graph_projection_fields(projection, &mut fields);
    fields
}

fn reference_order(order: &[OrderExpr]) -> Vec<OrderField> {
    order
        .iter()
        .map(|order| OrderField {
            field: order.field.clone(),
            direction: match order.direction {
                OrderDirection::Asc => Direction::Asc,
                OrderDirection::Desc => Direction::Desc,
            },
        })
        .collect()
}

fn reference_rank(row: &BTreeMap<String, Value>, order: &[OrderField], row_key: &str) -> RankKey {
    RankKey {
        values: order
            .iter()
            .map(|field| row.get(&field.field).cloned().unwrap_or(Value::Null))
            .collect(),
        row_key: row_key.to_owned(),
    }
}

fn graph_reference_input(replay: &graph_stage_b::GraphReplay) -> Result<HandlerInput, String> {
    let call_args = replay.call["args"]
        .as_object()
        .ok_or_else(|| "case JSON lacks graph call args".to_owned())?;
    let mut args = serde_json::Map::new();
    for argument in &replay.plan.arguments {
        let value = call_args
            .get(&argument.name)
            .or_else(|| call_args.get(&argument.argument_id))
            .ok_or_else(|| {
                format!(
                    "case JSON lacks argument {} ({})",
                    argument.name, argument.argument_id
                )
            })?;
        args.insert(argument.argument_id.clone(), value.clone());
    }
    Ok(HandlerInput {
        args: Value::Object(args),
        auth: replay.auth.clone(),
        read_set: Vec::new(),
        correlation: None,
        ctx_ledger: None,
    })
}

fn retained_node_rows<'a>(observation: &'a Value, node_id: &str) -> Option<&'a [Value]> {
    observation["retainedState"]["byNode"]
        .as_array()?
        .iter()
        .find(|node| node["nodeId"] == node_id)?["rows"]
        .as_array()
        .map(Vec::as_slice)
}

fn expected_children_index_keys(
    replay: &graph_stage_b::GraphReplay,
) -> BTreeSet<(String, String, String)> {
    let mut expected = BTreeSet::new();
    for node in &replay.plan.nodes {
        let (parent_node_id, child_node_id) = match node {
            GraphNodeV1::EqualityToOne {
                parent_node_id,
                node_id,
                ..
            }
            | GraphNodeV1::BoundedToMany {
                parent_node_id,
                node_id,
                ..
            }
            | GraphNodeV1::PrincipalBound {
                parent_node_id,
                node_id,
                ..
            } => (parent_node_id, node_id),
            _ => continue,
        };
        let parents = retained_node_rows(&replay.before, parent_node_id).unwrap_or_else(|| {
            panic!(
                "{}: predecessor rows for children-index parent {parent_node_id}",
                replay.case["id"],
            )
        });
        for parent in parents {
            let parent_row_id = parent["row"]["_id"]
                .as_str()
                .expect("fixture-derived predecessor parent row id");
            assert_eq!(
                parent["key"]["id"], parent_row_id,
                "{}: predecessor parent physical key agrees with its fixture row",
                replay.case["id"],
            );
            assert!(
                expected.insert((
                    parent_node_id.clone(),
                    parent_row_id.to_owned(),
                    child_node_id.clone(),
                )),
                "{}: fixture-derived children-index scope keys are unique",
                replay.case["id"],
            );
        }
    }
    expected
}

fn shipped_children_index_keys(
    replay: &graph_stage_b::GraphReplay,
) -> BTreeSet<(String, String, String)> {
    let entries = replay.after["retainedState"]["children"]
        .as_array()
        .expect("successor retained scope-keyed child index");
    let keys = entries
        .iter()
        .map(|entry| {
            (
                entry["parentNodeId"]
                    .as_str()
                    .expect("retained child-index parent node id")
                    .to_owned(),
                entry["scope"]
                    .as_str()
                    .expect("retained child-index parent row id")
                    .to_owned(),
                entry["nodeId"]
                    .as_str()
                    .expect("retained child-index child node id")
                    .to_owned(),
            )
        })
        .collect::<BTreeSet<_>>();
    assert_eq!(
        entries.len(),
        keys.len(),
        "{}: retained children index has unique scope keys",
        replay.case["id"],
    );
    keys
}

fn graph_reference_root(
    replay: &graph_stage_b::GraphReplay,
    node_id: &str,
) -> GraphReferenceMirror {
    let Some(GraphNodeV1::RootWindow {
        table,
        visibility,
        filters,
        order,
        ..
    }) = replay
        .plan
        .nodes
        .iter()
        .find(|node| node.node_id() == node_id)
    else {
        return GraphReferenceMirror::Gap(format!("{node_id}: matched node is not E3"));
    };
    let order = reference_order(order);
    let Some(retained_rows) = retained_node_rows(&replay.before, node_id) else {
        return GraphReferenceMirror::Gap(format!(
            "{node_id}: predecessor retained evaluator rows are not observable"
        ));
    };
    let retained_ids = retained_rows
        .iter()
        .map(|instance| {
            instance["key"]["id"]
                .as_str()
                .expect("physical retained root id")
                .to_owned()
        })
        .collect::<Vec<_>>();
    let retained = retained_rows
        .iter()
        .map(|instance| {
            let id = instance["key"]["id"]
                .as_str()
                .expect("physical retained root id")
                .to_owned();
            (id, row(instance["row"].clone()))
        })
        .collect::<BTreeMap<_, _>>();
    let change = replay.change.as_ref().expect("commit replay change");
    if change.table != *table {
        return GraphReferenceMirror::Gap(format!(
            "{node_id}: changed relation {} is not the E3 input {table}",
            change.table
        ));
    }
    let input = match graph_reference_input(replay) {
        Ok(input) => input,
        Err(reason) => return GraphReferenceMirror::Gap(format!("{node_id}: {reason}")),
    };
    let admit_plan = QueryPlan {
        table: table.clone(),
        table_visibility: Some(visibility.clone()),
        filters: filters.clone(),
        order: Vec::new(),
        limit: None,
        membership_filters: Vec::new(),
        indexed_by: None,
    };
    if reference_visibility(&admit_plan, &input).is_none()
        || admit_plan
            .filters
            .iter()
            .any(|filter| reference_filter(filter, &input).is_none())
    {
        return GraphReferenceMirror::Gap(format!(
            "{node_id}: case JSON cannot independently derive E0 visibility/filter admission"
        ));
    }
    let delta_out = match reference_admit_batch(
        &admit_plan,
        &input,
        retained.clone(),
        std::slice::from_ref(change),
        AdmissionGrain::Window,
        order.clone(),
    ) {
        FormVerdict::Maintain { delta_out, .. } => delta_out,
        FormVerdict::Fallback { reason } => {
            return GraphReferenceMirror::Fallback { form: "E0", reason };
        }
    };
    let demand = replay.call["windows"]
        .as_array()
        .expect("graph windows")
        .iter()
        .find(|window| window["nodeId"] == node_id)
        .expect("matched root window demand");
    let take = demand["intervals"][0]["window"]["take"]
        .as_u64()
        .expect("window take") as usize;
    let capture = replay.before["capturedDependencies"]
        .as_array()
        .expect("captured graph dependencies")
        .iter()
        .find(|capture| capture["nodeId"] == node_id)
        .expect("root capture");
    let complete = capture["dependency"]["complete"]
        .as_bool()
        .expect("root capture completeness");
    let rows = retained_ids
        .iter()
        .map(|id| {
            let retained_row = retained.get(id).expect("retained root row").clone();
            RankedRow {
                row_key: id.clone(),
                rank_keys: reference_rank(&retained_row, &order, id),
                row: retained_row,
            }
        })
        .collect::<Vec<_>>();
    let boundary = rows.last().map(|row| row.rank_keys.clone());
    let projection_fields = projection_fields_by_node(&replay.plan)
        .remove(node_id)
        .unwrap_or_default();
    let admissions = delta_out
        .entries
        .iter()
        .map(|entry| (entry.row_key.clone(), entry.admit))
        .collect::<Vec<_>>();
    match evaluate_window(
        &WindowConfig {
            window_id: node_id.to_owned(),
            order,
            interval: Interval::default(),
            take,
            projection_fields,
        },
        WindowState {
            result_count: rows.len(),
            rows,
            boundary: boundary.clone(),
            complete,
            label: if complete {
                CompletenessLabel::Complete
            } else {
                CompletenessLabel::Incomplete
            },
            continuation: boundary,
        },
        delta_out,
        &ReadTranscript::default(),
    ) {
        FormVerdict::Maintain {
            delta_out,
            next_state,
        } => {
            let patches = delta_out
                .ops
                .iter()
                .filter_map(|op| match op {
                    SeqOp::Patch { row_key, post, .. } => Some(ReferenceWirePatch {
                        node_id: node_id.to_owned(),
                        root_key: row_key.clone(),
                        key: row_key.clone(),
                        row: post.clone(),
                    }),
                    _ => None,
                })
                .collect();
            let projected_fields = delta_out
                .ops
                .iter()
                .filter_map(|op| match op {
                    SeqOp::Patch { post, .. } => Some(post.keys().cloned()),
                    _ => None,
                })
                .flatten()
                .collect();
            GraphReferenceMirror::Maintain {
                form: "E0+E3",
                projected_fields,
                patches,
                next_state: GraphReferenceState::Window {
                    node_id: node_id.to_owned(),
                    admissions,
                    state: next_state,
                },
            }
        }
        FormVerdict::Fallback { reason } => GraphReferenceMirror::Fallback { form: "E3", reason },
    }
}

fn node_has_to_many_ancestor(plan: &snapback::manifest::GraphQueryPlanV1, node_id: &str) -> bool {
    let mut current = node_id;
    loop {
        let Some(node) = plan.nodes.iter().find(|node| node.node_id() == current) else {
            return false;
        };
        let parent = match node {
            GraphNodeV1::EqualityToOne { parent_node_id, .. }
            | GraphNodeV1::BoundedToMany { parent_node_id, .. }
            | GraphNodeV1::ExistsSemiJoin { parent_node_id, .. }
            | GraphNodeV1::PrincipalBound { parent_node_id, .. } => parent_node_id,
            _ => return false,
        };
        if matches!(
            plan.nodes.iter().find(|node| node.node_id() == parent),
            Some(GraphNodeV1::BoundedToMany { .. })
        ) {
            return true;
        }
        current = parent;
    }
}

fn graph_reference_lookup(
    replay: &graph_stage_b::GraphReplay,
    node_id: &str,
) -> GraphReferenceMirror {
    let Some(GraphNodeV1::EqualityToOne {
        parent_node_id,
        table,
        join_on,
        access_index,
        presence,
        ..
    }) = replay
        .plan
        .nodes
        .iter()
        .find(|node| node.node_id() == node_id)
    else {
        return GraphReferenceMirror::Gap(format!("{node_id}: no E4 case adapter"));
    };
    let projection_fields = projection_fields_by_node(&replay.plan)
        .remove(node_id)
        .unwrap_or_default();
    let config = LookupConfig {
        index: access_index.clone(),
        parent_join_fields: join_on.iter().map(|join| join.root_field.clone()).collect(),
        child_join_fields: join_on
            .iter()
            .map(|join| join.joined_field.clone())
            .collect(),
        presence: match presence {
            GraphToOnePresenceV1::Optional => Presence::Optional,
            GraphToOnePresenceV1::Required => Presence::Required,
        },
        projection_fields,
    };
    let Some(retained_children) = retained_node_rows(&replay.before, node_id) else {
        return GraphReferenceMirror::Gap(format!(
            "{node_id}: predecessor retained evaluator children are not observable"
        ));
    };
    let mut state = LookupState::default();
    for capture in replay.before["capturedDependencies"]
        .as_array()
        .expect("captured graph dependencies")
        .iter()
        .filter(|capture| capture["nodeId"] == node_id)
    {
        let dependency = &capture["dependency"];
        let scope = dependency["parentKey"]["id"]
            .as_str()
            .expect("E4 parent scope")
            .to_owned();
        let child_key = dependency["childKey"]["id"].as_str().map(str::to_owned);
        state.scopes.insert(
            scope,
            LookupScopeState {
                lookup_key: dependency["lookupKey"]
                    .as_array()
                    .map(|values| values.clone()),
                child_key: child_key.clone(),
                found: dependency["found"].as_bool().unwrap_or(false),
                row_version: dependency["rowVersion"].as_u64(),
            },
        );
        if let Some(child_key) = child_key
            && let Some(child) = retained_children
                .iter()
                .find(|instance| instance["key"]["id"] == child_key)
        {
            state.children.insert(child_key, row(child["row"].clone()));
        }
    }
    let change = replay.change.as_ref().expect("commit replay change");
    let before_image = replay
        .before_rows
        .iter()
        .find(|candidate| candidate["_id"] == change.id)
        .cloned()
        .map(row);
    let change_entry = DeltaZEntry {
        row_key: change.id.clone(),
        op: ReferenceChangeOp::Update,
        post_image: change.row.clone().map(row),
        pre_image: before_image,
        admit: Admission::StayIn,
        rank_keys: Vec::new(),
    };
    let parent_table = replay
        .plan
        .nodes
        .iter()
        .find(|node| node.node_id() == parent_node_id)
        .and_then(|node| match node {
            GraphNodeV1::RootWindow { table, .. }
            | GraphNodeV1::EqualityToOne { table, .. }
            | GraphNodeV1::BoundedToMany { table, .. }
            | GraphNodeV1::PrincipalBound { table, .. } => Some(table.as_str()),
            _ => None,
        });
    let mut input = LookupInput::default();
    let mut reads = ReadTranscript::default();
    if change.table == *table {
        input.child.entries.push(change_entry);
    } else if parent_table == Some(change.table.as_str()) {
        let post = change.row.as_ref().expect("parent update post image");
        let key = config
            .parent_join_fields
            .iter()
            .map(|field| post.get(field).cloned().unwrap_or(Value::Null))
            .collect::<Vec<_>>();
        let child = replay
            .reference_read_rows
            .get(table)
            .unwrap_or_else(|| panic!("{node_id}: post-change reference point-read table {table}"))
            .iter()
            .find(|candidate| {
                config
                    .child_join_fields
                    .iter()
                    .zip(&key)
                    .all(|(field, value)| candidate.get(field) == Some(value))
            })
            .cloned()
            .map(row);
        reads.0.push(ReadPair {
            request: ReadRequest::Point {
                index: config.index.clone(),
                key,
            },
            response: ReadResponse::Point { row: child },
        });
        input.parent.entries.push(change_entry);
    } else {
        return GraphReferenceMirror::Gap(format!(
            "{node_id}: changed relation {} is neither E4 parent nor child",
            change.table
        ));
    }
    let inner = evaluate_lookup(&config, state, input, &reads);
    if node_has_to_many_ancestor(&replay.plan, node_id) {
        assert!(matches!(inner, FormVerdict::Maintain { .. }));
        return GraphReferenceMirror::Fallback {
            form: "E4+wire-lowering",
            reason: FallbackReason::WireUnaddressable,
        };
    }
    match inner {
        FormVerdict::Maintain {
            delta_out,
            next_state,
        } => {
            let patches = delta_out
                .ops
                .iter()
                .filter_map(|op| match op {
                    LookupDeltaOp::Patch {
                        scope,
                        child_key,
                        fields,
                    } => Some(ReferenceWirePatch {
                        node_id: node_id.to_owned(),
                        root_key: scope.clone(),
                        key: child_key.clone(),
                        row: fields.clone(),
                    }),
                    LookupDeltaOp::Presence { .. } => None,
                })
                .collect();
            let projected_fields = delta_out
                .ops
                .iter()
                .filter_map(|op| match op {
                    LookupDeltaOp::Patch { fields, .. } => Some(fields.keys().cloned()),
                    LookupDeltaOp::Presence { value, .. } => {
                        value.as_ref().map(|value| value.keys().cloned())
                    }
                })
                .flatten()
                .collect();
            GraphReferenceMirror::Maintain {
                form: "E4",
                projected_fields,
                patches,
                next_state: GraphReferenceState::Lookup {
                    node_id: node_id.to_owned(),
                    state: next_state,
                },
            }
        }
        FormVerdict::Fallback { reason } => GraphReferenceMirror::Fallback { form: "E4", reason },
    }
}

fn assert_graph_reference_state_matches_shipped(
    replay: &graph_stage_b::GraphReplay,
    state: &GraphReferenceState,
    comparison_gaps: &mut BTreeSet<String>,
    independent_e3_admissions: &mut BTreeMap<String, Admission>,
) {
    match state {
        GraphReferenceState::Window {
            node_id,
            admissions,
            state,
        } => {
            assert!(
                replay.disposition["matchedNodeIds"]
                    .as_array()
                    .expect("executed matched node ids")
                    .iter()
                    .any(|matched| matched == node_id),
                "{}: E3 state belongs to an executed matched node",
                replay.case["id"],
            );
            let [(row_key, admission)] = admissions.as_slice() else {
                panic!(
                    "{}: each executed E3 replay must derive exactly one E0 admission tag",
                    replay.case["id"],
                )
            };
            assert_eq!(
                Some(row_key.as_str()),
                replay.change.as_ref().map(|change| change.id.as_str()),
                "{}: independently admitted row is the replayed change",
                replay.case["id"],
            );
            let case = replay.case["id"]
                .as_str()
                .expect("executed graph case id")
                .to_owned();
            assert!(
                independent_e3_admissions.insert(case, *admission).is_none(),
                "{}: E3 admission tag is asserted exactly once",
                replay.case["id"],
            );
            let shipped_rows = retained_node_rows(&replay.after, node_id)
                .expect("successor retained E3 rows are observable");
            let shipped_ids = shipped_rows
                .iter()
                .map(|instance| {
                    instance["key"]["id"]
                        .as_str()
                        .expect("physical retained root id")
                })
                .collect::<Vec<_>>();
            let reference_ids = state
                .rows
                .iter()
                .map(|row| row.row_key.as_str())
                .collect::<Vec<_>>();
            assert_eq!(
                reference_ids, shipped_ids,
                "{}: E3 next-state membership/order versus shipped successor",
                replay.case["id"],
            );
            assert_eq!(state.result_count, shipped_ids.len());
            for reference_row in &state.rows {
                let shipped_row = shipped_rows
                    .iter()
                    .find(|instance| instance["key"]["id"] == reference_row.row_key)
                    .unwrap_or_else(|| {
                        panic!("{}: shipped retained successor row", reference_row.row_key)
                    });
                assert_eq!(
                    reference_row.row,
                    row(shipped_row["row"].clone()),
                    "{}: E3 retained row state",
                    replay.case["id"],
                );
            }

            let GraphNodeV1::RootWindow { order, .. } = replay
                .plan
                .nodes
                .iter()
                .find(|node| node.node_id() == node_id.as_str())
                .expect("matched E3 node")
            else {
                panic!("{node_id}: window state compared against non-E3 node")
            };
            let order = reference_order(order);
            let shipped_boundary = shipped_rows.last().map(|instance| {
                let row = row(instance["row"].clone());
                let id = instance["key"]["id"]
                    .as_str()
                    .expect("physical retained root id");
                reference_rank(&row, &order, id)
            });
            assert_eq!(
                state.boundary, shipped_boundary,
                "{}: E3 next-state boundary",
                replay.case["id"],
            );

            let has_more = replay.after["retainedState"]["hasMore"]
                .as_array()
                .expect("successor retained completeness bits")
                .iter()
                .find(|entry| entry["nodeId"] == node_id.as_str() && entry["scope"] == "")
                .and_then(|entry| entry["value"].as_bool())
                .expect("root retained completeness bit");
            assert_eq!(
                state.complete, !has_more,
                "{}: E3 next-state completeness bit",
                replay.case["id"],
            );
            let shipped_label = replay.after["nodeCompleteness"]
                .as_array()
                .expect("successor node completeness")
                .iter()
                .find(|proof| proof["nodeId"] == node_id.as_str())
                .and_then(|proof| proof["label"].as_str())
                .expect("root completeness label");
            let expected_label = match state.label {
                CompletenessLabel::Complete => "complete",
                CompletenessLabel::Incomplete => "prefix",
                CompletenessLabel::ZeroTakeUnproved => "unknown",
            };
            assert_eq!(
                shipped_label, expected_label,
                "{}: E3 next-state completeness label",
                replay.case["id"],
            );

            let shipped_continuation = replay.after["retainedState"]["continuations"]
                .as_array()
                .expect("successor retained continuations")
                .iter()
                .find(|entry| entry["nodeId"] == node_id.as_str() && entry["scope"] == "")
                .map(|entry| &entry["value"]);
            if state.complete {
                assert!(
                    shipped_continuation.is_none(),
                    "{}: complete shipped E3 state must not retain a serving continuation",
                    replay.case["id"],
                );
                if state.continuation.is_some() {
                    comparison_gaps.insert(format!(
                        "{}: E3 continuation is not a comparable axis for a complete window (the reference state retains its boundary cursor; shipped serving state omits pagination continuation)",
                        replay.case["id"].as_str().unwrap()
                    ));
                }
            } else {
                let continuation = state
                    .continuation
                    .as_ref()
                    .expect("incomplete reference window continuation");
                let expected = json!({
                    "entries": order.iter().zip(&continuation.values).map(|(field, value)| {
                        json!([field.field, value])
                    }).collect::<Vec<_>>(),
                    "id": continuation.row_key,
                });
                assert_eq!(
                    shipped_continuation,
                    Some(&expected),
                    "{}: E3 next-state continuation",
                    replay.case["id"],
                );
            }
        }
        GraphReferenceState::Lookup { node_id, state } => {
            let node = replay
                .plan
                .nodes
                .iter()
                .find(|node| node.node_id() == node_id.as_str())
                .expect("matched E4 node");
            let GraphNodeV1::EqualityToOne {
                parent_node_id,
                table,
                ..
            } = node
            else {
                panic!("{node_id}: lookup state compared against non-E4 node")
            };
            let captures = replay.after["capturedDependencies"]
                .as_array()
                .expect("successor captured dependencies")
                .iter()
                .filter(|capture| capture["nodeId"] == node_id.as_str())
                .collect::<Vec<_>>();
            assert_eq!(state.scopes.len(), captures.len());
            for capture in captures {
                let dependency = &capture["dependency"];
                let scope = dependency["parentKey"]["id"]
                    .as_str()
                    .expect("E4 successor parent scope");
                let reference = state.scopes.get(scope).expect("E4 reference scope");
                assert_eq!(
                    reference.lookup_key.as_ref(),
                    dependency["lookupKey"].as_array(),
                    "{}: E4 lookup-key transition",
                    replay.case["id"],
                );
                assert_eq!(
                    reference.child_key.as_deref(),
                    dependency["childKey"]["id"].as_str(),
                    "{}: E4 child-address transition",
                    replay.case["id"],
                );
                assert_eq!(
                    reference.found,
                    dependency["found"].as_bool().unwrap_or(false),
                    "{}: E4 presence transition",
                    replay.case["id"],
                );
            }

            let child_index = replay.after["retainedState"]["children"]
                .as_array()
                .expect("successor retained scope-keyed child index");
            assert_eq!(
                expected_children_index_keys(replay),
                shipped_children_index_keys(replay),
                "{}: complete E4 children-index scope keys",
                replay.case["id"],
            );
            let shipped_scopes = child_index
                .iter()
                .filter(|entry| {
                    entry["parentNodeId"] == parent_node_id.as_str()
                        && entry["nodeId"] == node_id.as_str()
                })
                .collect::<Vec<_>>();
            assert_eq!(
                state.scopes.len(),
                shipped_scopes.len(),
                "{}: E4 scope-index cardinality",
                replay.case["id"],
            );
            let reference_scope_ids = state.scopes.keys().cloned().collect::<BTreeSet<_>>();
            let shipped_scope_ids = shipped_scopes
                .iter()
                .map(|entry| {
                    entry["scope"]
                        .as_str()
                        .expect("retained E4 child scope")
                        .to_owned()
                })
                .collect::<BTreeSet<_>>();
            assert_eq!(
                reference_scope_ids, shipped_scope_ids,
                "{}: E4 scope-index identities",
                replay.case["id"],
            );

            let parent_rows = retained_node_rows(&replay.before, parent_node_id)
                .expect("predecessor retained E4 parent rows are observable");
            let mut expected_instances = Vec::new();
            for (scope, reference) in &state.scopes {
                let parents = parent_rows
                    .iter()
                    .filter(|instance| instance["row"]["_id"] == scope.as_str())
                    .collect::<Vec<_>>();
                assert_eq!(
                    parents.len(),
                    1,
                    "{}: E4 scope {scope} has one retained parent instance",
                    replay.case["id"],
                );
                let expected_root_key = parents[0]["rootKey"].clone();
                let shipped_scope = shipped_scopes
                    .iter()
                    .find(|entry| entry["scope"] == scope.as_str())
                    .expect("retained E4 scope entry");
                let shipped_children = shipped_scope["rows"]
                    .as_array()
                    .expect("retained E4 scope rows");
                assert_eq!(
                    shipped_children.len(),
                    usize::from(reference.child_key.is_some()),
                    "{}: E4 per-scope child cardinality for {scope}",
                    replay.case["id"],
                );
                let retained_row_version = reference
                    .child_key
                    .as_ref()
                    .map(|child_id| {
                        let shipped_child = &shipped_children[0];
                        let reference_row = state
                            .children
                            .get(child_id)
                            .unwrap_or_else(|| panic!("{child_id}: reference E4 retained child"));
                        let expected_instance = json!({
                            "key": {"table": table, "id": child_id},
                            "rootKey": expected_root_key,
                            "row": reference_row,
                        });
                        assert_eq!(
                            shipped_child, &expected_instance,
                            "{}: E4 scoped child identity, root key, and row for {scope}",
                            replay.case["id"],
                        );
                        expected_instances.push(expected_instance);
                        shipped_child["row"]["_version"].as_u64()
                    })
                    .flatten();
                assert_eq!(
                    reference.row_version, retained_row_version,
                    "{}: E4 retained row-version equality for scope {scope}",
                    replay.case["id"],
                );
            }

            let shipped_rows = retained_node_rows(&replay.after, node_id)
                .expect("successor retained E4 rows are observable");
            assert_eq!(
                expected_instances.len(),
                shipped_rows.len(),
                "{}: E4 flattened child-instance cardinality",
                replay.case["id"],
            );
            let mut unmatched = shipped_rows.to_vec();
            for expected in expected_instances {
                let index = unmatched
                    .iter()
                    .position(|actual| actual == &expected)
                    .unwrap_or_else(|| {
                        panic!(
                            "{}: flattened E4 state lacks exact scoped child {expected}",
                            replay.case["id"],
                        )
                    });
                unmatched.remove(index);
            }
            assert!(
                unmatched.is_empty(),
                "{}: flattened E4 state has no extra child instances",
                replay.case["id"],
            );
        }
        GraphReferenceState::Composite(states) => {
            assert!(states.len() > 1, "composite reference owns multiple forms");
            for state in states {
                assert_graph_reference_state_matches_shipped(
                    replay,
                    state,
                    comparison_gaps,
                    independent_e3_admissions,
                );
            }
        }
    }
}

fn execute_graph_reference(replay: &graph_stage_b::GraphReplay) -> GraphReferenceMirror {
    if replay.change.is_none() {
        return GraphReferenceMirror::Gap(
            "demand supersession is not a DeltaApp change".to_owned(),
        );
    }
    let matched = replay.disposition["matchedNodeIds"]
        .as_array()
        .expect("executed matched node ids");
    if matched.len() > 1 {
        let node_ids = matched
            .iter()
            .map(|node| node.as_str().expect("matched node id"))
            .collect::<Vec<_>>();
        if node_ids.iter().all(|node_id| {
            matches!(
                replay
                    .plan
                    .nodes
                    .iter()
                    .find(|node| node.node_id() == *node_id),
                Some(GraphNodeV1::EqualityToOne { .. })
            ) && !node_has_to_many_ancestor(&replay.plan, node_id)
        }) {
            let mut projected_fields = BTreeSet::new();
            let mut patches = Vec::new();
            let mut states = Vec::new();
            for node_id in node_ids {
                match graph_reference_lookup(replay, node_id) {
                    GraphReferenceMirror::Maintain {
                        projected_fields: fields,
                        patches: reference_patches,
                        next_state,
                        ..
                    } => {
                        projected_fields.extend(fields);
                        patches.extend(reference_patches);
                        states.push(next_state);
                    }
                    GraphReferenceMirror::Fallback { reason, .. } => {
                        return GraphReferenceMirror::Fallback {
                            form: "E4 composite",
                            reason,
                        };
                    }
                    GraphReferenceMirror::Gap(reason) => {
                        return GraphReferenceMirror::Gap(reason);
                    }
                }
            }
            return GraphReferenceMirror::Maintain {
                form: "E4 composite",
                projected_fields,
                patches,
                next_state: GraphReferenceState::Composite(states),
            };
        }
        return GraphReferenceMirror::Gap(format!(
            "{} matched nodes require an E5/to-many composition adapter",
            matched.len()
        ));
    }
    let node_id = matched[0].as_str().expect("matched node id");
    match replay
        .plan
        .nodes
        .iter()
        .find(|node| node.node_id() == node_id)
    {
        Some(GraphNodeV1::RootWindow { .. }) => {
            let change = replay.change.as_ref().expect("commit replay change");
            let affected_lookups = replay
                .plan
                .nodes
                .iter()
                .filter_map(|node| match node {
                    GraphNodeV1::EqualityToOne {
                        node_id: child_id,
                        parent_node_id,
                        join_on,
                        ..
                    } if parent_node_id == node_id
                        && join_on
                            .iter()
                            .any(|join| change.changed_fields.contains(&join.root_field)) =>
                    {
                        Some(child_id.as_str())
                    }
                    _ => None,
                })
                .collect::<Vec<_>>();
            match affected_lookups.as_slice() {
                [] => graph_reference_root(replay, node_id),
                [child_id] => graph_reference_lookup(replay, child_id),
                _ => GraphReferenceMirror::Gap(format!(
                    "{node_id}: root change affects {} E4 relationships",
                    affected_lookups.len()
                )),
            }
        }
        Some(GraphNodeV1::EqualityToOne { .. }) => graph_reference_lookup(replay, node_id),
        Some(node) => GraphReferenceMirror::Gap(format!(
            "{node_id}: {:?} has no faithful Stage-B case adapter",
            node.kind()
        )),
        None => GraphReferenceMirror::Gap(format!("{node_id}: absent from actual plan")),
    }
}

fn install_result_contract(function: &mut FunctionDefinition, contract: FunctionResultContract) {
    let value = serde_json::to_value(&contract).expect("serialize result contract");
    let canonical = snapback::rqs::jcs(&value).expect("canonical result contract");
    let mut hash = Sha256::new();
    hash.update(b"snapback:function-result:v1\n");
    hash.update(canonical.as_bytes());
    function.result_contract = contract;
    function.result_contract_hash = Some(format!("sha256:{:x}", hash.finalize()));
    function
        .required_capabilities
        .push("result_contract_v1".to_owned());
}

fn todo_contract() -> FunctionResultContract {
    FunctionResultContract::Documents {
        table: "todos".to_owned(),
        document: todo_row_contract(),
    }
}

fn todo_row_contract() -> ResultValueContract {
    let system_integer = || ResultValueContract::Integer {
        min: 0,
        max: 9_007_199_254_740_991,
    };
    ResultValueContract::Object {
        fields: vec![
            ResultObjectFieldContract {
                name: "_id".to_owned(),
                required: true,
                value: ResultValueContract::Id {
                    table: "todos".to_owned(),
                },
            },
            ResultObjectFieldContract {
                name: "_version".to_owned(),
                required: true,
                value: system_integer(),
            },
            ResultObjectFieldContract {
                name: "_createdAt".to_owned(),
                required: true,
                value: system_integer(),
            },
            ResultObjectFieldContract {
                name: "_updatedAt".to_owned(),
                required: true,
                value: system_integer(),
            },
            ResultObjectFieldContract {
                name: "title".to_owned(),
                required: true,
                value: ResultValueContract::String {
                    max_bytes: 1024 * 1024,
                },
            },
            ResultObjectFieldContract {
                name: "userId".to_owned(),
                required: true,
                value: ResultValueContract::String {
                    max_bytes: 1024 * 1024,
                },
            },
        ],
        allow_extra: false,
    }
}

fn serving_fixture() -> LocalSnapback {
    let mut snapback = LocalSnapback::memory().expect("memory Stage-B fixture");
    snapback
        .apply_schema(SchemaManifest {
            schema_hash: Some("stage-b-dk3".to_owned()),
            tables: vec![TableManifest {
                name: "todos".to_owned(),
                fields: vec![
                    FieldManifest {
                        name: "title".to_owned(),
                        field_type: FieldType::String,
                        optional: false,
                    },
                    FieldManifest {
                        name: "userId".to_owned(),
                        field_type: FieldType::String,
                        optional: false,
                    },
                ],
                indexes: Vec::new(),
                search_indexes: Vec::new(),
                vector_indexes: Vec::new(),
                search_live_limits: None,
                syncable: true,
                permission_backing: false,
                permission_fields: None,
                membership: None,
                authority_profile: None,
                asset_sharing: None,
                visibility: Some(TableVisibilityV1::PublicRead),
                history: None,
            }],
            ..SchemaManifest::default()
        })
        .expect("Stage-B schema");
    let mut list = FunctionDefinition::new(
        "listMine",
        FunctionKind::LiveQuery,
        FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
            filters: vec![FilterExpr {
                field: "userId".to_owned(),
                op: ShippedFilterOp::Eq,
                value: ValueExpr::AuthUserId,
            }],
            ..base_plan()
        })),
    );
    install_result_contract(&mut list, todo_contract());
    let mut narrow = FunctionDefinition::new(
        "listMineNarrow",
        FunctionKind::LiveQuery,
        FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
            filters: vec![FilterExpr {
                field: "userId".to_owned(),
                op: ShippedFilterOp::Eq,
                value: ValueExpr::AuthUserId,
            }],
            ..base_plan()
        })),
    );
    install_result_contract(
        &mut narrow,
        FunctionResultContract::Records {
            record: todo_row_contract(),
            rows: None,
        },
    );
    let create = FunctionDefinition::new(
        "createTodo",
        FunctionKind::Mutation,
        FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
            owner_write_checks: Vec::new(),
            steps: vec![MutationStep::Insert {
                table: "todos".to_owned(),
                values: BTreeMap::from([
                    ("title".to_owned(), ValueExpr::Arg("title".to_owned())),
                    ("userId".to_owned(), ValueExpr::Arg("userId".to_owned())),
                ]),
                bind_id_as: Some("id".to_owned()),
            }],
            return_value: Some(ReturnValue::Binding("id".to_owned())),
        })),
    );
    let patch = FunctionDefinition::new(
        "patchTodo",
        FunctionKind::Mutation,
        FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
            owner_write_checks: Vec::new(),
            steps: vec![MutationStep::Patch {
                table: "todos".to_owned(),
                id: ValueExpr::Arg("id".to_owned()),
                values: BTreeMap::from([("title".to_owned(), ValueExpr::Arg("title".to_owned()))]),
            }],
            return_value: Some(ReturnValue::ChangedCount),
        })),
    );
    let delete = FunctionDefinition::new(
        "deleteTodo",
        FunctionKind::Mutation,
        FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
            owner_write_checks: Vec::new(),
            steps: vec![MutationStep::Delete {
                table: "todos".to_owned(),
                id: ValueExpr::Arg("id".to_owned()),
            }],
            return_value: Some(ReturnValue::ChangedCount),
        })),
    );
    let diagnostics = snapback.load_functions(FunctionManifest {
        bundle_hash: Some("stage-b-dk3-functions".to_owned()),
        acknowledged_experimental_capabilities: vec!["result_contract_v1".to_owned()],
        functions: vec![list, narrow, create, patch, delete],
        ..FunctionManifest::default()
    });
    assert!(
        diagnostics.is_empty(),
        "fixture diagnostics: {diagnostics:#?}"
    );
    snapback
}

fn drain_json(snapback: &mut LocalSnapback, connection: &str) -> Vec<Value> {
    snapback
        .drain_outbox(connection)
        .into_iter()
        .filter_map(|envelope| match envelope {
            RealtimeEnvelope::Durable(message) => {
                Some(serde_json::from_slice(&message.payload).expect("durable frame is JSON"))
            }
            RealtimeEnvelope::Ephemeral(_) => None,
        })
        .collect()
}

#[test]
fn stage_b_rederivation_audit_is_fully_classified() {
    eprintln!("stage-b-audit: dk3-inner");
    let mut divergences = Vec::new();

    // DK-3 inner core: replay the classifier unit families and the important
    // live_delta_v0 regression shapes through shipped E0 and reference E0.
    let unfiltered = base_plan();
    let filtered = user_plan();
    let empty = handler_input(json!({}), None);
    let mine = handler_input(json!({"userId":"u1"}), Some("u1"));
    assert_dk3_agreement(
        "unfiltered-add",
        &unfiltered,
        &empty,
        &[],
        &[changed(
            "todos",
            "a",
            ShippedChangeOp::Insert,
            Some(audit_row("a", "u1")),
            &[],
        )],
    );
    assert_dk3_agreement(
        "unfiltered-update",
        &unfiltered,
        &empty,
        &["a"],
        &[changed(
            "todos",
            "a",
            ShippedChangeOp::Update,
            Some(audit_row("a", "u1")),
            &["title"],
        )],
    );
    assert_dk3_agreement(
        "unfiltered-remove",
        &unfiltered,
        &empty,
        &["a"],
        &[changed("todos", "a", ShippedChangeOp::Delete, None, &[])],
    );
    assert_dk3_agreement(
        "filtered-match",
        &filtered,
        &mine,
        &[],
        &[changed(
            "todos",
            "a",
            ShippedChangeOp::Insert,
            Some(audit_row("a", "u1")),
            &[],
        )],
    );
    assert_dk3_agreement(
        "filtered-nonmatch",
        &filtered,
        &mine,
        &[],
        &[changed(
            "todos",
            "b",
            ShippedChangeOp::Insert,
            Some(audit_row("b", "u2")),
            &[],
        )],
    );
    assert_dk3_agreement(
        "filtered-move-in",
        &filtered,
        &mine,
        &[],
        &[changed(
            "todos",
            "a",
            ShippedChangeOp::Update,
            Some(audit_row("a", "u1")),
            &["userId"],
        )],
    );
    assert_dk3_agreement(
        "filtered-move-out",
        &filtered,
        &mine,
        &["a"],
        &[changed(
            "todos",
            "a",
            ShippedChangeOp::Update,
            Some(audit_row("a", "u2")),
            &["userId"],
        )],
    );
    assert_dk3_agreement(
        "delete-nonmember",
        &filtered,
        &mine,
        &[],
        &[changed("todos", "a", ShippedChangeOp::Delete, None, &[])],
    );
    assert_dk3_agreement(
        "other-table",
        &filtered,
        &mine,
        &[],
        &[changed(
            "other",
            "a",
            ShippedChangeOp::Insert,
            Some(json!({"_id":"a"})),
            &[],
        )],
    );
    assert_dk3_agreement(
        "multi-row",
        &filtered,
        &mine,
        &["old"],
        &[
            changed(
                "todos",
                "new",
                ShippedChangeOp::Insert,
                Some(audit_row("new", "u1")),
                &[],
            ),
            changed("todos", "old", ShippedChangeOp::Delete, None, &[]),
            changed(
                "todos",
                "other",
                ShippedChangeOp::Insert,
                Some(audit_row("other", "u2")),
                &[],
            ),
        ],
    );
    assert_dk3_agreement(
        "insert-delete-fold",
        &filtered,
        &mine,
        &[],
        &[
            changed(
                "todos",
                "a",
                ShippedChangeOp::Insert,
                Some(audit_row("a", "u1")),
                &[],
            ),
            changed("todos", "a", ShippedChangeOp::Delete, None, &[]),
        ],
    );
    let mut null_plan = base_plan();
    null_plan.filters = vec![FilterExpr {
        field: "priority".to_owned(),
        op: ShippedFilterOp::Lt,
        value: ValueExpr::Literal(json!(3)),
    }];
    let mut null_row = audit_row("a", "u1");
    null_row["priority"] = Value::Null;
    assert_dk3_agreement(
        "sql-null-three-valued",
        &null_plan,
        &empty,
        &[],
        &[changed(
            "todos",
            "a",
            ShippedChangeOp::Insert,
            Some(null_row),
            &[],
        )],
    );
    let mut system_plan = base_plan();
    system_plan.filters = vec![FilterExpr {
        field: "_version".to_owned(),
        op: ShippedFilterOp::Eq,
        value: ValueExpr::Literal(json!(1)),
    }];
    let mut v2 = audit_row("a", "u1");
    v2["_version"] = json!(2);
    assert_dk3_agreement(
        "system-field-exit",
        &system_plan,
        &empty,
        &["a"],
        &[changed(
            "todos",
            "a",
            ShippedChangeOp::Update,
            Some(v2),
            &["title"],
        )],
    );
    let owner_plan = QueryPlan {
        table_visibility: Some(TableVisibilityV1::Owner {
            field: "userId".to_owned(),
        }),
        ..base_plan()
    };
    assert_dk3_agreement(
        "owner-visibility-transfer",
        &owner_plan,
        &handler_input(json!({}), Some("u1")),
        &["a"],
        &[changed(
            "todos",
            "a",
            ShippedChangeOp::Update,
            Some(audit_row("a", "u2")),
            &["userId"],
        )],
    );
    assert_dk3_agreement(
        "seed-insert",
        &unfiltered,
        &empty,
        &[],
        &[changed(
            "todos",
            "seeded",
            ShippedChangeOp::Insert,
            Some(audit_row("seeded", "u1")),
            &[],
        )],
    );

    let ordered = QueryPlan {
        order: vec![OrderExpr {
            field: "title".to_owned(),
            direction: OrderDirection::Asc,
            max_encoded_bytes: None,
        }],
        ..base_plan()
    };
    let ordered_change = [changed(
        "todos",
        "a",
        ShippedChangeOp::Insert,
        Some(audit_row("a", "u1")),
        &[],
    )];
    assert_eq!(
        shipped_dk3(&ordered, &empty, &BTreeSet::new(), &ordered_change)["verdict"],
        "Replace"
    );
    let ordered_reference = execute_dk3_window_reference(
        &ordered,
        &empty,
        Vec::new(),
        &ordered_change,
        vec![OrderField {
            field: "title".to_owned(),
            direction: Direction::Asc,
        }],
        1024,
        true,
    );
    assert!(matches!(ordered_reference, FormVerdict::Maintain { .. }));
    divergences.push(Divergence::conservative(
        "eligibility",
        "dk3-ordered",
        "Replace",
        "E0 maintains admission; E3 can maintain with its complete window state",
        "compute_live_delta rejects non-empty order before classification (live_matcher.rs)",
    ));

    let at_cap = QueryPlan {
        limit: Some(1),
        ..base_plan()
    };
    let below_cap = QueryPlan {
        limit: Some(10),
        ..base_plan()
    };
    assert_dk3_agreement(
        "unordered-below-cap",
        &below_cap,
        &empty,
        &["held"],
        &ordered_change,
    );
    assert_eq!(
        shipped_dk3(
            &at_cap,
            &empty,
            &BTreeSet::from(["held".to_owned()]),
            &ordered_change,
        )["verdict"],
        "Replace"
    );
    let mut held = row(audit_row("held", "u1"));
    held.insert("title".to_owned(), json!("held"));
    let at_cap_reference = execute_dk3_window_reference(
        &at_cap,
        &empty,
        vec![held],
        &ordered_change,
        vec![OrderField {
            field: "_id".to_owned(),
            direction: Direction::Asc,
        }],
        1,
        true,
    );
    assert!(matches!(at_cap_reference, FormVerdict::Maintain { .. }));
    divergences.push(Divergence::conservative(
        "eligibility",
        "dk3-at-cap",
        "Replace",
        "E0 maintains; E3 may maintain with authenticated tail/completeness state",
        "DK-3 has only prior ids and cannot prove the unseen boundary competitor",
    ));

    let mut membership = base_plan();
    membership.membership_filters = vec![snapback::manifest::MembershipPredicate {
        declaration: "todo_members".to_owned(),
        resource: snapback::manifest::MembershipResourceRef::RowField("projectId".to_owned()),
        roles: None,
    }];
    let mut membership_row = audit_row("a", "u1");
    membership_row["projectId"] = json!("p1");
    let membership_change = [changed(
        "todos",
        "a",
        ShippedChangeOp::Insert,
        Some(membership_row),
        &[],
    )];
    assert_eq!(
        shipped_dk3(&membership, &empty, &BTreeSet::new(), &membership_change)["verdict"],
        "Replace"
    );
    assert!(matches!(
        execute_membership_reference(&membership, &empty, &membership_change[0]),
        FormVerdict::Maintain { .. }
    ));
    let visibility_membership = QueryPlan {
        table_visibility: Some(TableVisibilityV1::AnyOf {
            arms: vec![
                TableVisibilityArmV1::Owner {
                    field: "userId".to_owned(),
                },
                TableVisibilityArmV1::Membership {
                    declaration: "todo_members".to_owned(),
                    resource_field: "projectId".to_owned(),
                    roles: None,
                },
            ],
        }),
        ..base_plan()
    };
    assert!(matches!(
        execute_membership_reference(&visibility_membership, &empty, &membership_change[0]),
        FormVerdict::Maintain { .. }
    ));
    assert_eq!(
        shipped_dk3(
            &visibility_membership,
            &empty,
            &BTreeSet::new(),
            &membership_change,
        )["verdict"],
        "Replace",
    );
    divergences.push(Divergence::conservative(
        "eligibility",
        "dk3-membership-gated",
        "Replace",
        "E0+E6 can maintain when certified support bits/read transcript are supplied",
        "DK-3 intentionally has no certified semi-join evaluator (LLP 0056 / LLP 0067 F2a)",
    ));

    // Actual serving pass through try_live_delta_fanout: the emitted outer
    // lane performs add/update/remove without a re-query.
    eprintln!("stage-b-audit: dk3-serving");
    let mut serving = serving_fixture();
    let serving_plan = QueryPlan {
        filters: vec![FilterExpr {
            field: "userId".to_owned(),
            op: ShippedFilterOp::Eq,
            value: ValueExpr::AuthUserId,
        }],
        ..base_plan()
    };
    let established = serving
        .subscribe_live(
            "listMine",
            LiveSubscribeInput {
                connection_id: "stage-b-dk3".to_owned(),
                input: handler_input(json!({}), Some("u1")),
                authorization_namespace: None,
                supersedes: None,
                resume_from_token: None,
            },
        )
        .expect("establish DK-3 serving fixture");
    let dk3_subscription_id = established.subscription_id.clone();
    assert!(
        established
            .snapshot
            .expect("initial snapshot")
            .rows
            .is_empty()
    );
    let before_dependencies = serving
        .live_subscription_dependencies_for_test(&dk3_subscription_id)
        .expect("observe DK-3 predecessor captures");
    let before_query = before_dependencies
        .iter()
        .find(|dependency| {
            dependency.table.as_deref() == Some("todos") && dependency.result_count.is_some()
        })
        .expect("DK-3 predecessor query capture");
    assert!(before_query.rows.is_empty());
    assert_eq!(before_query.result_count, Some(0));
    let before_query_version = before_query.version.expect("predecessor query version");
    let narrow_established = serving
        .subscribe_live(
            "listMineNarrow",
            LiveSubscribeInput {
                connection_id: "stage-b-dk3-narrow".to_owned(),
                input: handler_input(json!({}), Some("u1")),
                authorization_namespace: None,
                supersedes: None,
                resume_from_token: None,
            },
        )
        .expect("establish narrowed DK-3 serving fixture");
    assert!(
        narrow_established
            .snapshot
            .expect("initial narrowed snapshot")
            .rows
            .is_empty()
    );
    let created = serving
        .invoke_mutation(
            "createTodo",
            handler_input(json!({"title":"before","userId":"u1"}), Some("u1")),
        )
        .expect("create DK-3 row");
    let id = created.result.as_str().expect("created id").to_owned();
    let frames = drain_json(&mut serving, "stage-b-dk3");
    assert_eq!(frames.len(), 1);
    assert_eq!(frames[0]["kind"], "live_delta");
    assert_eq!(frames[0]["ops"][0]["op"], "add");
    let after_add_dependencies = serving
        .live_subscription_dependencies_for_test(&dk3_subscription_id)
        .expect("observe DK-3 maintained captures");
    let after_add_query = after_add_dependencies
        .iter()
        .find(|dependency| {
            dependency.table.as_deref() == Some("todos") && dependency.result_count.is_some()
        })
        .expect("DK-3 maintained query capture");
    assert_eq!(after_add_query.rows, vec![id.clone()]);
    assert_eq!(after_add_query.result_count, Some(0));
    let after_add_query_version = after_add_query.version.expect("add query version");
    assert!(
        after_add_query_version > before_query_version,
        "DK-3 add advances the retained query version"
    );
    let after_add_row_version = after_add_dependencies
        .iter()
        .find(|dependency| {
            dependency.table.as_deref() == Some("todos")
                && dependency.id.as_deref() == Some(id.as_str())
        })
        .and_then(|dependency| dependency.version)
        .expect("add retained row version");
    let reference_add = reference_admit_batch(
        &serving_plan,
        &handler_input(json!({}), Some("u1")),
        BTreeMap::new(),
        &[changed(
            "todos",
            &id,
            ShippedChangeOp::Insert,
            frames[0]["ops"][0]["row"]
                .as_object()
                .map(|_| frames[0]["ops"][0]["row"].clone()),
            &[],
        )],
        AdmissionGrain::CompleteScope,
        Vec::new(),
    );
    let FormVerdict::Maintain {
        delta_out: reference_add_delta,
        next_state: reference_add_state,
    } = reference_add
    else {
        panic!("reference E0 add must maintain");
    };
    assert_eq!(reference_add_delta.entries.len(), 1);
    assert_eq!(reference_add_delta.entries[0].admit, Admission::Enter);
    assert_eq!(reference_add_state.retained.len(), 1);
    assert_eq!(
        after_add_query.rows.len(),
        reference_add_state.retained.len()
    );
    let narrow_frames = drain_json(&mut serving, "stage-b-dk3-narrow");
    assert_eq!(narrow_frames.len(), 1);
    assert_eq!(narrow_frames[0]["kind"], "live_replace");
    divergences.push(Divergence::conservative(
        "outer eligibility / result validation",
        "dk3-narrowed-result-contract",
        "whole-result Replace",
        "E0 maintains the raw storage-row membership transition",
        "raw DK-3 row ops are admitted only for the complete schema-derived Documents contract; narrowed Records/Documents contracts cross validation on replacement",
    ));
    serving
        .invoke_mutation(
            "patchTodo",
            handler_input(json!({"id":id,"title":"after"}), Some("u1")),
        )
        .expect("update DK-3 row");
    let frames = drain_json(&mut serving, "stage-b-dk3");
    assert_eq!(frames.len(), 1);
    assert_eq!(frames[0]["kind"], "live_delta");
    assert_eq!(frames[0]["ops"][0]["op"], "update");
    let after_update_dependencies = serving
        .live_subscription_dependencies_for_test(&dk3_subscription_id)
        .expect("observe DK-3 update captures");
    let after_update_query_version = after_update_dependencies
        .iter()
        .find(|dependency| {
            dependency.table.as_deref() == Some("todos") && dependency.result_count.is_some()
        })
        .and_then(|dependency| dependency.version)
        .expect("update query version");
    assert!(
        after_update_query_version > after_add_query_version,
        "DK-3 update advances the retained query version"
    );
    let after_update_row_version = after_update_dependencies
        .iter()
        .find(|dependency| {
            dependency.table.as_deref() == Some("todos")
                && dependency.id.as_deref() == Some(id.as_str())
        })
        .and_then(|dependency| dependency.version)
        .expect("update retained row version");
    assert!(
        after_update_row_version > after_add_row_version,
        "DK-3 update advances the retained row version"
    );
    let update_change = [changed(
        "todos",
        &id,
        ShippedChangeOp::Update,
        Some(frames[0]["ops"][0]["row"].clone()),
        &["title"],
    )];
    let FormVerdict::Maintain {
        delta_out: reference_update_delta,
        next_state: reference_update_state,
    } = reference_admit_batch(
        &serving_plan,
        &handler_input(json!({}), Some("u1")),
        reference_add_state.retained,
        &update_change,
        AdmissionGrain::CompleteScope,
        Vec::new(),
    )
    else {
        panic!("reference E0 update must maintain");
    };
    assert_eq!(reference_update_delta.entries.len(), 1);
    assert_eq!(reference_update_delta.entries[0].admit, Admission::StayIn);
    assert_eq!(reference_update_state.retained.len(), 1);
    serving
        .invoke_mutation("deleteTodo", handler_input(json!({"id":id}), Some("u1")))
        .expect("remove DK-3 row");
    let frames = drain_json(&mut serving, "stage-b-dk3");
    assert_eq!(frames.len(), 1);
    assert_eq!(frames[0]["kind"], "live_delta");
    assert_eq!(frames[0]["ops"][0]["op"], "remove");
    let after_delete_dependencies = serving
        .live_subscription_dependencies_for_test(&dk3_subscription_id)
        .expect("observe DK-3 delete captures");
    let after_delete_query_version = after_delete_dependencies
        .iter()
        .find(|dependency| {
            dependency.table.as_deref() == Some("todos") && dependency.result_count.is_some()
        })
        .and_then(|dependency| dependency.version)
        .expect("delete query version");
    assert!(
        after_delete_query_version > after_update_query_version,
        "DK-3 delete advances the retained query version"
    );
    assert!(after_delete_dependencies.iter().all(|dependency| {
        dependency.table.as_deref() != Some("todos")
            || dependency.id.as_deref() != Some(id.as_str())
    }));
    let delete_change = [changed("todos", &id, ShippedChangeOp::Delete, None, &[])];
    let FormVerdict::Maintain {
        delta_out: reference_delete_delta,
        next_state: reference_delete_state,
    } = reference_admit_batch(
        &serving_plan,
        &handler_input(json!({}), Some("u1")),
        reference_update_state.retained,
        &delete_change,
        AdmissionGrain::CompleteScope,
        Vec::new(),
    )
    else {
        panic!("reference E0 delete must maintain");
    };
    assert_eq!(reference_delete_delta.entries.len(), 1);
    assert_eq!(reference_delete_delta.entries[0].admit, Admission::Leave);
    assert!(reference_delete_state.retained.is_empty());

    // Re-execute every frozen graph disposition through the real graph
    // subscription/commit lane, then build its reference side from that
    // replay's normalized plan, retained capture/result state, and actual
    // storage pre/post image. A missing adapter is a named harness gap.
    eprintln!("stage-b-audit: graph-corpus");
    let graph: Value = serde_json::from_str(
        &std::fs::read_to_string(repository_path(GRAPH_DISPOSITIONS))
            .expect("read frozen graph delta dispositions"),
    )
    .expect("parse frozen graph delta dispositions");
    assert_eq!(graph["format"], "snapback.graph-delta-dispositions.v1");
    let dispositions = graph["dispositions"]
        .as_array()
        .expect("graph dispositions array");
    assert_eq!(dispositions.len(), 17, "closed frozen graph case inventory");
    let frozen_by_id = dispositions
        .iter()
        .map(|row| (row["id"].as_str().unwrap(), row))
        .collect::<BTreeMap<_, _>>();
    let corpus = graph_stage_b::graph_corpus();
    let replays = graph_stage_b::execute_graph_cases(&corpus);
    eprintln!("stage-b-audit: graph-reference");
    assert_eq!(replays.len(), dispositions.len());
    let mut graph_harness_gaps = Vec::new();
    let mut state_comparison_gaps = BTreeSet::new();
    let mut independent_e3_admissions = BTreeMap::new();
    for replay in &replays {
        let id = replay.case["id"].as_str().expect("executed graph case id");
        let frozen = frozen_by_id
            .get(id)
            .unwrap_or_else(|| panic!("{id}: executed case absent from frozen register"));
        assert_eq!(
            replay.disposition["lane"], frozen["lane"],
            "{id}: re-executed shipped disposition drifted from the frozen row",
        );
        if replay.change.is_none() {
            assert_eq!(id, "issue-summary-take-window-change");
            assert_eq!(replay.disposition["lane"], "replace");
            assert_eq!(
                replay.disposition["dispositionBasis"],
                "subscription supersession creates a new graph instance",
            );
            continue;
        }
        let shipped_lane = replay.disposition["lane"].as_str().unwrap();
        let reference = execute_graph_reference(replay);
        match reference {
            GraphReferenceMirror::Maintain {
                form,
                projected_fields,
                patches,
                next_state,
            } => {
                assert_graph_reference_state_matches_shipped(
                    replay,
                    &next_state,
                    &mut state_comparison_gaps,
                    &mut independent_e3_admissions,
                );
                if shipped_lane == "replace" {
                    assert_eq!(replay.frame["kind"], "live_replace");
                    assert!(
                        replay.disposition["deltaOps"].is_null(),
                        "{id}: replacement emits no graph delta operations",
                    );
                    divergences.push(Divergence::conservative(
                        "graph eligibility/fallback",
                        id,
                        "whole-graph Replace",
                        format!("executed {form} Maintain with case-shaped next state"),
                        if id == "issue-list-membership-add" {
                            "executed membership/window change remains the expected rung-1 conservative replacement"
                        } else {
                            "executed rung-1 lane admits fewer whole-graph shapes than the case-shaped reference form"
                        },
                    ));
                } else {
                    assert_eq!(shipped_lane, "delta", "{id}: known shipped lane");
                    assert_eq!(replay.disposition["convergenceChecked"], true);
                    assert_eq!(replay.disposition["convergenceMatched"], true);
                    let actual_ops = replay.frame["graph"]["ops"]
                        .as_array()
                        .expect("executed graph delta ops");
                    assert_eq!(
                        actual_ops.len(),
                        patches.len(),
                        "{id}: projection-scoped reference op count versus shipped ops",
                    );
                    for patch in &patches {
                        let actual = actual_ops
                            .iter()
                            .find(|operation| {
                                operation["nodeId"] == patch.node_id
                                    && operation["rootKey"]["id"] == patch.root_key
                                    && operation["key"]["id"] == patch.key
                            })
                            .unwrap_or_else(|| {
                                panic!(
                                    "{id}: shipped ops lack reference address {} / {}",
                                    patch.node_id, patch.key
                                )
                            });
                        let actual_row =
                            actual["row"].as_object().expect("executed graph patch row");
                        for (field, value) in &patch.row {
                            assert_eq!(
                                actual_row.get(field),
                                Some(value),
                                "{id}: projection-scoped reference value for {field}",
                            );
                        }
                    }
                    let actual_fields = actual_ops
                        .iter()
                        .flat_map(|operation| {
                            operation["row"]
                                .as_object()
                                .expect("executed graph patch row")
                                .keys()
                                .cloned()
                        })
                        .collect::<BTreeSet<_>>();
                    assert_eq!(
                        actual_fields, projected_fields,
                        "{id}: shipped graph patch fields must equal the closed projection",
                    );
                }
            }
            GraphReferenceMirror::Fallback { form, reason } => {
                assert_eq!(
                    shipped_lane, "replace",
                    "{id}: shipped delta disagrees with executed {form} fallback {reason:?}",
                );
                assert_eq!(replay.frame["kind"], "live_replace");
                assert!(replay.disposition["deltaOps"].is_null());
            }
            GraphReferenceMirror::Gap(reason) => {
                graph_harness_gaps.push(format!("{id}: {reason}"));
            }
        }
    }
    assert_eq!(
        replays
            .iter()
            .map(|replay| replay.case["id"].as_str().unwrap())
            .collect::<BTreeSet<_>>(),
        frozen_by_id.keys().copied().collect::<BTreeSet<_>>(),
    );
    assert_eq!(
        independent_e3_admissions,
        BTreeMap::from([
            ("issue-detail-root-update".to_owned(), Admission::StayIn),
            ("issue-list-in-window-reorder".to_owned(), Admission::StayIn),
            ("issue-list-membership-add".to_owned(), Admission::StayIn),
            ("issue-summary-order-key-move".to_owned(), Admission::StayIn),
            (
                "issue-summary-root-scalar-update".to_owned(),
                Admission::StayIn
            ),
            (
                "issue-summary-two-field-coalesced-patch".to_owned(),
                Admission::StayIn,
            ),
        ]),
        "every executed E3 row asserts its independently derived E0 admission tag",
    );

    // The eligible root-scalar replay reaches the complete outer graph lane.
    // Existing observations expose every asserted axis below without reading
    // source text.
    let outer = replays
        .iter()
        .find(|replay| replay.case["id"] == "issue-summary-root-scalar-update")
        .expect("executed eligible graph outer replay");
    assert_eq!(outer.delivery_before, (true, false));
    assert_eq!(outer.delivery_after, (true, true));
    assert_eq!(
        outer.before["capturedDependencies"], outer.after["capturedDependencies"],
        "graph predecessor captures copy forward verbatim",
    );
    assert_ne!(
        graph_stage_b::root_window_ledger(&outer.before),
        graph_stage_b::root_window_ledger(&outer.after),
        "the graph delta advances its cumulative window ledger",
    );
    assert_eq!(
        outer.frame["graph"]["proofTuple"]["authorizationVersion"],
        outer.after["authorizationVersion"],
    );
    assert_eq!(
        outer.frame["graph"]["proofTuple"]["evaluationCut"],
        outer.after["evaluationCut"],
    );
    assert_eq!(outer.after["deltaDelivery"]["lane"], "delta");
    assert_eq!(
        outer.after["deltaDelivery"]["matchedNodeIds"],
        outer.disposition["matchedNodeIds"],
    );
    assert_eq!(outer.after["deltaDelivery"]["convergenceMatched"], true);
    divergences.push(Divergence::conservative(
        "outer retained state",
        "graph-predecessor-captures-and-next-delta-latch",
        "retained evaluator/window/cost state advances, predecessor captures are copied verbatim, and delta_requires_replace latches true",
        "E3/E4 next state is sufficient for another maintain step",
        "the capture vocabulary cannot yet re-attest graph dependencies after an incremental step, so the next affected commit must replace",
    ));

    // Execute the named asymmetry itself: raise EXEC_DISABLED only after the
    // subscription is established, then deliver an otherwise eligible commit.
    // The incremental candidacy gate must honor the same execution kill switch
    // as fresh graph evaluation.
    let exec_disabled = graph_stage_b::execute_exec_disabled_probe(&corpus);
    assert!(
        exec_disabled
            .frame_kinds
            .iter()
            .all(|kind| kind != "live_delta"),
        "execution-disabled established subscription emitted a delta: {:?}",
        exec_disabled.frame_kinds,
    );
    assert_eq!(
        exec_disabled.delta_deliveries_after,
        exec_disabled.delta_deliveries_before,
    );
    assert_eq!(
        exec_disabled.delta_evaluation_cost_after,
        exec_disabled.delta_evaluation_cost_before,
    );
    assert!(
        exec_disabled
            .diagnostic_codes
            .iter()
            .any(|code| code == "SNAPBACK_GRAPH_EXEC_DISABLED"),
    );

    divergences.push(Divergence::conservative(
        "retained state",
        "dk3-stale-result-count",
        "rows/version advance; result_count remains at predecessor value",
        "E0 next state advances admitted membership and its count",
        "executed add advanced Query.rows from 0 to 1 while the observed result_count stayed 0",
    ));
    graph_harness_gaps.push(
        "publication-guard internals have no observation hook; successful enqueue proves publication occurred but not the guard's internal ordering".to_owned(),
    );
    graph_harness_gaps.push(
        "authorized DK-3 add/update versus remove delivery was not established in this fixture; no class-(c) row is claimed for that axis".to_owned(),
    );
    graph_harness_gaps.push(
        "incomplete-window E3 continuation comparison is implemented but no adapted E3 replay reaches an incomplete successor window".to_owned(),
    );
    graph_harness_gaps.extend(state_comparison_gaps);
    for case in [
        "issue-detail-root-update:",
        "issue-list-in-window-reorder:",
        "issue-list-membership-add:",
        "issue-summary-root-scalar-update:",
        "issue-summary-two-field-coalesced-patch:",
        "issue-summary-order-key-move:",
    ] {
        assert!(
            graph_harness_gaps.iter().any(|gap| {
                gap.starts_with(case) && gap.contains("E3 continuation is not a comparable axis")
            }),
            "complete-window E3 continuation gap {case} must stay explicit",
        );
    }
    assert_eq!(
        graph_harness_gaps
            .iter()
            .filter(|gap| gap.contains("E3 continuation is not a comparable axis"))
            .count(),
        6,
        "closed complete-window E3 continuation-gap register",
    );
    assert_eq!(
        graph_harness_gaps.len(),
        12,
        "closed Stage B harness-gap register"
    );
    for case in [
        "issue-list-to-many-update:",
        "issue-detail-to-many-update:",
        "list-by-id-to-many-update:",
    ] {
        assert!(
            graph_harness_gaps.iter().any(|gap| gap.starts_with(case)),
            "unadapted E5 row {case} must remain an explicit harness gap",
        );
    }

    assert!(
        divergences
            .iter()
            .all(|row| row.class != DivergenceClass::Unclassified),
        "Stage C is blocked by an unclassified divergence: {divergences:#?}",
    );
    assert_eq!(divergences.len(), 15, "closed Stage B divergence register");
    assert_eq!(
        divergences
            .iter()
            .filter(|row| row.class == DivergenceClass::ShippedDefect)
            .count(),
        0,
        "the two fixed class-(b) probes must remain in agreement",
    );
    assert_eq!(
        divergences
            .iter()
            .filter(|row| row.class == DivergenceClass::ConservativeApproximation)
            .count(),
        15,
        "every class-(c) row must stay in the closed report register",
    );
    assert_eq!(
        divergences
            .iter()
            .filter(|row| row.class == DivergenceClass::ReferenceError)
            .count(),
        0,
        "a class-(a) finding requires a reference/corpus repair in this lane",
    );
    assert!(
        divergences
            .iter()
            .any(|row| row.case == "issue-list-membership-add"),
        "the expected rung-1 membership-change class-(c) entry is mandatory"
    );
    assert!(
        divergences.iter().all(|row| {
            !row.axis.is_empty()
                && !row.case.is_empty()
                && !row.shipped.is_empty()
                && !row.reference.is_empty()
                && !row.evidence.is_empty()
        }),
        "every divergence row carries all report axes"
    );

    // Keep all four enum outcomes compile-visible: Stage B now has no open
    // class (a) or class (b), and an unclassified outcome remains a failure.
    assert_ne!(
        DivergenceClass::ReferenceError,
        DivergenceClass::Unclassified
    );
    assert_ne!(
        DivergenceClass::ShippedDefect,
        DivergenceClass::Unclassified
    );
    assert_eq!(AUDITED_COMMIT.len(), 40);
}
