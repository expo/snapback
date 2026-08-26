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
    HandlerInput, HandlerPlan, MutationPlan, MutationStep, OrderDirection, OrderExpr, QueryPlan,
    ResultObjectFieldContract, ResultValueContract, ReturnValue, SchemaManifest, TableManifest,
    TableVisibilityArmV1, TableVisibilityV1, ValueExpr,
};
use snapback_delta_semantics::{
    Admission, AdmissionGrain, AdmitConfig, AdmitInput, AdmitState, AppBatch, AppChange,
    ChangeOp as ReferenceChangeOp, CompletenessLabel, DeltaZBatch, DeltaZEntry, Direction,
    Filter as ReferenceFilter, FilterOp as ReferenceFilterOp, FormVerdict, Interval, LookupConfig,
    LookupDelta, LookupInput, LookupScopeState, LookupState, OrderField, Presence, RankKey,
    RankedRow, ReadTranscript, Visibility, WindowConfig, WindowState, evaluate_admit,
    evaluate_lookup, evaluate_window,
};
use snapback_kernel::storage::{ChangeOp as ShippedChangeOp, ChangedRow};

const AUDITED_COMMIT: &str = "70c81c755da3e87f24fbce31157c948a7881c6cd";
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

    fn shipped_defect(
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
            class: DivergenceClass::ShippedDefect,
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

fn reference_root_patch() -> FormVerdict<snapback_delta_semantics::DeltaSeq, WindowState> {
    let prior = row(json!({
        "_id":"r1", "rank":1, "title":"before", "secret":"held"
    }));
    let post = row(json!({
        "_id":"r1", "rank":1, "title":"after", "secret":"changed"
    }));
    evaluate_window(
        &WindowConfig {
            window_id: "root".to_owned(),
            order: vec![OrderField {
                field: "rank".to_owned(),
                direction: Direction::Asc,
            }],
            interval: Interval::default(),
            take: 10,
            projection_fields: BTreeSet::from(["title".to_owned()]),
        },
        WindowState {
            rows: vec![RankedRow {
                row_key: "r1".to_owned(),
                rank_keys: RankKey {
                    values: vec![json!(1)],
                    row_key: "r1".to_owned(),
                },
                row: prior.clone(),
            }],
            boundary: Some(RankKey {
                values: vec![json!(1)],
                row_key: "r1".to_owned(),
            }),
            result_count: 1,
            complete: true,
            label: CompletenessLabel::Complete,
            continuation: None,
        },
        DeltaZBatch {
            entries: vec![DeltaZEntry {
                row_key: "r1".to_owned(),
                op: ReferenceChangeOp::Update,
                post_image: Some(post),
                pre_image: Some(prior),
                admit: Admission::StayIn,
                rank_keys: vec![json!(1)],
            }],
        },
        &ReadTranscript::default(),
    )
}

fn reference_lookup_patch() -> FormVerdict<LookupDelta, LookupState> {
    let prior = row(json!({
        "_id":"c1", "_version":1, "parentID":"r1", "name":"before", "secret":"held"
    }));
    let post = row(json!({
        "_id":"c1", "_version":2, "parentID":"r1", "name":"after", "secret":"changed"
    }));
    evaluate_lookup(
        &LookupConfig {
            index: "by_parent".to_owned(),
            parent_join_fields: vec!["_id".to_owned()],
            child_join_fields: vec!["parentID".to_owned()],
            presence: Presence::Optional,
            projection_fields: BTreeSet::from(["name".to_owned()]),
        },
        LookupState {
            scopes: BTreeMap::from([(
                "r1".to_owned(),
                LookupScopeState {
                    lookup_key: Some(vec![json!("r1")]),
                    child_key: Some("c1".to_owned()),
                    found: true,
                    row_version: Some(1),
                },
            )]),
            children: BTreeMap::from([("c1".to_owned(), prior.clone())]),
        },
        LookupInput {
            parent: DeltaZBatch::default(),
            child: DeltaZBatch {
                entries: vec![DeltaZEntry {
                    row_key: "c1".to_owned(),
                    op: ReferenceChangeOp::Update,
                    post_image: Some(post),
                    pre_image: Some(prior),
                    admit: Admission::StayIn,
                    rank_keys: Vec::new(),
                }],
            },
        },
        &ReadTranscript::default(),
    )
}

fn source_segment<'a>(source: &'a str, start: &str, end: &str) -> &'a str {
    let start = source
        .find(start)
        .unwrap_or_else(|| panic!("missing {start}"));
    let tail = &source[start..];
    let end = tail.find(end).unwrap_or_else(|| panic!("missing {end}"));
    &tail[..end]
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
    assert_eq!(
        reference_dk3(&ordered, &empty, &BTreeSet::new(), &ordered_change).unwrap()["verdict"],
        "Delta"
    );
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
    assert_eq!(
        shipped_dk3(&membership, &empty, &BTreeSet::new(), &ordered_change)["verdict"],
        "Replace"
    );
    let membership_only_change = [changed(
        "todo_members",
        "membership-1",
        ShippedChangeOp::Delete,
        None,
        &[],
    )];
    assert_eq!(
        shipped_dk3(
            &membership,
            &empty,
            &BTreeSet::from(["held".to_owned()]),
            &membership_only_change,
        )["verdict"],
        "Replace",
    );
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
    assert_eq!(
        shipped_dk3(
            &visibility_membership,
            &empty,
            &BTreeSet::from(["held".to_owned()]),
            &membership_only_change,
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
    let mut serving = serving_fixture();
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
    assert!(
        established
            .snapshot
            .expect("initial snapshot")
            .rows
            .is_empty()
    );
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
    assert_eq!(frames[0]["ops"][0]["op"], "update");
    serving
        .invoke_mutation("deleteTodo", handler_input(json!({"id":id}), Some("u1")))
        .expect("remove DK-3 row");
    let frames = drain_json(&mut serving, "stage-b-dk3");
    assert_eq!(frames[0]["ops"][0]["op"], "remove");

    // Graph rung-1: the frozen artifact is produced by graph_corpus_v1's
    // execute_graph_delta_case machinery. Recheck its closed case inventory
    // and compare every row with typed reference E3/E4 mirror verdicts.
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
    assert!(matches!(
        reference_root_patch(),
        FormVerdict::Maintain { .. }
    ));
    assert!(matches!(
        reference_lookup_patch(),
        FormVerdict::Maintain { .. }
    ));
    for case in dispositions {
        let id = case["id"].as_str().expect("graph case id");
        let lane = case["lane"].as_str().expect("graph lane");
        assert_eq!(case["oracleChecked"], true, "{id}: shipped oracle ran");
        assert_eq!(case["oracleMatched"], true, "{id}: shipped oracle matched");
        if case["eligibility"] == "eligible" {
            assert_eq!(lane, "delta", "{id}: eligible rung-1 case maintains");
            assert_eq!(case["convergenceChecked"], true);
            assert_eq!(case["convergenceMatched"], true);
            let operations = case["deltaOps"].as_array().expect("eligible delta ops");
            assert!(!operations.is_empty(), "{id}: eligible case emits ops");
            assert!(
                operations
                    .iter()
                    .all(|operation| operation["op"] == "update")
            );
            let expected_fields = match id {
                "issue-summary-root-scalar-update" => BTreeSet::from(["title"]),
                "issue-summary-assignee-user-rename" => BTreeSet::from(["login"]),
                "issue-summary-two-field-coalesced-patch" => BTreeSet::from(["open", "title"]),
                _ => panic!("{id}: unregistered eligible graph corpus case"),
            };
            for operation in operations {
                let actual_fields = operation["row"]
                    .as_object()
                    .expect("eligible graph update row")
                    .keys()
                    .map(String::as_str)
                    .collect::<BTreeSet<_>>();
                assert_eq!(actual_fields, expected_fields, "{id}: projection-scoped op");
            }
            continue;
        }
        assert_eq!(lane, "replace", "{id}: ineligible graph case replaces");
        let reference_maintains = matches!(
            id,
            "issue-list-child-update"
                | "issue-detail-root-update"
                | "list-by-id-child-update"
                | "issue-detail-sibling-array-corruption"
                | "issue-list-in-window-reorder"
                | "issue-list-membership-add"
                | "issue-detail-creator-user-change"
                | "list-by-id-two-field-coalesced-patch"
                | "issue-summary-order-key-move"
                | "issue-summary-assignee-repoint"
                | "issue-summary-take-window-change"
        );
        if reference_maintains {
            divergences.push(Divergence::conservative(
                "graph eligibility/fallback",
                id,
                "whole-graph Replace",
                "the relevant E3/E4 inner form can Maintain with complete state/read evidence",
                if id == "issue-list-membership-add" {
                    "expected rung-1 membership-change conservative replacement"
                } else {
                    "rung-1 admits only position-stable scalar root/to-one updates and one ineligible node pins the graph"
                },
            ));
        }
    }

    // Outer-state and named-probe audit. The absent direct graph evaluator and
    // ordinary capture-inspection hooks are reportable harness gaps; source
    // assertions keep the audited code facts from drifting silently.
    let engine_source = include_str!("../../snapback-engine/src/local/engine.rs");
    let evaluator_source = include_str!("../../snapback-engine/src/graph_evaluator.rs");
    let graph_lane = source_segment(
        engine_source,
        "fn try_graph_delta_fanout(",
        "fn try_live_delta_fanout(",
    );
    assert!(graph_lane.contains("graph.delivery.delta_requires_replace = true"));
    assert!(graph_lane.contains("graph.evaluation.structural_work ="));
    assert!(graph_lane.contains("graph.evaluation.window_ledgers ="));
    assert!(graph_lane.contains("graph_delta_evaluation_cost"));
    assert!(!graph_lane.contains("stored.read_dependencies"));
    assert!(!graph_lane.contains("SNAPBACK_GRAPH_EXEC_DISABLED"));
    assert!(engine_source.contains("SNAPBACK_GRAPH_EXEC_DISABLED"));
    divergences.push(Divergence::conservative(
        "outer retained state",
        "graph-predecessor-captures-and-next-delta-latch",
        "retained evaluator/window/cost state advances, predecessor captures are copied verbatim, and delta_requires_replace latches true",
        "E3/E4 next state is sufficient for another maintain step",
        "the capture vocabulary cannot yet re-attest graph dependencies after an incremental step, so the next affected commit must replace",
    ));
    divergences.push(Divergence::shipped_defect(
        "outer eligibility",
        "graph-exec-disabled-established-subscription",
        "established eligible graph subscription can enter incremental evaluation after the switch is raised",
        "the execution kill switch refuses all graph evaluation, including incremental evaluation",
        "fresh execute_query_invocation checks SNAPBACK_GRAPH_EXEC_DISABLED; try_graph_delta_fanout does not",
    ));

    let live_lane = source_segment(
        engine_source,
        "fn try_live_delta_fanout(",
        "fn debug_assert_delta_membership_converges(",
    );
    assert!(live_lane.contains("dependency.rows.retain"));
    assert!(live_lane.contains("dependency.version = Some(frame_version)"));
    assert!(!live_lane.contains("dependency.result_count ="));
    assert!(live_lane.contains("operation.kind == LiveDeltaKind::Remove"));
    divergences.push(Divergence::conservative(
        "retained state",
        "dk3-stale-result-count",
        "rows/version advance; result_count remains at predecessor value",
        "E0 next state advances admitted membership and its count",
        "post-delta DK-3 classification reads Query.rows/prior_ids; unordered matching does not consult result_count",
    ));
    divergences.push(Divergence::conservative(
        "outer delivery",
        "dk3-authorized-scope-split",
        "authorized add/update may remain best-effort delta; any remove returns to replace/obligation lane",
        "operator forms classify add/update/remove without delivery durability policy",
        "LLP 0053: negative deltas are obligations; positive deltas are best-effort",
    ));

    let patch_source = source_segment(
        evaluator_source,
        "fn retained_row_patch(",
        "fn apply_projected_node_patch(",
    );
    assert!(patch_source.contains("let fields = previous"));
    assert!(patch_source.contains(".chain(current.keys())"));
    assert!(evaluator_source.contains("row = retained_row_patch(&old.row, &new.row)"));
    assert!(graph_lane.contains("ops: delta.ops.clone()"));
    divergences.push(Divergence::shipped_defect(
        "emitted ops / projection custody",
        "graph-unfiltered-retained-row-patch",
        "all changed retained-row fields, including unprojected/system fields, enter graph wire ops",
        "E3/E4 patches contain projection_fields only",
        "retained_row_patch unions full row keys; try_graph_delta_fanout serializes delta.ops unchanged",
    ));

    assert!(
        divergences
            .iter()
            .all(|row| row.class != DivergenceClass::Unclassified),
        "Stage C is blocked by an unclassified divergence: {divergences:#?}",
    );
    assert_eq!(divergences.len(), 20, "closed Stage B divergence register");
    assert_eq!(
        divergences
            .iter()
            .filter(|row| row.class == DivergenceClass::ShippedDefect)
            .count(),
        2,
        "the two verified class-(b) probes must remain visible",
    );
    assert_eq!(
        divergences
            .iter()
            .filter(|row| row.class == DivergenceClass::ConservativeApproximation)
            .count(),
        18,
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

    // Keep all four enum outcomes compile-visible: Stage B found no class (a),
    // and an unclassified outcome is the only semantic test failure.
    assert_ne!(
        DivergenceClass::ReferenceError,
        DivergenceClass::Unclassified
    );
    assert_eq!(AUDITED_COMMIT.len(), 40);
}
