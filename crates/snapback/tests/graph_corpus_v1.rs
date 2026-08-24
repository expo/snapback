//! G0/G2-A graph conformance seam.
//!
//! B1 freezes identity/capture/no-runtime-consumer behavior. B3 adds the
//! corpus-owned Zerobugs declarations, opaque-handler oracle records, closed
//! completeness proofs, fixture-derived logical bounds, analytical physical
//! declarations, the seven-kind schema, executable G0
//! oracle/paired/allow-deny/refusal evidence, and honest gaps for the LLP 0268
//! inputs. G2-A additionally executes every admitted corpus carrier through
//! the snapshot-pinned engine evaluator while keeping matcher and serving
//! integration absent.

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;
use std::sync::OnceLock;

use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use snapback::live_matcher::{
    GraphNodeMatchDispositionV1, LiveMatchOutcome, live_subscription_match_decision,
    live_subscription_match_outcome,
};
use snapback::local::LocalSnapback;
use snapback::manifest::*;
use snapback_engine::graph_evaluator::{
    GraphEvaluationAuthorityV1, GraphEvaluationRequestV1, GraphPermissionValuesV1,
    GraphWindowLedgerV1,
};
use snapback_kernel::storage::{ChangeOp, ChangedRow};
use snapback_sync::graph_captured_read::{
    graph_capture_carrier_is_well_formed, register_graph_subscription_dependencies,
};
use snapback_types::diagnostic::DiagnosticSeverity;
use snapback_types::storage::{CapturedReadDependency, CapturedReadKind};

const CORPUS_FILE: &str = "tests/conformance/graph/corpus.v1.json";
const BOUNDS_FILE: &str = "tests/conformance/graph/bound-derivation.v1.json";
const PENDING_CASES_FILE: &str = "tests/conformance/graph/broadcast-cases.g2-pending.v1.json";
const PROVER_DISPOSITIONS_FILE: &str =
    "tests/conformance/graph/broadcast-prover-dispositions.v1.json";
const PAIRED_FIXTURES_FILE: &str = "tests/conformance/graph/paired-world-fixtures.v1.json";
const RUNTIME_CAPTURES_FILE: &str = "tests/conformance/graph/runtime-captures.g2-b.v1.json";
const MATCH_DISPOSITIONS_FILE: &str = "tests/conformance/graph/match-dispositions.v1.json";
const OWNER_SCOPE_DOMAIN: &str = "snapback:g0-corpus-authority-scope:v1:";

fn repository_path(relative: &str) -> PathBuf {
    PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../..")).join(relative)
}

fn load_json(relative: &str) -> Value {
    serde_json::from_str(
        &std::fs::read_to_string(repository_path(relative))
            .unwrap_or_else(|error| panic!("read {relative}: {error}")),
    )
    .unwrap_or_else(|error| panic!("parse {relative}: {error}"))
}

fn graph_corpus() -> Value {
    load_json(CORPUS_FILE)
}

fn graph_bounds() -> Value {
    load_json(BOUNDS_FILE)
}

fn pending_broadcast_cases() -> Value {
    load_json(PENDING_CASES_FILE)
}

fn broadcast_prover_dispositions() -> Value {
    load_json(PROVER_DISPOSITIONS_FILE)
}

fn paired_world_fixtures() -> Value {
    load_json(PAIRED_FIXTURES_FILE)
}

fn corpus_seed_tables(corpus: &Value) -> BTreeMap<String, Vec<Map<String, Value>>> {
    let fixture = load_json(&format!(
        "{}/fixture.json",
        corpus["fixtures"]["normal"].as_str().unwrap()
    ));
    let base = corpus["fixtures"]["normal"].as_str().unwrap();
    let mut tables = fixture["tableFiles"]
        .as_object()
        .unwrap()
        .iter()
        .map(|(table, file)| {
            let rows = load_json(&format!("{base}/{}", file.as_str().unwrap()))
                .as_array()
                .unwrap()
                .iter()
                .map(|row| row.as_object().unwrap().clone())
                .collect::<Vec<_>>();
            (table.clone(), rows)
        })
        .collect::<BTreeMap<_, _>>();

    for table in ["rooms", "roomMembers"] {
        tables.insert(
            table.to_owned(),
            corpus["broadcastFixture"]["data"][table]
                .as_array()
                .unwrap()
                .iter()
                .map(|row| row.as_object().unwrap().clone())
                .collect(),
        );
    }

    // The paired fixture freezes the normalized read-model/policy-extension
    // worlds that the opaque oracle used. Use its present worlds as the
    // canonical executable baseline; individual paired executions replace
    // exactly their named slice below.
    let paired = paired_world_fixtures();
    for pair_id in [
        "g0-pair-point-hidden-internal-root",
        "g0-pair-detail-hidden-root-empty-child-demand",
        "g0-pair-detail-notification-principal",
        "g0-pair-point-view-state-principal",
    ] {
        let pair = paired["pairs"]
            .as_array()
            .unwrap()
            .iter()
            .find(|pair| pair["id"] == pair_id)
            .unwrap();
        let table = pair["namedSlice"]["table"].as_str().unwrap();
        tables.insert(
            table.to_owned(),
            pair["present"]["sliceTableRows"]
                .as_array()
                .unwrap()
                .iter()
                .map(|row| row.as_object().unwrap().clone())
                .collect(),
        );
    }

    // The server-owned principal binding projection is intentionally absent
    // from the authored seed. The corpus owner facts freeze its exact target.
    tables.insert(
        "identityBinding".to_owned(),
        corpus["authorityOwner"]["facts"]
            .as_array()
            .unwrap()
            .iter()
            .enumerate()
            .map(|(index, fact)| {
                Map::from_iter([
                    (
                        "_id".to_owned(),
                        json!(format!("graph_identity_binding_{index}")),
                    ),
                    ("principal".to_owned(), fact["principal"].clone()),
                    ("userID".to_owned(), fact["userID"].clone()),
                    ("sourceUserID".to_owned(), fact["sourceUserID"].clone()),
                ])
            })
            .collect(),
    );
    tables
}

fn graph_index_manifest(table: &str) -> Vec<IndexManifest> {
    let indexes: &[(&str, &[&str], bool)] = match table {
        "issue" => &[("by_source_id", &["id"], true)],
        "comment" => &[("by_issue_created", &["issueID", "created", "id"], false)],
        "issueListRead" => &[
            ("by_source_issue_id", &["sourceIssueID"], true),
            (
                "by_project_modified",
                &["projectID", "modified", "sourceIssueID"],
                false,
            ),
        ],
        "issueLabelRead" => &[("by_issue_label", &["issueID", "labelID"], true)],
        "viewState" | "issueNotifications" => &[("by_issue_user", &["issueID", "userID"], true)],
        "identityBinding" => &[("by_principal", &["principal"], true)],
        "rooms" => &[
            ("by_scope_updated", &["scopeId", "updatedAt"], false),
            ("by_category_updated", &["category", "updatedAt"], false),
        ],
        _ => &[],
    };
    indexes
        .iter()
        .map(|(name, fields, unique)| IndexManifest {
            name: (*name).to_owned(),
            fields: fields.iter().map(|field| (*field).to_owned()).collect(),
            unique: *unique,
            where_applicable: *unique && fields.iter().any(|field| *field != "_id"),
        })
        .collect()
}

fn inferred_field_type(values: impl Iterator<Item = Value>) -> FieldType {
    let values = values.filter(|value| !value.is_null()).collect::<Vec<_>>();
    if values.iter().all(Value::is_string) {
        FieldType::String
    } else if values.iter().all(Value::is_boolean) {
        FieldType::Boolean
    } else if values.iter().all(|value| value.as_i64().is_some()) {
        FieldType::Integer
    } else if values.iter().all(Value::is_number) {
        FieldType::Real
    } else {
        FieldType::Json
    }
}

fn corpus_schema(tables: &BTreeMap<String, Vec<Map<String, Value>>>) -> SchemaManifest {
    let tables = tables
        .iter()
        .map(|(name, rows)| {
            let names = rows
                .iter()
                .flat_map(|row| row.keys())
                .filter(|field| field.as_str() != "_id")
                .cloned()
                .collect::<BTreeSet<_>>();
            TableManifest {
                name: name.clone(),
                fields: names
                    .into_iter()
                    .map(|field| FieldManifest {
                        field_type: inferred_field_type(
                            rows.iter()
                                .map(|row| row.get(&field).cloned().unwrap_or(Value::Null)),
                        ),
                        name: field,
                        optional: true,
                    })
                    .collect(),
                indexes: graph_index_manifest(name),
                search_indexes: Vec::new(),
                vector_indexes: Vec::new(),
                search_live_limits: None,
                syncable: true,
                permission_backing: matches!(name.as_str(), "issue" | "issueListRead"),
                permission_fields: matches!(name.as_str(), "issue" | "issueListRead")
                    .then(|| vec!["visibility".to_owned()]),
                membership: None,
                authority_profile: None,
                asset_sharing: None,
                visibility: Some(TableVisibilityV1::PublicRead),
                history: None,
            }
        })
        .collect();
    SchemaManifest {
        app_id: "zerobugs-graph-g2-corpus".to_owned(),
        tables,
        ..SchemaManifest::default()
    }
}

fn graph_store(corpus: &Value, replacement: Option<(&str, &Value)>) -> LocalSnapback {
    let mut tables = corpus_seed_tables(corpus);
    if let Some((table, rows)) = replacement {
        tables.insert(
            table.to_owned(),
            rows.as_array()
                .unwrap()
                .iter()
                .map(|row| row.as_object().unwrap().clone())
                .collect(),
        );
    }
    let mut snapback = LocalSnapback::memory().expect("graph corpus memory store");
    let diagnostics = snapback
        .apply_schema(corpus_schema(&tables))
        .expect("apply corpus schema");
    assert!(
        diagnostics
            .iter()
            .all(|diagnostic| diagnostic.severity != DiagnosticSeverity::Error),
        "corpus schema diagnostics: {diagnostics:?}"
    );
    snapback
        .seed(SeedData { tables })
        .expect("seed graph corpus store");
    snapback
}

fn corpus_authority(corpus: &Value, principal: &str) -> GraphEvaluationAuthorityV1 {
    let fact = corpus["authorityOwner"]["facts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|fact| fact["principal"] == principal)
        .unwrap();
    let permission_values_by_table = fact["visibilityPolicyInputs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|input| {
            (
                input["declarationId"].as_str().unwrap().to_owned(),
                GraphPermissionValuesV1 {
                    field: input["permissionFields"][0].as_str().unwrap().to_owned(),
                    allowed_values: input["allowedValues"].as_array().unwrap().clone(),
                },
            )
        })
        .collect();
    GraphEvaluationAuthorityV1 {
        auth: AuthInput {
            principal: Some(principal.to_owned()),
            user_id: Some(principal.to_owned()),
            ..AuthInput::default()
        },
        permission_values_by_table,
        resolved_membership_inputs: BTreeSet::new(),
        resolved_role_inputs: BTreeSet::new(),
    }
}

fn evaluation_request(
    corpus: &Value,
    call: &Value,
    materialization: &GraphMaterializationIdentityV1,
    partition: &GraphAuthorityPartitionIdentityV1,
) -> GraphEvaluationRequestV1 {
    let authority = call["partition"]["class3"]["principalDataScope"]["userId"]
        .as_str()
        .map(|principal| corpus_authority(corpus, principal))
        .unwrap_or_default();
    GraphEvaluationRequestV1 {
        args: call["args"].clone(),
        windows: serde_json::from_value(call["windows"].clone()).unwrap(),
        advanced_node_id: call["advancedNodeId"]
            .as_str()
            .expect("corpus invocation binds one advanced graph lineage")
            .to_owned(),
        materialization_hash: materialization.materialization_hash.clone(),
        partition_hash: partition.partition_hash.clone(),
        authorization_version: serde_json::from_value(call["authorizationVersion"].clone())
            .unwrap(),
        evaluation_cut: serde_json::from_value(call["evaluationCut"].clone()).unwrap(),
        authority,
        prior_window_ledgers: Vec::new(),
    }
}

fn jcs_domain_hash(domain: &str, value: &Value) -> String {
    let canonical = snapback_types::rqs_contract::jcs(value).expect("corpus value canonicalizes");
    let mut hasher = Sha256::new();
    hasher.update(domain.as_bytes());
    hasher.update(canonical.as_bytes());
    format!("sha256:{:x}", hasher.finalize())
}

fn byte_hash(value: &str) -> String {
    format!("sha256:{:x}", Sha256::digest(value.as_bytes()))
}

fn normalized_matcher_input(
    plan: &GraphQueryPlanV1,
    request: &GraphEvaluationRequestV1,
) -> HandlerInput {
    let supplied = request.args.as_object().expect("graph args object");
    let args = plan
        .arguments
        .iter()
        .map(|argument| {
            (
                argument.argument_id.clone(),
                supplied
                    .get(&argument.name)
                    .unwrap_or_else(|| panic!("missing graph argument {}", argument.name))
                    .clone(),
            )
        })
        .collect::<Map<_, _>>();
    HandlerInput {
        args: Value::Object(args),
        auth: request.authority.auth.clone(),
        read_set: Vec::new(),
        correlation: None,
        ctx_ledger: None,
    }
}

fn normal_graph_evaluations(
    corpus: &Value,
) -> Vec<(
    String,
    GraphQueryCarrierV1,
    HandlerInput,
    Vec<CapturedReadDependency>,
)> {
    corpus["g0ExitObservationEvidence"]
        .as_array()
        .expect("G0 exit evidence")
        .iter()
        .map(|evidence| {
            let plan_hash = evidence["graphPlanHash"].as_str().unwrap();
            let query = corpus_queries(corpus)
                .find(|query| query["carrier"]["planHash"] == plan_hash)
                .unwrap_or_else(|| panic!("carrier for {plan_hash}"));
            let query_name = query["query"].as_str().unwrap().to_owned();
            let carrier: GraphQueryCarrierV1 =
                serde_json::from_value(query["carrier"].clone()).unwrap();
            let call = &evidence["invocation"];
            let (materialization, partition) =
                validate_corpus_invocation(&carrier, call, &query_name);
            let request = evaluation_request(corpus, call, &materialization, &partition);
            let output = graph_store(corpus, None)
                .evaluate_graph_query(&carrier.normalized_plan, &request)
                .unwrap_or_else(|error| panic!("evaluate {query_name}: {error:?}"));
            let registered = register_graph_subscription_dependencies(
                &carrier.normalized_plan,
                &output.captured_reads,
            )
            .unwrap_or_else(|error| panic!("register {query_name}: {error:?}"));
            let matcher_input = normalized_matcher_input(&carrier.normalized_plan, &request);
            (query_name, carrier, matcher_input, registered)
        })
        .collect()
}

fn content_digest(mut value: Value) -> Value {
    let canonical = snapback_types::rqs_contract::jcs(&value).expect("artifact canonicalizes");
    value["contentDigest"] = json!(byte_hash(&canonical));
    value
}

fn match_outcome_name(outcome: LiveMatchOutcome) -> &'static str {
    match outcome {
        LiveMatchOutcome::Skip => "skip",
        LiveMatchOutcome::Match => "match",
        LiveMatchOutcome::ConservativeFallback => "conservative-fallback",
    }
}

fn update_change(table: &str, row: Value, changed_fields: &[&str]) -> ChangedRow {
    ChangedRow {
        table: table.to_owned(),
        id: row["_id"].as_str().unwrap().to_owned(),
        op: ChangeOp::Update,
        row: Some(row),
        changed_fields: changed_fields
            .iter()
            .map(|field| (*field).to_owned())
            .collect(),
    }
}

fn insert_change(table: &str, row: Value) -> ChangedRow {
    ChangedRow {
        table: table.to_owned(),
        id: row["_id"].as_str().unwrap().to_owned(),
        op: ChangeOp::Insert,
        row: Some(row),
        changed_fields: Vec::new(),
    }
}

fn graph_match_replay_commits(corpus: &Value) -> Vec<(String, Vec<ChangedRow>)> {
    let tables = corpus_seed_tables(corpus);
    let evidence = corpus["g0ExitObservationEvidence"]
        .as_array()
        .expect("exit evidence");
    let list_call = evidence
        .iter()
        .find(|row| {
            let hash = row["graphPlanHash"].as_str().unwrap();
            corpus_queries(corpus).any(|query| {
                query["query"] == "issueListV2" && query["carrier"]["planHash"] == hash
            })
        })
        .expect("list evidence");
    let project = list_call["invocation"]["args"]["projectID"]
        .as_str()
        .unwrap();
    let mut in_project = Value::Object(
        tables["issueListRead"]
            .iter()
            .find(|row| row["projectID"] == project)
            .unwrap()
            .clone(),
    );
    in_project["open"] = json!(!in_project["open"].as_bool().unwrap_or(false));
    let out_project = json!({
        "_id":"g2b_issue_outside_project",
        "issueID":"g2b_issue_outside_project",
        "sourceIssueID":"g2b-outside-source",
        "projectID":"g2b-other-project",
        "creatorID":"g2b-user",
        "open":true,
        "visibility":"public",
        "modified":1,
        "created":1
    });

    let issue_detail_call = evidence
        .iter()
        .find(|row| {
            let hash = row["graphPlanHash"].as_str().unwrap();
            corpus_queries(corpus).any(|query| {
                query["query"] == "issueDetail" && query["carrier"]["planHash"] == hash
            })
        })
        .expect("detail evidence");
    let source_issue = issue_detail_call["invocation"]["args"]["sourceIssueID"]
        .as_str()
        .unwrap();
    let physical_issue = tables["issue"]
        .iter()
        .find(|row| row["id"] == source_issue)
        .unwrap()["_id"]
        .as_str()
        .unwrap()
        .to_owned();
    let comment = json!({
        "_id":"g2b_comment_add",
        "id":"g2b-comment-source",
        "issueID":physical_issue,
        "created":9_000_000_000_000_i64,
        "body":"G2-B matcher replay",
        "creatorID":"g2b-user"
    });

    let label_row = tables["issueLabelRead"]
        .first()
        .expect("label edge fixture")
        .clone();
    let mut label_add = Value::Object(label_row.clone());
    label_add["_id"] = json!("g2b_label_edge_add");
    let label_remove = ChangedRow {
        table: "issueLabelRead".to_owned(),
        id: label_row["_id"].as_str().unwrap().to_owned(),
        op: ChangeOp::Delete,
        row: None,
        changed_fields: Vec::new(),
    };
    let mut membership_change = Value::Object(label_row);
    membership_change["_id"] = json!("g2b_selected_label_membership");
    membership_change["labelID"] = json!("g2b-selected-label");

    let self_user = corpus["authorityOwner"]["facts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|fact| fact["principal"] == "principal_ordinary")
        .unwrap()["userID"]
        .as_str()
        .unwrap();
    let view_self = json!({
        "_id":"g2b_view_self", "issueID":physical_issue,
        "userID":self_user, "viewed":9_000_000_000_000_i64
    });
    let view_other = json!({
        "_id":"g2b_view_other", "issueID":physical_issue,
        "userID":"g2b-other-user", "viewed":9_000_000_000_000_i64
    });

    vec![
        (
            "issue-edit-in-project".to_owned(),
            vec![update_change("issueListRead", in_project, &["open"])],
        ),
        (
            "issue-edit-out-of-project".to_owned(),
            vec![update_change("issueListRead", out_project, &["open"])],
        ),
        (
            "label-edge-add".to_owned(),
            vec![insert_change("issueLabelRead", label_add)],
        ),
        ("label-edge-remove".to_owned(), vec![label_remove]),
        (
            "comment-add".to_owned(),
            vec![insert_change("comment", comment)],
        ),
        (
            "view-state-write-self".to_owned(),
            vec![insert_change("viewState", view_self)],
        ),
        (
            "view-state-write-other".to_owned(),
            vec![insert_change("viewState", view_other)],
        ),
        (
            "selected-label-membership-change".to_owned(),
            vec![insert_change("issueLabelRead", membership_change)],
        ),
    ]
}

fn runtime_capture_artifact(
    runs: &[(
        String,
        GraphQueryCarrierV1,
        HandlerInput,
        Vec<CapturedReadDependency>,
    )],
) -> Value {
    let captures = runs
        .iter()
        .map(|(query, carrier, _, reads)| {
            json!({
                "query": query,
                "graphPlanHash": carrier.plan_hash,
                "capturedDependencies": reads.iter().filter_map(|read| read.graph.as_ref()).collect::<Vec<_>>(),
            })
        })
        .collect::<Vec<_>>();
    content_digest(json!({
        "format":"snapback.graph-runtime-captures.g2-b.v1",
        "version":1,
        "captures":captures,
    }))
}

fn match_disposition_artifact(
    corpus: &Value,
    runs: &[(
        String,
        GraphQueryCarrierV1,
        HandlerInput,
        Vec<CapturedReadDependency>,
    )],
) -> Value {
    let mut replays = Vec::new();
    let mut summary = BTreeMap::<GraphNodeKindV1, [u64; 3]>::new();
    for kind in [
        GraphNodeKindV1::RootWindow,
        GraphNodeKindV1::EqualityToOne,
        GraphNodeKindV1::BoundedToMany,
        GraphNodeKindV1::ExistsSemiJoin,
        GraphNodeKindV1::PrincipalBound,
        GraphNodeKindV1::SearchMembership,
        GraphNodeKindV1::ClosedProjection,
    ] {
        summary.insert(kind, [0, 0, 0]);
    }
    for (commit_id, changes) in graph_match_replay_commits(corpus) {
        for (query, carrier, input, reads) in runs {
            let definition = FunctionDefinition::new(
                query,
                FunctionKind::LiveQuery,
                FunctionRuntime::HostPlan(HandlerPlan::GraphQuery(carrier.clone())),
            );
            let decision = live_subscription_match_decision(&definition, input, reads, &changes);
            for node in &decision.graph_nodes {
                let counts = summary.get_mut(&node.node_kind).unwrap();
                counts[match node.disposition {
                    GraphNodeMatchDispositionV1::Skip => 0,
                    GraphNodeMatchDispositionV1::Match => 1,
                    GraphNodeMatchDispositionV1::ConservativeFallback => 2,
                }] += 1;
            }
            replays.push(json!({
                "commit":commit_id,
                "query":query,
                "overallDisposition":match_outcome_name(decision.outcome),
                "nodes":decision.graph_nodes,
            }));
        }
    }
    let summary = summary
        .into_iter()
        .map(|(node_kind, counts)| {
            json!({
                "nodeKind":node_kind,
                "skip":counts[0],
                "match":counts[1],
                "conservativeFallback":counts[2],
            })
        })
        .collect::<Vec<_>>();
    content_digest(json!({
        "format":"snapback.graph-match-dispositions.v1",
        "version":1,
        "commits":graph_match_replay_commits(corpus).iter().map(|(id, _)| id).collect::<Vec<_>>(),
        "replays":replays,
        "summary":summary,
    }))
}

fn write_frozen_json(relative: &str, value: &Value) {
    std::fs::write(
        repository_path(relative),
        format!("{}\n", serde_json::to_string_pretty(value).unwrap()),
    )
    .unwrap_or_else(|error| panic!("write {relative}: {error}"));
}

fn corpus_queries(corpus: &Value) -> impl Iterator<Item = &Value> {
    corpus["queries"].as_array().expect("queries array").iter()
}

fn assert_label_arrays_follow_graph_order(
    value: &Value,
    physical_by_source: &BTreeMap<String, String>,
) {
    match value {
        Value::Array(values) => {
            for value in values {
                assert_label_arrays_follow_graph_order(value, physical_by_source);
            }
        }
        Value::Object(fields) => {
            if let Some(labels) = fields.get("labels").and_then(Value::as_array) {
                let physical_ids = labels
                    .iter()
                    .map(|entry| {
                        let source_id = entry["label"]["id"]
                            .as_str()
                            .expect("mapped label source id");
                        physical_by_source
                            .get(source_id)
                            .unwrap_or_else(|| {
                                panic!("mapped label {source_id} resolves physically")
                            })
                            .clone()
                    })
                    .collect::<Vec<_>>();
                assert!(
                    physical_ids.windows(2).all(|pair| pair[0] < pair[1]),
                    "mapped label arrays follow labelID ASC graph order",
                );
            }
            for value in fields.values() {
                assert_label_arrays_follow_graph_order(value, physical_by_source);
            }
        }
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => {}
    }
}

fn assert_exact_object_keys(value: &Value, expected: &[&str], label: &str) {
    let actual = value
        .as_object()
        .unwrap_or_else(|| panic!("{label} is an object"))
        .keys()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    assert_eq!(
        actual,
        expected.iter().copied().collect(),
        "{label} closed keys"
    );
}

fn corpus_authority_owner() -> &'static Value {
    static OWNER: OnceLock<Value> = OnceLock::new();
    OWNER.get_or_init(|| load_json(CORPUS_FILE)["authorityOwner"].clone())
}

fn authority_fact(principal: &str) -> &'static Value {
    corpus_authority_owner()["facts"]
        .as_array()
        .expect("authority-owner facts")
        .iter()
        .find(|fact| fact["principal"] == principal)
        .unwrap_or_else(|| panic!("frozen authority-owner facts exist for {principal}"))
}

fn owner_project_role(fact: &Value) -> &'static str {
    let role = &fact["projectRoleFacts"];
    if role["isCrew"] == true {
        "crew"
    } else if role["isCreator"] == true && role["isAssignee"] == true {
        "creator-assignee"
    } else if role["isCreator"] == true {
        "creator"
    } else if role["isAssignee"] == true {
        "assignee"
    } else {
        "none"
    }
}

fn normalized_owner_scope(
    input: &GraphAuthorityClass2InputV1,
    args: &Value,
    principal: &str,
) -> Value {
    let fact = authority_fact(principal);
    let crew_membership = fact["crewMembership"]
        .as_bool()
        .expect("crewMembership fact");
    assert_eq!(fact["role"] == "crew", crew_membership);
    assert_eq!(fact["projectRoleFacts"]["isCrew"], crew_membership);
    let visibility = fact["visibilityPolicyInputs"]
        .as_array()
        .expect("visibility-policy facts")
        .iter()
        .find(|candidate| candidate["declarationId"] == input.declaration_id)
        .unwrap_or_else(|| {
            panic!(
                "{} has frozen visibility-policy facts",
                input.declaration_id
            )
        });
    assert_eq!(visibility["permissionFields"], json!(["visibility"]));
    assert_eq!(
        visibility["allowedValues"],
        if crew_membership {
            json!(["internal", "public"])
        } else {
            json!(["public"])
        },
        "allowed visibility values derive from frozen crew membership",
    );
    let scope_arguments = input
        .scope_argument_ids
        .iter()
        .map(|argument_id| {
            let value = args
                .get(argument_id)
                .unwrap_or_else(|| panic!("declared scope argument {argument_id}"));
            json!({"argumentId":argument_id,"value":value})
        })
        .collect::<Vec<_>>();
    let normalized = json!({
        "format":"snapback.graph-corpus-policy-equivalence-scope.v1",
        "policyInput":{
            "nodeId":input.node_id,
            "declarationId":input.declaration_id,
            "policyIdentity":input.policy_identity,
        },
        "rolePermissionFacts":{
            "crewMembership":crew_membership,
            "projectRole":owner_project_role(fact),
            "visibilityPolicyInput":visibility,
        },
        "scopeArguments":scope_arguments,
    });
    assert!(
        normalized.get("principal").is_none(),
        "raw principal is outside the class-2 scope preimage",
    );
    assert!(
        !snapback_types::rqs_contract::jcs(&normalized)
            .unwrap()
            .contains(principal),
        "raw principal value is absent from the complete class-2 scope preimage",
    );
    normalized
}

fn owner_resolved_scope_identities(
    carrier: &GraphQueryCarrierV1,
    args: &Value,
    principal: &str,
) -> Vec<String> {
    carrier
        .normalized_plan
        .authority_partition_rule
        .class2_inputs
        .iter()
        .map(|input| {
            jcs_domain_hash(
                OWNER_SCOPE_DOMAIN,
                &normalized_owner_scope(input, args, principal),
            )
        })
        .collect()
}

fn validate_corpus_invocation(
    carrier: &GraphQueryCarrierV1,
    call: &Value,
    function_name: &str,
) -> (
    GraphMaterializationIdentityV1,
    GraphAuthorityPartitionIdentityV1,
) {
    validate_corpus_invocation_with_disposition(carrier, call, function_name, None)
}

fn validate_corpus_invocation_with_disposition(
    carrier: &GraphQueryCarrierV1,
    call: &Value,
    function_name: &str,
    window_disposition: Option<&Value>,
) -> (
    GraphMaterializationIdentityV1,
    GraphAuthorityPartitionIdentityV1,
) {
    assert_eq!(
        call["planHash"].as_str(),
        Some(carrier.plan_hash.as_str()),
        "invocation binds its carrier",
    );
    assert_eq!(
        call["materialization"]["function"]["name"], function_name,
        "materialization binds the declared corpus function",
    );
    assert!(
        call["authorizationVersion"]["incarnation"]
            .as_str()
            .is_some()
    );
    assert!(call["authorizationVersion"]["epoch"].as_u64().is_some());
    assert!(call["evaluationCut"].as_u64().is_some());

    let windows: Vec<GraphNodeWindowIdentityV1> =
        serde_json::from_value(call["windows"].clone()).expect("invocation windows");
    let evaluated_parents = windows
        .iter()
        .filter_map(|window| {
            let parents = window
                .intervals
                .iter()
                .map(|interval| interval.parent_key.clone())
                .collect::<Option<Vec<GraphRowKeyV1>>>()?;
            Some((window.node_id.clone(), parents))
        })
        .collect::<BTreeMap<_, _>>();
    if let Some(disposition) = window_disposition {
        assert_eq!(disposition["status"], "VALIDATED");
    }
    let instance_hash =
        graph_instance_identity_v1(carrier, &call["args"], windows, &evaluated_parents)
            .unwrap_or_else(|reason| {
                panic!("{function_name} invocation instance identity reconstructs: {reason:?}")
            })
            .instance_hash
            .as_str()
            .to_owned();
    let materialization: GraphMaterializationPreimageV1 =
        serde_json::from_value(call["materialization"].clone())
            .expect("invocation materialization preimage");
    assert_eq!(
        materialization.graph_instance_hash.as_str(),
        instance_hash,
        "materialization binds the rebuilt instance",
    );
    let materialization = graph_materialization_identity_v1(materialization)
        .expect("invocation materialization identity reconstructs");
    let partition_preimage: GraphAuthorityPartitionPreimageV1 =
        serde_json::from_value(call["partition"].clone())
            .expect("invocation carries the complete authority-partition preimage");
    assert_eq!(
        partition_preimage.graph_plan_hash, carrier.plan_hash,
        "partition preimage binds the exact plan",
    );
    assert!(
        partition_preimage.class3.is_some(),
        "the three corpus graphs all roll up principal-scoped nodes as partition-of-one",
    );
    assert!(
        !partition_preimage.class2.is_empty(),
        "the crew-or-public control policy resolves class-2 inputs",
    );
    assert_eq!(
        corpus_authority_owner()["scopeHashDomain"],
        OWNER_SCOPE_DOMAIN,
    );
    let principal = call["partition"]["class3"]["principalDataScope"]["userId"]
        .as_str()
        .expect("partition-of-one carries the owner-issued principal");
    let declared_class2 = carrier
        .normalized_plan
        .authority_partition_rule
        .class2_inputs
        .iter()
        .map(|input| {
            (
                input.node_id.as_str(),
                input.declaration_id.as_str(),
                input.policy_identity.as_str(),
            )
        })
        .collect::<Vec<_>>();
    let resolved_class2 = partition_preimage
        .class2
        .iter()
        .zip(
            carrier
                .normalized_plan
                .authority_partition_rule
                .class2_inputs
                .iter(),
        )
        .map(|(input, declared)| {
            assert_ne!(input.scope_identity.as_str(), zero_hash());
            assert_eq!(input.node_id, declared.node_id);
            assert_eq!(input.declaration_id, declared.declaration_id);
            let normalized_scope = normalized_owner_scope(declared, &call["args"], principal);
            assert_eq!(
                input.scope_identity.as_str(),
                jcs_domain_hash(OWNER_SCOPE_DOMAIN, &normalized_scope),
                "Rust independently reconstructs owner-normalized class-2 scope identity",
            );
            (
                input.node_id.as_str(),
                input.declaration_id.as_str(),
                input.policy_identity.as_str(),
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(
        resolved_class2, declared_class2,
        "class-2 inputs resolve exactly"
    );
    let partition = graph_authority_partition_identity_v1(partition_preimage)
        .expect("Rust reconstructs the complete authority-partition identity");
    (materialization, partition)
}

fn validate_broadcast_invocation(
    carrier: &GraphQueryCarrierV1,
    call: &Value,
    function_name: &str,
) -> (
    GraphMaterializationIdentityV1,
    GraphAuthorityPartitionIdentityV1,
) {
    assert_eq!(call["planHash"], carrier.plan_hash.as_str());
    assert_eq!(call["materialization"]["function"]["name"], function_name);
    let windows: Vec<GraphNodeWindowIdentityV1> =
        serde_json::from_value(call["windows"].clone()).expect("broadcast invocation windows");
    let evaluated_parents = windows
        .iter()
        .filter_map(|window| {
            let parents = window
                .intervals
                .iter()
                .map(|interval| interval.parent_key.clone())
                .collect::<Option<Vec<GraphRowKeyV1>>>()?;
            Some((window.node_id.clone(), parents))
        })
        .collect::<BTreeMap<_, _>>();
    let instance = graph_instance_identity_v1(carrier, &call["args"], windows, &evaluated_parents)
        .expect("class-1 broadcast instance identity reconstructs");
    let materialization_preimage: GraphMaterializationPreimageV1 =
        serde_json::from_value(call["materialization"].clone())
            .expect("broadcast materialization preimage");
    assert_eq!(
        materialization_preimage.graph_instance_hash,
        instance.instance_hash
    );
    let materialization = graph_materialization_identity_v1(materialization_preimage)
        .expect("broadcast materialization identity reconstructs");
    let partition_preimage: GraphAuthorityPartitionPreimageV1 =
        serde_json::from_value(call["partition"].clone()).expect("broadcast partition preimage");
    assert!(partition_preimage.class2.is_empty());
    assert!(partition_preimage.class3.is_none());
    let partition = graph_authority_partition_identity_v1(partition_preimage)
        .expect("class-1 broadcast authority partition reconstructs");
    (materialization, partition)
}

fn fixture_membership_table<'a>(schema: &'a Value, declaration: &str) -> &'a Value {
    schema["tables"]
        .as_array()
        .expect("broadcast schema tables")
        .iter()
        .find(|table| {
            table["membership"].is_object()
                && table["membership"]["id"]
                    .as_str()
                    .unwrap_or_else(|| table["name"].as_str().unwrap())
                    == declaration
        })
        .unwrap_or_else(|| panic!("installed fixture membership {declaration}"))
}

/// The establishment seam performs its own installed membership lookup. It
/// deliberately cannot consume a strict-evaluation result.
fn fixture_establishment_evaluation(
    carrier: &Value,
    schema: &Value,
    fixture: &Value,
    args: &Value,
    principal: &str,
) -> Value {
    let plan = &carrier["normalizedPlan"];
    let establishment = &plan["broadcast"]["establishment"];
    assert_eq!(plan["broadcast"]["classification"], "broadcast");
    let predicate = &establishment["predicate"];
    let declaration = predicate["declaration"].as_str().unwrap();
    let table = fixture_membership_table(schema, declaration);
    let membership = &table["membership"];
    let scope_argument_id = establishment["scope"]["argumentIds"][0].as_str().unwrap();
    let argument_name = plan["arguments"]
        .as_array()
        .unwrap()
        .iter()
        .find(|argument| argument["argumentId"] == scope_argument_id)
        .and_then(|argument| argument["name"].as_str())
        .expect("establishment scope argument");
    let resource = &args[argument_name];
    let roles = predicate["roles"].as_array().expect("establishment roles");
    let allowed = fixture[declaration]
        .as_array()
        .expect("establishment membership rows")
        .iter()
        .any(|row| {
            row[membership["principal"].as_str().unwrap()] == principal
                && row[membership["resource"].as_str().unwrap()] == *resource
                && roles.contains(&row[membership["role"].as_str().unwrap()])
        });
    json!({
        "outcome": if allowed { "allow" } else { "deny" },
        "declaration": declaration,
        "resource": resource,
    })
}

fn fixture_value_cmp(left: &Value, right: &Value) -> std::cmp::Ordering {
    match (left, right) {
        (Value::Number(left), Value::Number(right)) => left.as_i64().cmp(&right.as_i64()),
        (Value::String(left), Value::String(right)) => left.cmp(right),
        _ => snapback_types::rqs_contract::jcs(left)
            .unwrap()
            .cmp(&snapback_types::rqs_contract::jcs(right).unwrap()),
    }
}

/// The fixture's strict-delivery seam independently performs function-level
/// membership admission, then executes the closed class-1 root/projection. It
/// never calls `fixture_establishment_evaluation` or copies its outcome.
fn fixture_strict_delivery_evaluation(
    carrier: &Value,
    schema: &Value,
    fixture: &Value,
    args: &Value,
    principal: &str,
) -> Value {
    let plan = &carrier["normalizedPlan"];
    let Some(predicate) = plan["functionMembership"]
        .as_array()
        .and_then(|rows| (rows.len() == 1).then(|| &rows[0]))
    else {
        return json!({"outcome":"deny","resultBytes":null,"orderedRootIds":[],"resultLength":0,"existence":"withheld","completeness":null});
    };
    let declaration = predicate["declaration"].as_str().unwrap();
    let table = fixture_membership_table(schema, declaration);
    let membership = &table["membership"];
    let argument_name = predicate["resource"]["arg"]["path"].as_str().unwrap();
    let resource = &args[argument_name];
    let roles = predicate["roles"].as_array().expect("strict roles");
    let admitted = fixture[declaration]
        .as_array()
        .expect("strict membership rows")
        .iter()
        .any(|row| {
            row[membership["principal"].as_str().unwrap()] == principal
                && row[membership["resource"].as_str().unwrap()] == *resource
                && roles.contains(&row[membership["role"].as_str().unwrap()])
        });
    if !admitted {
        return json!({"outcome":"deny","resultBytes":null,"orderedRootIds":[],"resultLength":0,"existence":"withheld","completeness":null});
    }

    let nodes = plan["nodes"].as_array().unwrap();
    let root = nodes
        .iter()
        .find(|node| node["kind"] == "root-window")
        .expect("strict root");
    let projection = nodes
        .iter()
        .find(|node| node["kind"] == "closed-projection")
        .expect("strict projection");
    let mut rows = fixture[root["table"].as_str().unwrap()]
        .as_array()
        .unwrap()
        .iter()
        .filter(|row| {
            root["filters"].as_array().unwrap().iter().all(|filter| {
                assert_eq!(filter["op"], "Eq");
                let argument_id = filter["value"]["Arg"].as_str().unwrap();
                let argument_name = plan["arguments"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|argument| argument["argumentId"] == argument_id)
                    .and_then(|argument| argument["name"].as_str())
                    .unwrap();
                row[filter["field"].as_str().unwrap()] == args[argument_name]
            })
        })
        .collect::<Vec<_>>();
    rows.sort_by(|left, right| {
        for order in root["order"].as_array().unwrap() {
            let field = order["field"].as_str().unwrap();
            let mut comparison = fixture_value_cmp(&left[field], &right[field]);
            if order["direction"] == "Desc" {
                comparison = comparison.reverse();
            }
            if !comparison.is_eq() {
                return comparison;
            }
        }
        left["_id"]
            .as_str()
            .unwrap()
            .cmp(right["_id"].as_str().unwrap())
    });
    let root_id = root["nodeId"].as_str().unwrap();
    let max_rows = plan["queryCost"]["graph"]["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|cost| cost["nodeId"] == root_id)
        .and_then(|cost| cost["maxRootRowsPerPage"].as_u64())
        .unwrap() as usize;
    rows.truncate(max_rows);
    let projected = rows
        .iter()
        .map(|row| {
            let mut object = serde_json::Map::new();
            for field in projection["object"]["fields"].as_array().unwrap() {
                assert_eq!(field["value"]["kind"], "field");
                assert_eq!(field["value"]["nodeId"], root_id);
                object.insert(
                    field["name"].as_str().unwrap().to_owned(),
                    row[field["value"]["field"].as_str().unwrap()].clone(),
                );
            }
            Value::Object(object)
        })
        .collect::<Vec<_>>();
    let result_bytes = serde_json::to_string(&projected).unwrap();
    json!({
        "outcome":"allow",
        "resultBytes":result_bytes,
        "orderedRootIds":rows.iter().map(|row| row["_id"].clone()).collect::<Vec<_>>(),
        "resultLength":projected.len(),
        "existence":if projected.is_empty() { "absent" } else { "present" },
        "completeness":"complete",
    })
}

fn carrier() -> GraphQueryCarrierV1 {
    serde_json::from_str(include_str!(
        "../../../tests/conformance/graph/minimal-carrier.v1.json"
    ))
    .expect("minimal graph carrier")
}

fn zero_hash() -> &'static str {
    "sha256:0000000000000000000000000000000000000000000000000000000000000000"
}

fn one_hash() -> &'static str {
    "sha256:1111111111111111111111111111111111111111111111111111111111111111"
}

#[test]
fn owner_resolved_class2_scope_identities_partition_equivalence() {
    let corpus = graph_corpus();
    let owner = &corpus["authorityOwner"];
    assert_eq!(owner["format"], "snapback.graph-corpus-authority-owner.v1");
    assert_eq!(owner["scopeHashDomain"], OWNER_SCOPE_DOMAIN);
    let assertions = owner["equivalenceAssertions"]
        .as_array()
        .expect("owner equivalence assertions");
    assert_eq!(assertions.len(), 2);
    for assertion in assertions {
        let query_name = assertion["query"].as_str().expect("assertion query");
        let query = corpus_queries(&corpus)
            .find(|query| query["query"] == query_name)
            .expect("assertion query carrier");
        let carrier: GraphQueryCarrierV1 =
            serde_json::from_value(query["carrier"].clone()).unwrap();
        let principals = assertion["principals"]
            .as_array()
            .expect("assertion principals");
        assert_eq!(principals.len(), 2);
        let left = owner_resolved_scope_identities(
            &carrier,
            &assertion["graphArgs"],
            principals[0].as_str().unwrap(),
        );
        let right = owner_resolved_scope_identities(
            &carrier,
            &assertion["graphArgs"],
            principals[1].as_str().unwrap(),
        );
        assert_eq!(assertion["scopeIdentities"]["left"], json!(left.clone()));
        assert_eq!(assertion["scopeIdentities"]["right"], json!(right.clone()));
        match assertion["relation"].as_str().unwrap() {
            "same" => assert_eq!(left, right, "same equivalence class has one scope identity"),
            "different" => assert_ne!(
                left, right,
                "different equivalence classes have distinct scope identities"
            ),
            relation => panic!("unexpected owner equivalence relation {relation}"),
        }
    }
}

fn root_window(node_id: &str) -> GraphNodeWindowIdentityV1 {
    GraphNodeWindowIdentityV1 {
        node_id: node_id.to_owned(),
        intervals: vec![GraphParentWindowIdentityV1 {
            parent_key: None,
            window: GraphWindowIdentityV1 {
                order: vec![OrderExpr {
                    field: "updatedAt".to_owned(),
                    direction: OrderDirection::Desc,
                    max_encoded_bytes: None,
                }],
                direction: GraphDirectionV1::Backward,
                lower: GraphIntervalEndV1::Unbounded,
                upper: GraphIntervalEndV1::Unbounded,
                take: 2,
            },
        }],
    }
}

#[test]
fn identity_vectors() {
    let supplied = carrier();
    let rebuilt = graph_plan_identity_v1(&supplied.normalized_plan).expect("host identity");
    assert_eq!(supplied, rebuilt);
    let vectors: Value = serde_json::from_str(include_str!(
        "../../../tests/conformance/graph/identity-vectors.v1.json"
    ))
    .unwrap();
    assert_eq!(supplied.plan_hash.as_str(), vectors["plan"]["hash"]);
    let mut rotated_plan_candidate = supplied.normalized_plan.clone();
    let GraphNodeV1::RootWindow { table, .. } = &mut rotated_plan_candidate.nodes[0] else {
        unreachable!()
    };
    *table = "issues_rotated".to_owned();
    let rotated_plan = graph_plan_identity_v1(&rotated_plan_candidate).unwrap();
    assert_eq!(
        rotated_plan.plan_hash.as_str(),
        vectors["plan"]["rotatedHash"]
    );
    assert_ne!(supplied.plan_hash, rotated_plan.plan_hash);

    let instance = graph_instance_identity_v1(
        &supplied,
        &json!({}),
        vec![root_window("n0")],
        &BTreeMap::new(),
    )
    .expect("instance identity");
    assert_eq!(instance.instance_hash.as_str(), vectors["instance"]["hash"]);
    let mut rotated_window = root_window("n0");
    rotated_window.intervals[0].window.take = 1;
    let rotated_instance = graph_instance_identity_v1(
        &supplied,
        &json!({}),
        vec![rotated_window],
        &BTreeMap::new(),
    )
    .expect("rotated instance");
    assert_eq!(
        rotated_instance.instance_hash.as_str(),
        vectors["instance"]["rotatedHash"]
    );
    assert_ne!(instance.instance_hash, rotated_instance.instance_hash);

    let preimage: GraphMaterializationPreimageV1 = serde_json::from_value(json!({
        "format":"snapback.graph-materialization.v1", "appId":"app", "databaseId":"db",
        "deploymentId":"deployment-a", "targetProfileId":"local", "activationHash":zero_hash(),
        "function":{
            "artifactKind":"functionReference", "schemaVersion":"snapback.v1", "appId":"app",
            "id":"fn-id", "name":"issues", "kind":"LiveQuery",
            "implementationHash":zero_hash(), "argsContractHash":zero_hash(),
            "resultContractHash":zero_hash(),
            "expectedGeneration":{"schemaVersion":"snapback.v1","appId":"app","schemaHash":"schema","bundleHash":"bundle","inputsHash":"inputs"}
        },
        "graphInstanceHash":instance.instance_hash
    }))
    .expect("materialization preimage");
    let materialization = graph_materialization_identity_v1(preimage.clone()).unwrap();
    assert_eq!(
        materialization.materialization_hash.as_str(),
        vectors["materialization"]["hash"]
    );
    let mut rotated_preimage = preimage;
    rotated_preimage.deployment_id = "deployment-b".to_owned();
    let rotated_materialization = graph_materialization_identity_v1(rotated_preimage).unwrap();
    assert_eq!(
        rotated_materialization.materialization_hash.as_str(),
        vectors["materialization"]["rotatedHash"]
    );
    assert_ne!(
        materialization.materialization_hash,
        rotated_materialization.materialization_hash
    );

    let proof = recompute_graph_partition_equivalence_proof_v1(&GraphPartitionEquivalenceProofV1 {
        format: "snapback.graph-partition-equivalence-proof.v1".to_owned(),
        node_id: "n0".to_owned(),
        declared_class: GraphProofDeclaredClassV1::Class2,
        policy_inputs: vec![
            GraphPolicyInputV1 {
                declaration_id: "z-policy".to_owned(),
                kind: GraphPolicyInputKindV1::Role,
                identity: Sha256V1::new(one_hash()).unwrap(),
            },
            GraphPolicyInputV1 {
                declaration_id: "a-policy".to_owned(),
                kind: GraphPolicyInputKindV1::Membership,
                identity: Sha256V1::new(zero_hash()).unwrap(),
            },
        ],
        partition_function: Sha256V1::new(zero_hash()).unwrap(),
        equivalence_witness: GraphEquivalenceWitnessV1::DeclaredInputsOnly,
    })
    .unwrap();
    assert_eq!(
        proof.partition_function.as_str(),
        vectors["partitionFunction"]["hash"]
    );
    let mut rotated_proof = proof.clone();
    rotated_proof.policy_inputs[0].identity = Sha256V1::new(one_hash()).unwrap();
    let rotated_proof = recompute_graph_partition_equivalence_proof_v1(&rotated_proof).unwrap();
    assert_eq!(
        rotated_proof.partition_function.as_str(),
        vectors["partitionFunction"]["rotatedHash"]
    );
    assert_ne!(proof.partition_function, rotated_proof.partition_function);

    let partition = graph_authority_partition_identity_v1(GraphAuthorityPartitionPreimageV1 {
        format: "snapback.graph-authority-partition.v1".to_owned(),
        graph_plan_hash: supplied.plan_hash.clone(),
        class2: vec![GraphResolvedPartitionInputV1 {
            node_id: "n0".to_owned(),
            declaration_id: "a-policy".to_owned(),
            scope_identity: Sha256V1::new(zero_hash()).unwrap(),
            policy_identity: Sha256V1::new(one_hash()).unwrap(),
        }],
        class3: None,
    })
    .unwrap();
    assert_eq!(
        partition.partition_hash.as_str(),
        vectors["authorityPartition"]["hash"]
    );
    let mut rotated_partition_preimage = partition.preimage.clone();
    rotated_partition_preimage.class2[0].scope_identity = Sha256V1::new(one_hash()).unwrap();
    let rotated_partition =
        graph_authority_partition_identity_v1(rotated_partition_preimage).unwrap();
    assert_eq!(
        rotated_partition.partition_hash.as_str(),
        vectors["authorityPartition"]["rotatedHash"]
    );
    assert_ne!(partition.partition_hash, rotated_partition.partition_hash);

    let mut scope_plan = supplied.normalized_plan.clone();
    scope_plan.broadcast = GraphBroadcastAdmissionV1::Broadcast {
        format: "snapback.graph-broadcast-admission.v1".to_owned(),
        base_node_ids: vec!["n0".to_owned()],
        establishment: GraphBroadcastEstablishmentV1 {
            effect: GraphBroadcastEffectV1::AdmitOnly,
            predicate: TableVisibilityV1::PublicRead,
            overlay_projection: (),
            scope: GraphBroadcastScopeV1 {
                argument_ids: Vec::new(),
                policy_identity: Sha256V1::new(zero_hash()).unwrap(),
                resource_equalities: Vec::new(),
            },
            audience: GraphBroadcastAudienceV1 {
                installed_owner_identity: Sha256V1::new(zero_hash()).unwrap(),
                strict_evaluator_identity: Sha256V1::new(zero_hash()).unwrap(),
            },
            invalidation: Vec::new(),
        },
    };
    let scope = graph_broadcast_scope_identity_v1(
        &scope_plan,
        GraphBroadcastScopePreimageV1 {
            format: "snapback.graph-broadcast-scope.v1".to_owned(),
            graph_materialization_hash: materialization.materialization_hash.clone(),
            policy_identity: Sha256V1::new(zero_hash()).unwrap(),
            arguments: Vec::new(),
        },
    )
    .unwrap();
    assert_eq!(scope.scope_hash.as_str(), vectors["broadcastScope"]["hash"]);
    let mut rotated_scope_preimage = scope.preimage.clone();
    rotated_scope_preimage.policy_identity = Sha256V1::new(one_hash()).unwrap();
    scope_plan.broadcast = GraphBroadcastAdmissionV1::Broadcast {
        format: "snapback.graph-broadcast-admission.v1".to_owned(),
        base_node_ids: vec!["n0".to_owned()],
        establishment: GraphBroadcastEstablishmentV1 {
            effect: GraphBroadcastEffectV1::AdmitOnly,
            predicate: TableVisibilityV1::PublicRead,
            overlay_projection: (),
            scope: GraphBroadcastScopeV1 {
                argument_ids: Vec::new(),
                policy_identity: Sha256V1::new(one_hash()).unwrap(),
                resource_equalities: Vec::new(),
            },
            audience: GraphBroadcastAudienceV1 {
                installed_owner_identity: Sha256V1::new(zero_hash()).unwrap(),
                strict_evaluator_identity: Sha256V1::new(zero_hash()).unwrap(),
            },
            invalidation: Vec::new(),
        },
    };
    let rotated_scope =
        graph_broadcast_scope_identity_v1(&scope_plan, rotated_scope_preimage).unwrap();
    assert_eq!(
        rotated_scope.scope_hash.as_str(),
        vectors["broadcastScope"]["rotatedHash"]
    );
    assert_ne!(scope.scope_hash, rotated_scope.scope_hash);
}

#[test]
fn dependency_shapes() {
    let mut graph: GraphCapturedReadV1 = serde_json::from_value(json!({
        "format":"snapback.graph-captured-read.v1",
        "graphPlanHash":carrier().plan_hash,
        "instanceHash":"sha256:0000000000000000000000000000000000000000000000000000000000000000",
        "nodeId":"n0", "nodeKind":"root-window", "authorityClass":1,
        "dependency":{
            "kind":"root-range", "table":"issues", "index":"by_updated",
            "predicate":[], "order":[{"field":"updatedAt","direction":"Desc"}],
            "limit":2, "resultCount":0, "boundary":null, "complete":true
        }
    }))
    .unwrap();
    let bound_carrier = carrier();
    let plan = &bound_carrier.normalized_plan;
    validate_graph_captured_read_v1(&graph, plan).expect("capture binds the normalized node");
    graph.node_id = "n1".to_owned();
    assert!(validate_graph_captured_read_v1(&graph, plan).is_err());
    graph.node_id = "n0".to_owned();
    let read = CapturedReadDependency {
        kind: CapturedReadKind::GraphNode,
        graph: Some(graph),
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
    };
    assert!(graph_capture_carrier_is_well_formed(&read));
}

#[test]
fn no_runtime_consumer() {
    let definition = FunctionDefinition::new(
        "graphIssues",
        FunctionKind::LiveQuery,
        FunctionRuntime::HostPlan(HandlerPlan::GraphQuery(carrier())),
    );
    let targets = [
        CapabilityManifest::local_v0_declared(),
        CapabilityManifest::local_v0_outbound_actions_declared(),
        CapabilityManifest::remote_service_sqlite_ibex_declared(),
        CapabilityManifest::cloudflare_do_sqlite_v8_declared(),
    ];
    let acknowledged = BTreeSet::from([TargetCapabilityId::GraphQueryV1]);
    for target in &targets {
        assert!(
            !TargetCapabilityId::GraphQueryV1
                .is_supported_by(target, TargetCapabilityFacts::default()),
            "{} must not register a B1 graph executor",
            target.target_profile_id
        );
        let error = target
            .require_capabilities(["graph_query_v1"], &acknowledged)
            .expect_err("target admission must reject graph execution-shaped use");
        assert_eq!(error.diagnostic.code, "SNAPBACK_CAPABILITY_UNSUPPORTED");
    }
    let input = HandlerInput {
        args: json!({}),
        auth: AuthInput::default(),
        read_set: Vec::new(),
        correlation: None,
        ctx_ledger: None,
    };
    let change = ChangedRow {
        table: "unrelated".to_owned(),
        id: "row".to_owned(),
        op: ChangeOp::Update,
        row: Some(json!({"_id":"row"})),
        changed_fields: vec!["value".to_owned()],
    };
    assert_eq!(
        live_subscription_match_outcome(&definition, &input, &[], &[change]),
        LiveMatchOutcome::ConservativeFallback
    );

    let mut snapback = LocalSnapback::memory().expect("forged graph engine");
    snapback.install_forged_function_for_test(definition);
    let error = snapback
        .invoke_query("graphIssues", input)
        .expect_err("B1 has no graph executor even after an in-memory forge");
    assert_eq!(error.diagnostic.code, "SNAPBACK_FUNCTION_KIND_MISMATCH");
}

/// The three corpus-owned declarations are real generated graph carriers.
/// Rust reconstructs their normalized identities and every frozen oracle byte
/// digest; the opaque envelopes are evidence, never a graph execution claim.
#[test]
fn zerobugs_declarations_admit_with_host_identities() {
    let corpus = graph_corpus();
    let mut without_digest = corpus.clone();
    without_digest
        .as_object_mut()
        .expect("corpus object")
        .remove("contentDigest");
    assert_eq!(
        corpus["contentDigest"].as_str(),
        Some(jcs_domain_hash("", &without_digest).as_str()),
        "whole corpus digest must bind all frozen evidence",
    );

    let names = corpus_queries(&corpus)
        .map(|query| query["query"].as_str().expect("query name"))
        .collect::<BTreeSet<_>>();
    assert_eq!(
        names,
        BTreeSet::from(["issueDetail", "issueListV2", "listIssueByID"])
    );
    for query in corpus_queries(&corpus) {
        let carrier: GraphQueryCarrierV1 =
            serde_json::from_value(query["carrier"].clone()).expect("carrier deserializes");
        assert_eq!(
            graph_plan_identity_v1(&carrier.normalized_plan).expect("host reconstructs plan"),
            carrier,
            "{} host identity",
            query["query"],
        );
        assert_eq!(query["disposition"]["structuralDeclaration"], "admitted");
        assert_eq!(query["disposition"]["fullOracleRows"], "refused");
        let nodes = query["carrier"]["normalizedPlan"]["nodes"]
            .as_array()
            .expect("normalized nodes");
        let root = nodes
            .iter()
            .find(|node| node["kind"] == "root-window")
            .expect("root node");
        match query["query"].as_str().unwrap() {
            "issueListV2" => assert_eq!(
                root["order"],
                json!([
                    {"field":"modified","direction":"Desc"},
                    {"field":"sourceIssueID","direction":"Desc"}
                ]),
            ),
            "issueDetail" => {
                let comments = nodes
                    .iter()
                    .find(|node| node["edgeName"] == "comments")
                    .expect("comments child");
                assert_eq!(
                    comments["order"],
                    json!([{"field":"created","direction":"Desc"}]),
                );
            }
            "listIssueByID" => assert_eq!(
                root["order"],
                json!([{"field":"sourceIssueID","direction":"Asc"}]),
            ),
            _ => unreachable!(),
        }
    }

    let oracle_cases = corpus["oracleCases"].as_array().expect("oracle cases");
    assert_eq!(oracle_cases.len(), 8);
    let labels = load_json("demos/zerobugs/control/fixtures/normal-seed-v1/label.json");
    let physical_by_source = labels
        .as_array()
        .expect("normal labels")
        .iter()
        .map(|row| {
            (
                row["id"].as_str().unwrap().to_owned(),
                row["_id"].as_str().unwrap().to_owned(),
            )
        })
        .collect::<BTreeMap<_, _>>();
    for case in oracle_cases {
        let bytes = case["oracle"]["resultBytes"]
            .as_str()
            .expect("oracle bytes");
        assert_eq!(
            case["oracle"]["digest"].as_str(),
            Some(byte_hash(bytes).as_str()),
            "{} oracle bytes bind their digest",
            case["id"],
        );
        let expected = &case["declaredGraph"]["expected"];
        if expected["graphCompleteness"] == "refused" {
            assert_eq!(expected["kind"], "result");
            assert_eq!(expected["label"], "refused");
            assert!(expected["resultBytes"].is_null());
            assert!(expected["digest"].is_null());
            assert_eq!(expected["orderedRootIds"], json!([]));
            assert_eq!(expected["resultLength"], 0);
            assert_eq!(expected["continuation"], json!([]));
            assert!(
                expected["refusalReason"]
                    .as_str()
                    .is_some_and(|reason| !reason.is_empty()),
            );
        } else {
            let expected_bytes = expected["resultBytes"]
                .as_str()
                .expect("mapped expected bytes");
            assert_eq!(
                expected["digest"].as_str(),
                Some(byte_hash(expected_bytes).as_str()),
                "{} mapped expected bytes bind their digest",
                case["id"],
            );
            let expected_rows =
                serde_json::from_str::<Value>(expected_bytes).expect("mapped expected rows parse");
            assert_eq!(
                expected_rows.as_array().map(Vec::len),
                expected["resultLength"]
                    .as_u64()
                    .map(|value| value as usize),
            );
            assert_label_arrays_follow_graph_order(&expected_rows, &physical_by_source);
        }
        assert!(matches!(
            expected["graphCompleteness"].as_str(),
            Some("complete" | "prefix" | "window" | "refused" | "unknown")
        ));
        for node in expected["nodeCompleteness"]
            .as_array()
            .expect("mapped node labels")
        {
            assert!(node["graphNodeId"].as_str().is_some());
            for row in node["rows"].as_array().expect("mapped node label rows") {
                assert!(row["rootId"].as_str().is_some());
                let graph_label = row["graphLabel"].as_str();
                let excluded = row["excludedReason"].as_str();
                assert_ne!(graph_label.is_some(), excluded.is_some());
            }
        }
        assert_eq!(case["fieldMap"]["query"], case["query"]);
        if case.get("oracleDivergence").is_some() {
            assert_eq!(case["oracleDivergence"], "direction-tie-break");
            assert_eq!(
                case["fieldMap"]["order"]["comparison"],
                "exact-after-id-tiebreak-normalization",
            );
        } else {
            assert_eq!(case["fieldMap"]["order"]["comparison"], "exact-id-order");
        }
        if let Some(resumed_bytes) = case["oracle"]["resumedResultBytes"].as_str() {
            assert_eq!(
                case["oracle"]["resumedDigest"].as_str(),
                Some(byte_hash(resumed_bytes).as_str()),
            );
            let resumed_rows = case["oracle"]["resumedRowsBytes"]
                .as_str()
                .expect("resumption freezes mapped next-page rows");
            assert_eq!(
                case["oracle"]["resumedRowsDigest"].as_str(),
                Some(byte_hash(resumed_rows).as_str()),
            );
            let continuation = expected["continuation"]
                .as_array()
                .expect("resumed result carries continuation evidence")
                .first()
                .expect("one resumed continuation");
            assert_eq!(continuation["nextPageResultBytes"], resumed_rows);
            assert_eq!(
                continuation["nextPageDigest"],
                case["oracle"]["resumedRowsDigest"]
            );
            let rows: Value =
                serde_json::from_str(resumed_rows).expect("mapped resumed rows parse");
            assert!(rows.as_array().is_some_and(|rows| !rows.is_empty()));
        }
    }
    let tied = oracle_cases
        .iter()
        .find(|case| case["id"] == "issueListV2-backward-tied-modified")
        .expect("backward list tie case");
    assert_eq!(tied["invocation"]["dir"], "backward");
    assert_eq!(tied["declaredGraph"]["comparison"], "exact-id-order");
    assert_eq!(tied["declaredGraph"]["declaredTieGroups"], 69);
    assert_eq!(tied["declaredGraph"]["residualImplicitTieGroups"], 0);
    assert_eq!(
        tied["declaredGraph"]["orderedSourceIssueIDs"],
        tied["declaredGraph"]["expected"]["orderedRootIds"],
    );
    assert!(
        tied["declaredGraph"]["orderedSourceIssueIDs"]
            .as_array()
            .is_some_and(|rows| rows.len() >= 2),
        "the explicit sourceIssueID order is backed by a nontrivial tied result",
    );
    let detail_tie = oracle_cases
        .iter()
        .find(|case| case["id"] == "issueDetail-comments-window-and-child-tie")
        .expect("detail continuation with a child tie");
    assert_eq!(detail_tie["oracleDivergence"], "direction-tie-break");
    assert_eq!(detail_tie["fieldMap"]["order"]["graphNodeId"], "n2");
    assert_eq!(
        detail_tie["fieldMap"]["order"]["oracleFields"],
        json!([
            "value.comments[*].comment.created",
            "value.comments[*].comment.id"
        ]),
    );
    assert_eq!(
        detail_tie["fieldMap"]["order"]["comparison"],
        "exact-after-id-tiebreak-normalization",
    );
    let raw_oracle: Value =
        serde_json::from_str(detail_tie["oracle"]["resultBytes"].as_str().unwrap())
            .expect("raw detail oracle parses");
    let oracle_comments = raw_oracle[0]["value"]["comments"]
        .as_array()
        .expect("raw oracle comments")
        .iter()
        .map(|row| {
            json!({
                "id":row["comment"]["id"],
                "created":row["comment"]["created"],
                "body":row["comment"]["body"],
            })
        })
        .collect::<Vec<_>>();
    let expected_rows: Value = serde_json::from_str(
        detail_tie["declaredGraph"]["expected"]["resultBytes"]
            .as_str()
            .unwrap(),
    )
    .expect("normalized graph rows parse");
    let expected_comments = expected_rows[0]["comments"]
        .as_array()
        .expect("expected graph comments");
    assert_eq!(oracle_comments.len(), expected_comments.len());
    let oracle_row_set = oracle_comments
        .iter()
        .map(|row| snapback_types::rqs_contract::jcs(row).unwrap())
        .collect::<BTreeSet<_>>();
    let expected_row_set = expected_comments
        .iter()
        .map(|row| snapback_types::rqs_contract::jcs(row).unwrap())
        .collect::<BTreeSet<_>>();
    assert_eq!(
        oracle_row_set, expected_row_set,
        "direction divergence preserves the exact row set",
    );
    let bindings = detail_tie["oracle"]["physicalIdBindings"]
        .as_array()
        .expect("physical-id tie bindings")
        .iter()
        .map(|binding| {
            (
                binding["sourceId"].as_str().unwrap().to_owned(),
                (
                    binding["physicalId"].as_str().unwrap().to_owned(),
                    binding["createdAt"].as_i64().unwrap(),
                ),
            )
        })
        .collect::<BTreeMap<_, _>>();
    let mut normalized_oracle = Vec::with_capacity(oracle_comments.len());
    let mut tied_source_ids = BTreeSet::new();
    let mut tied_groups = 0usize;
    let mut start = 0usize;
    while start < oracle_comments.len() {
        let created = oracle_comments[start]["created"].as_i64().unwrap();
        let mut end = start + 1;
        while end < oracle_comments.len()
            && oracle_comments[end]["created"].as_i64() == Some(created)
        {
            end += 1;
        }
        let mut group = oracle_comments[start..end].to_vec();
        if group.len() > 1 {
            tied_groups += 1;
            group.sort_by_key(|row| {
                let source_id = row["id"].as_str().unwrap();
                tied_source_ids.insert(source_id.to_owned());
                let (physical_id, bound_created) = bindings
                    .get(source_id)
                    .unwrap_or_else(|| panic!("physical id for tied comment {source_id}"));
                assert_eq!(*bound_created, created);
                physical_id.clone()
            });
        }
        normalized_oracle.extend(group);
        start = end;
    }
    assert_eq!(
        tied_groups, 1,
        "only the equal-createdAt group is normalized"
    );
    assert_eq!(
        tied_source_ids,
        bindings.keys().cloned().collect(),
        "physical-id bindings are limited to tied createdAt rows",
    );
    assert_eq!(
        normalized_oracle.as_slice(),
        expected_comments.as_slice(),
        "ascending physical _id normalization applies within tied createdAt groups only",
    );
    let detail_continuation = &detail_tie["declaredGraph"]["expected"]["continuation"][0];
    assert_eq!(detail_continuation["hasMore"], true);
    assert_eq!(detail_continuation["cursorPresent"], true);
    assert_eq!(
        detail_continuation["nextPageResultBytes"],
        detail_tie["oracle"]["resumedRowsBytes"],
    );
    assert!(
        serde_json::from_str::<Value>(detail_continuation["nextPageResultBytes"].as_str().unwrap())
            .unwrap()
            .as_array()
            .is_some_and(|rows| !rows.is_empty()),
        "detail continuation compares a real non-empty resumed page",
    );
    let cost_bound = oracle_cases
        .iter()
        .find(|case| case["id"] == "issueDetail-comments-cost-bound-refusal")
        .expect("detail null-cursor empty cost-bound case");
    assert_eq!(
        cost_bound["declaredGraph"]["expected"]["graphCompleteness"],
        "refused"
    );
    let refusal = &cost_bound["declaredGraph"]["expected"];
    assert_eq!(refusal["resultBytes"], Value::Null);
    assert_eq!(refusal["orderedRootIds"], json!([]));
    assert_eq!(refusal["resultLength"], 0);
    assert_eq!(
        refusal["refusalReason"],
        "SNAPBACK_QUERY_COST_BOUND_EXCEEDED"
    );
    let miss = oracle_cases
        .iter()
        .find(|case| case["id"] == "issueDetail-authoritative-miss")
        .expect("detail authoritative miss case");
    assert_eq!(miss["declaredGraph"]["expected"]["resultBytes"], "[]");
    assert_eq!(
        miss["declaredGraph"]["expected"]["continuation"][0]["hasMore"],
        false
    );
    let page = oracle_cases
        .iter()
        .find(|case| case["id"] == "issueListV2-forward-page-and-resume")
        .expect("one continuation case");
    let continuation = &page["declaredGraph"]["expected"]["continuation"][0];
    assert_eq!(continuation["hasMore"], true);
    assert_eq!(continuation["cursorPresent"], true);
    let next_rows: Value = serde_json::from_str(
        continuation["nextPageResultBytes"]
            .as_str()
            .expect("next page mapped bytes"),
    )
    .expect("next page mapped rows parse");
    assert!(next_rows.as_array().is_some_and(|rows| !rows.is_empty()));
}

/// Every oracle status/reason key carries explicit cursor/row discriminators,
/// envelope exclusions are reasoned, and each full-shape refusal is frozen in
/// the admission register with the code executed by the freeze script.
#[test]
fn oracle_field_maps_and_refusals_are_closed() {
    let corpus = graph_corpus();
    let mut translation_count = 0usize;
    for query in corpus_queries(&corpus) {
        let map = &query["fieldMap"];
        assert_eq!(map["query"], query["query"]);
        assert_eq!(map["rows"]["comparison"], "exact-declared-rows");
        assert_eq!(
            map["rows"]["graphProjectionPaths"]
                .as_array()
                .expect("graph projection paths")
                .len(),
            map["rows"]["oracleFields"]
                .as_array()
                .expect("oracle row fields")
                .len(),
            "{} row map is one-to-one",
            query["query"],
        );
        assert!(map["order"]["graphNodeId"].as_str().is_some());
        assert!(
            map["continuation"]
                .as_array()
                .is_some_and(|rows| !rows.is_empty())
        );
        let excluded = map["excluded"].as_array().expect("excluded fields");
        let excluded_fields = excluded
            .iter()
            .map(|entry| {
                assert!(
                    entry["reason"]
                        .as_str()
                        .is_some_and(|reason| !reason.is_empty())
                );
                entry["oracleField"]
                    .as_str()
                    .expect("excluded oracle field")
            })
            .collect::<BTreeSet<_>>();
        assert_eq!(excluded_fields.len(), excluded.len());
        let translation_sets = std::iter::once(&map["outerStatusReason"]["translations"]).chain(
            map["nodeCompleteness"]
                .as_array()
                .expect("node label maps")
                .iter()
                .map(|entry| &entry["translations"]),
        );
        for translations in translation_sets {
            translation_count += translations.as_array().expect("translations").len();
            let mut keys = BTreeSet::new();
            for translation in translations.as_array().expect("translations") {
                let cursor = translation["when"]["cursor"].as_str().expect("when.cursor");
                let rows = translation["when"]["rows"].as_str().expect("when.rows");
                assert!(["non-null", "null", "any"].contains(&cursor));
                assert!(["non-empty", "empty", "any"].contains(&rows));
                let key = snapback_types::rqs_contract::jcs(translation)
                    .expect("translation canonicalizes");
                assert!(
                    keys.insert(key),
                    "duplicate translation in {}",
                    query["query"]
                );
                let has_graph = translation["graphLabel"].as_str().is_some();
                let has_exclusion = translation["excludedReason"].as_str().is_some();
                assert_ne!(
                    has_graph, has_exclusion,
                    "translation is dispositioned once"
                );
            }
        }
        if query["query"] == "issueDetail" {
            let comments = map["nodeCompleteness"]
                .as_array()
                .unwrap()
                .iter()
                .find(|entry| entry["oracleStatusField"] == "value.commentsCompleteness")
                .expect("comments label map");
            let keys = comments["translations"]
                .as_array()
                .unwrap()
                .iter()
                .map(|entry| {
                    (
                        entry["oracleStatus"].as_str().unwrap(),
                        entry["when"]["cursor"].as_str().unwrap(),
                        entry["when"]["rows"].as_str().unwrap(),
                        entry["graphLabel"].as_str().unwrap(),
                    )
                })
                .collect::<BTreeSet<_>>();
            assert_eq!(
                keys,
                BTreeSet::from([
                    ("complete", "any", "any", "complete"),
                    ("incomplete", "non-null", "non-empty", "window"),
                    ("incomplete", "null", "empty", "refused"),
                ]),
            );
        }
    }

    let coverage = corpus["oracleTranslationCoverage"]
        .as_array()
        .expect("translation coverage rows");
    assert_eq!(coverage.len(), translation_count);
    let mut coverage_keys = BTreeSet::new();
    for row in coverage {
        assert!(row["query"].as_str().is_some());
        assert!(row["surface"].as_str().is_some());
        assert!(row["translationIndex"].as_u64().is_some());
        let exercised = row["exercisedBy"].as_array().expect("exercisedBy");
        let unexercised = row["unexercised"].as_str();
        assert_ne!(
            !exercised.is_empty(),
            unexercised.is_some(),
            "every translation is either exercised or explicitly marked unexercised",
        );
        let key = format!(
            "{}:{}:{}",
            row["query"].as_str().unwrap(),
            row["surface"].as_str().unwrap(),
            row["translationIndex"].as_u64().unwrap(),
        );
        assert!(
            coverage_keys.insert(key),
            "translation coverage key is unique"
        );
    }

    let expected = BTreeMap::from([
        ("issueListV2", "SNAPBACK_GRAPH_SEARCH_UNADMITTED"),
        ("issueDetail", "SNAPBACK_GRAPH_NODE_KIND_UNSUPPORTED"),
        ("listIssueByID", "SNAPBACK_GRAPH_NODE_KIND_UNSUPPORTED"),
    ]);
    let refusals = corpus["cases"]
        .as_array()
        .expect("cases")
        .iter()
        .filter(|case| case["caseKind"] == "refusal")
        .collect::<Vec<_>>();
    assert_eq!(refusals.len(), 4);
    for case in refusals {
        let query = case["query"].as_str().expect("refusal query");
        if case["trigger"]["phase"] == "admission" {
            assert_eq!(case["expect"]["reason"], expected[query]);
            assert!(case["expect"]["resultBytes"].is_null());
        } else {
            assert_eq!(case["trigger"]["phase"], "evaluation");
            assert_eq!(case["trigger"]["presence"], "required");
            assert_eq!(
                case["expect"]["refusalReason"],
                "SNAPBACK_GRAPH_REQUIRED_EDGE_MISSING"
            );
            assert_eq!(case["expect"]["label"], "refused");
            assert!(case["expect"]["resultBytes"].is_null());
        }
    }
}

/// Seven corpus-local present/absent fixture pairs differ only by named,
/// wholly hidden slices and exact-match every oracle/result/proof observation.
#[test]
fn paired_worlds() {
    let corpus = graph_corpus();
    let fixtures = paired_world_fixtures();
    let mut fixtures_without_digest = fixtures.clone();
    fixtures_without_digest
        .as_object_mut()
        .unwrap()
        .remove("contentDigest");
    assert_eq!(
        fixtures["contentDigest"].as_str(),
        Some(jcs_domain_hash("", &fixtures_without_digest).as_str()),
    );
    let cases = corpus["cases"]
        .as_array()
        .expect("cases")
        .iter()
        .filter(|case| case["caseKind"] == "pairedWorld")
        .collect::<Vec<_>>();
    assert_eq!(cases.len(), 7, "seven exact hidden-row graph-channel pairs");
    let fixture_pairs = fixtures["pairs"].as_array().expect("fixture pairs");
    assert_eq!(fixture_pairs.len(), 7);
    let mut covered_classes = BTreeSet::new();
    let mut covered_queries = BTreeSet::new();
    let mut broadcast_hidden_axes = BTreeSet::new();
    for case in cases {
        assert_eq!(
            case["oracleEvidence"]["presentDigest"], case["oracleEvidence"]["absentDigest"],
            "{} hidden slice must exact-match through the oracle",
            case["id"],
        );
        let carrier: GraphQueryCarrierV1 =
            serde_json::from_value(case["plan"].clone()).expect("paired plan");
        let call = &case["invocation"];
        let query = case["query"].as_str().expect("paired query");
        covered_queries.insert(query);
        if query == "publicRooms" {
            validate_broadcast_invocation(&carrier, call, query);
            broadcast_hidden_axes.extend(
                case["hiddenAxes"]
                    .as_array()
                    .expect("class-1 hidden axes")
                    .iter()
                    .map(|axis| axis.as_str().unwrap()),
            );
            for field in [
                "resultBytes",
                "orderedRootIds",
                "resultLength",
                "existence",
                "completeness",
            ] {
                assert_eq!(
                    case["oracleEvidence"]["present"][field],
                    case["oracleEvidence"]["absent"][field],
                    "{} strict {field} ignores hidden slices",
                    case["id"],
                );
            }
        } else {
            validate_corpus_invocation_with_disposition(
                &carrier,
                call,
                query,
                Some(&case["windowVectorDisposition"]),
            );
        }
        if case["windowVectorDisposition"]["status"] == "BLOCKED" {
            let child = call["windows"]
                .as_array()
                .unwrap()
                .iter()
                .find(|window| window["nodeId"] != carrier.normalized_plan.nodes[0].node_id())
                .expect("hidden-root detail pair carries its child demand entry");
            assert_eq!(child["intervals"], json!([]));
        }
        assert_eq!(case["expect"]["label"], "complete");
        assert_eq!(
            case["expect"]["resultLength"].as_u64().unwrap() as usize,
            case["expect"]["orderedRootIds"].as_array().unwrap().len(),
        );

        let pair = fixture_pairs
            .iter()
            .find(|pair| pair["id"] == case["fixturePairId"])
            .expect("case links one frozen fixture pair");
        assert_eq!(pair["query"], case["query"]);
        assert_eq!(pair["coveredNodeIds"], case["coveredNodeIds"]);
        assert_eq!(
            pair["coveredAuthorityClasses"],
            case["coveredAuthorityClasses"]
        );
        let slices = std::iter::once(&pair["namedSlice"])
            .chain(pair["dependentSlices"].as_array().into_iter().flatten())
            .collect::<Vec<_>>();
        let slice_tables = slices
            .iter()
            .map(|slice| slice["table"].as_str().unwrap())
            .collect::<BTreeSet<_>>();
        let present = &pair["present"];
        let absent = &pair["absent"];
        assert_ne!(present["identity"], "normal-seed-v1");
        assert_ne!(absent["identity"], "normal-seed-v1");
        assert_ne!(present["identity"], absent["identity"]);
        assert_eq!(case["worlds"]["present"]["fixture"], present["identity"]);
        assert_eq!(case["worlds"]["absent"]["fixture"], absent["identity"]);
        assert_eq!(
            case["worlds"]["present"]["fixtureDigest"],
            present["fixtureDigest"]
        );
        assert_eq!(
            case["worlds"]["absent"]["fixtureDigest"],
            absent["fixtureDigest"]
        );
        assert_eq!(present["inputDigest"], absent["inputDigest"]);
        for (table, present_digest) in present["tableDigests"].as_object().unwrap() {
            if !slice_tables.contains(table.as_str()) {
                assert_eq!(
                    present_digest, &absent["tableDigests"][table],
                    "{} non-slice table {table} is byte-identical",
                    case["id"],
                );
            }
        }
        for world in [present, absent] {
            let fixture_preimage = json!({
                "tableDigests": world["tableDigests"],
                "inputDigest": world["inputDigest"],
            });
            assert_eq!(
                world["fixtureDigest"].as_str(),
                Some(jcs_domain_hash("", &fixture_preimage).as_str()),
            );
            let identity_preimage = json!({
                "identity": world["identity"],
                "fixtureDigest": world["fixtureDigest"],
            });
            assert_eq!(
                world["identityDigest"].as_str(),
                Some(jcs_domain_hash("", &identity_preimage).as_str()),
            );
        }
        for slice in slices {
            let table = slice["table"].as_str().unwrap();
            let slice_ids = slice["rowIds"]
                .as_array()
                .unwrap()
                .iter()
                .map(|id| id.as_str().unwrap())
                .collect::<BTreeSet<_>>();
            let present_rows_value = present["sliceTableRowsByTable"]
                .get(table)
                .unwrap_or(&present["sliceTableRows"]);
            let absent_rows_value = absent["sliceTableRowsByTable"]
                .get(table)
                .unwrap_or(&absent["sliceTableRows"]);
            let present_rows = present_rows_value
                .as_array()
                .unwrap()
                .iter()
                .map(|row| (row["_id"].as_str().unwrap(), row))
                .collect::<BTreeMap<_, _>>();
            let absent_rows = absent_rows_value
                .as_array()
                .unwrap()
                .iter()
                .map(|row| (row["_id"].as_str().unwrap(), row))
                .collect::<BTreeMap<_, _>>();
            let changed = present_rows
                .keys()
                .chain(absent_rows.keys())
                .copied()
                .collect::<BTreeSet<_>>()
                .into_iter()
                .filter(|id| present_rows.get(id) != absent_rows.get(id))
                .collect::<BTreeSet<_>>();
            assert_eq!(changed, slice_ids, "only the named/dependent slice differs");
        }

        let node_classes = carrier
            .normalized_plan
            .nodes
            .iter()
            .filter(|node| {
                case["coveredNodeIds"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|id| id.as_str() == Some(node.node_id()))
            })
            .map(|node| node.authority().declared_class.0)
            .collect::<BTreeSet<_>>();
        let recorded_classes = case["coveredAuthorityClasses"]
            .as_array()
            .unwrap()
            .iter()
            .map(|class| class.as_u64().unwrap() as u8)
            .collect::<BTreeSet<_>>();
        assert_eq!(node_classes, recorded_classes);
        covered_classes.extend(recorded_classes);
    }
    assert_eq!(
        covered_queries,
        BTreeSet::from(["issueDetail", "issueListV2", "listIssueByID", "publicRooms"])
    );
    assert_eq!(
        broadcast_hidden_axes,
        BTreeSet::from(["partition", "policy", "principal"]),
        "class-1 pairs vary every principal-, partition-, and policy-hidden axis",
    );
    let declared_classes = corpus_queries(&corpus)
        .chain(
            corpus["broadcastFixture"]["queries"]
                .as_array()
                .unwrap()
                .iter()
                .map(|query| &query["carrier"]),
        )
        .flat_map(|query| {
            let carrier: GraphQueryCarrierV1 =
                serde_json::from_value(query.get("carrier").unwrap_or(query).clone()).unwrap();
            carrier
                .normalized_plan
                .nodes
                .into_iter()
                .map(|node| node.authority().declared_class.0)
        })
        .collect::<BTreeSet<_>>();
    assert_eq!(
        covered_classes, declared_classes,
        "hidden pairs cover every declared authority class across the three graphs",
    );
}

/// Class-2 activation is not a paired-world relation. The oracle executes the
/// allowed and denied principals separately; Rust reconstructs both identity
/// tuples and exact-checks the frozen allowed result plus authoritative miss.
#[test]
fn allow_deny_cases_are_oracle_frozen_and_structurally_executable() {
    let corpus = graph_corpus();
    let cases = corpus["cases"]
        .as_array()
        .expect("cases")
        .iter()
        .filter(|case| case["caseKind"] == "allowDeny")
        .collect::<Vec<_>>();
    assert_eq!(cases.len(), 1);
    let case = cases[0];
    assert_exact_object_keys(
        case,
        &[
            "caseKind",
            "id",
            "query",
            "plan",
            "invocations",
            "principals",
            "coveredNodeIds",
            "oracleEvidence",
            "expect",
        ],
        "executable allowDeny case",
    );
    assert_eq!(case["query"], "listIssueByID");
    assert_eq!(case["principals"]["allowed"], "principal_crew");
    assert_eq!(case["principals"]["denied"], "principal_ordinary");
    let carrier: GraphQueryCarrierV1 =
        serde_json::from_value(case["plan"].clone()).expect("allowDeny carrier");
    let allowed = &case["invocations"]["allowed"];
    let denied = &case["invocations"]["denied"];
    validate_corpus_invocation(&carrier, allowed, "listIssueByID");
    validate_corpus_invocation(&carrier, denied, "listIssueByID");
    assert_eq!(allowed["args"], denied["args"]);
    assert_eq!(allowed["windows"], denied["windows"]);
    assert_eq!(allowed["materialization"], denied["materialization"]);
    assert_eq!(
        allowed["authorizationVersion"],
        denied["authorizationVersion"]
    );
    assert_eq!(allowed["evaluationCut"], denied["evaluationCut"]);
    assert_ne!(allowed["partition"], denied["partition"]);

    let evidence = &case["oracleEvidence"];
    for (bytes_field, digest_field) in [
        ("allowedResultBytes", "allowedDigest"),
        ("allowedMappedResultBytes", "allowedMappedDigest"),
        ("deniedResultBytes", "deniedDigest"),
    ] {
        let bytes = evidence[bytes_field].as_str().expect("frozen oracle bytes");
        assert_eq!(
            evidence[digest_field].as_str(),
            Some(byte_hash(bytes).as_str()),
        );
    }
    let allowed_oracle: Value =
        serde_json::from_str(evidence["allowedResultBytes"].as_str().unwrap()).unwrap();
    assert_eq!(allowed_oracle[0]["status"], "complete");
    assert_eq!(allowed_oracle[0]["items"].as_array().unwrap().len(), 1);
    let denied_oracle: Value =
        serde_json::from_str(evidence["deniedResultBytes"].as_str().unwrap()).unwrap();
    assert_eq!(denied_oracle[0]["status"], "not-found-authoritative");
    assert_eq!(
        denied_oracle[0]["reason"],
        "missing-or-outside-list-context"
    );
    assert_eq!(denied_oracle[0]["items"], json!([]));
    assert_eq!(
        evidence["deniedDisposition"],
        json!({
            "status":"not-found-authoritative",
            "reason":"missing-or-outside-list-context"
        }),
    );
    assert_eq!(
        evidence["allowedMappedResultBytes"],
        case["expect"]["allowed"]["resultBytes"],
    );
    assert_eq!(case["expect"]["allowed"]["kind"], "result");
    assert_eq!(case["expect"]["allowed"]["label"], "complete");
    assert_eq!(case["expect"]["allowed"]["resultLength"], 1);
    assert_eq!(case["expect"]["denied"], "deny");
    assert!(case["expect"]["deniedResultBytes"].is_null());
}

fn assert_evaluator_matches_frozen_result(
    case_id: &str,
    actual: &snapback_engine::graph_evaluator::GraphEvaluationOutputV1,
    expected: &Value,
    exact_proofs: bool,
) {
    let actual = serde_json::to_value(actual).expect("serialize evaluator output");
    let mut expected = expected.clone();
    assert_legal_node_proof_classes(&actual["nodeCompleteness"], case_id);
    assert_legal_node_proof_classes(&expected["nodeCompleteness"], case_id);
    fn normalize_snapshot_tuple(value: &mut Value) {
        match value {
            Value::Object(object) => {
                if object.contains_key("materializationHash")
                    && object.contains_key("partitionHash")
                {
                    object.insert(
                        "authorizationVersion".to_owned(),
                        Value::String("snapshot-bound".to_owned()),
                    );
                    object.insert(
                        "evaluationCut".to_owned(),
                        Value::String("snapshot-bound".to_owned()),
                    );
                }
                if object.contains_key("proofHash") {
                    object.insert(
                        "proofHash".to_owned(),
                        Value::String("snapshot-bound-proof-hash".to_owned()),
                    );
                }
                for child in object.values_mut() {
                    normalize_snapshot_tuple(child);
                }
            }
            Value::Array(values) => {
                for child in values {
                    normalize_snapshot_tuple(child);
                }
            }
            _ => {}
        }
    }
    for field in [
        "kind",
        "label",
        "resultBytes",
        "orderedRootIds",
        "resultLength",
        "refusalReason",
    ] {
        assert_eq!(actual[field], expected[field], "{case_id} field {field}");
    }
    if exact_proofs {
        let mut actual_proofs = actual.clone();
        normalize_snapshot_tuple(&mut actual_proofs);
        normalize_snapshot_tuple(&mut expected);
        assert_eq!(
            actual_proofs["nodeCompleteness"], expected["nodeCompleteness"],
            "{case_id} node proofs"
        );
        assert_eq!(
            actual_proofs["graphCompleteness"], expected["graphCompleteness"],
            "{case_id} graph proof"
        );
    }
    assert_eq!(
        actual["structuralWork"], expected["structuralWork"],
        "{case_id} structural work"
    );
    assert_eq!(
        actual["windowLedgers"], expected["windowLedgers"],
        "{case_id} window ledgers"
    );
}

fn legal_node_proof_class(kind: &str, label: &str) -> Option<&'static str> {
    match (kind, label) {
        ("closed-projection", _) => Some("projection-composition"),
        (_, "refused") => Some("refusal"),
        (_, "unknown") => Some("none"),
        ("root-window" | "bounded-to-many", "prefix") => Some("ordered-prefix"),
        ("root-window", "window") => Some("named-window"),
        ("root-window", "complete") => Some("whole-source"),
        ("equality-to-one", "complete") => Some("unique-point"),
        ("bounded-to-many", "complete" | "window") => Some("parent-ranges"),
        ("exists-semi-join", "complete") => Some("complete-membership"),
        ("principal-bound", "complete") => Some("principal-point"),
        ("search-membership", "complete") => Some("provider-certificate"),
        _ => None,
    }
}

fn assert_legal_node_proof_classes(nodes: &Value, context: &str) {
    let Some(nodes) = nodes.as_array() else {
        return;
    };
    for node in nodes {
        let kind = node["nodeKind"].as_str().expect("node proof kind");
        let label = node["label"].as_str().expect("node proof label");
        assert_eq!(node["proof"]["kind"], kind, "{context} {kind} proof kind");
        assert_eq!(
            node["proof"]["label"], label,
            "{context} {kind} proof label"
        );
        assert_eq!(
            node["proofClass"].as_str(),
            legal_node_proof_class(kind, label),
            "{context} proofClass is legal for ({kind}, {label})",
        );
    }
}

fn executable_case<'a>(corpus: &'a Value, id: &str) -> &'a Value {
    corpus["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|case| case["id"] == id)
        .unwrap_or_else(|| panic!("missing executable corpus case {id}"))
}

fn evaluator_edge_case<'a>(corpus: &'a Value, id: &str) -> &'a Value {
    corpus["evaluatorEdgeCases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|case| case["id"] == id)
        .unwrap_or_else(|| panic!("missing evaluator edge corpus case {id}"))
}

fn request_for_case(
    corpus: &Value,
    case: &Value,
) -> (GraphQueryCarrierV1, GraphEvaluationRequestV1) {
    let carrier: GraphQueryCarrierV1 = serde_json::from_value(case["plan"].clone()).unwrap();
    let call = &case["invocation"];
    let (materialization, partition) =
        validate_corpus_invocation(&carrier, call, case["query"].as_str().unwrap());
    let request = evaluation_request(corpus, call, &materialization, &partition);
    (carrier, request)
}

/// @ref LLP 0209#4-completeness-vocabulary — a named interval that is
/// take-truncated is an ordered prefix, never a terminal named window.
#[test]
fn bounded_root_lookahead_is_prefix_and_window_page_overflow_refuses() {
    let corpus = graph_corpus();
    let case = executable_case(&corpus, "g0-pair-list-hidden-internal-root");
    let (carrier, mut request) = request_for_case(&corpus, case);
    let project = request.args["projectID"].clone();
    let seed_tables = corpus_seed_tables(&corpus);
    let mut candidates = seed_tables["issueListRead"]
        .iter()
        .filter(|row| row["projectID"] == project)
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| {
        right["modified"]
            .as_i64()
            .cmp(&left["modified"].as_i64())
            .then_with(|| {
                right["sourceIssueID"]
                    .as_str()
                    .cmp(&left["sourceIssueID"].as_str())
            })
            .then_with(|| left["_id"].as_str().cmp(&right["_id"].as_str()))
    });
    let end = |row: &Map<String, Value>| {
        serde_json::from_value(json!({
            "kind":"inclusive",
            "key":{
                "entries":[["modified",row["modified"]],["sourceIssueID",row["sourceIssueID"]]],
                "id":row["_id"],
            }
        }))
        .unwrap()
    };
    let root_window = &mut request.windows[0].intervals[0].window;
    root_window.lower = end(candidates.first().unwrap());
    root_window.upper = end(candidates.last().unwrap());
    root_window.take = 1;
    let output = graph_store(&corpus, None)
        .evaluate_graph_query(&carrier.normalized_plan, &request)
        .expect("bounded root demand evaluates");
    let output = serde_json::to_value(output).unwrap();
    let bounded_case = evaluator_edge_case(&corpus, "g2-bounded-root-named-truncation");
    assert_eq!(
        output["nodeCompleteness"][0]["label"],
        bounded_case["expect"]["label"]
    );
    assert_eq!(output["nodeCompleteness"][0]["proof"]["hasMore"], true);
    assert_eq!(output["graphCompleteness"]["label"], "prefix");
    assert_eq!(
        output["structuralWork"],
        bounded_case["expect"]["structuralWork"]
    );
    assert_eq!(
        output["windowLedgers"],
        bounded_case["expect"]["windowLedgers"]
    );

    let (_, mut overflow) = request_for_case(&corpus, case);
    overflow.prior_window_ledgers = vec![
        serde_json::from_value(json!({
            "nodeId":"n0","pages":1,"rootRows":0,"scannedRows":0,
            "resultRows":0,"resultBytes":0,"indexRanges":0
        }))
        .unwrap(),
    ];
    let refused = graph_store(&corpus, None)
        .evaluate_graph_query(&carrier.normalized_plan, &overflow)
        .expect("window-page overflow materializes");
    let refused = serde_json::to_value(refused).unwrap();
    let overflow_case = evaluator_edge_case(&corpus, "g2-window-page-overflow-refusal");
    assert_eq!(
        refused["refusalReason"],
        "SNAPBACK_QUERY_COST_BOUND_EXCEEDED"
    );
    assert_eq!(
        refused["windowLedgers"],
        json!([{
            "nodeId":"n0","pages":1,"rootRows":0,"scannedRows":0,
            "resultRows":0,"resultBytes":0,"indexRanges":0
        }])
    );
    assert_eq!(
        refused["structuralWork"],
        overflow_case["expect"]["structuralWork"]
    );
    assert_eq!(
        refused["windowLedgers"],
        overflow_case["expect"]["windowLedgers"]
    );
    assert_eq!(
        refused["nodeCompleteness"].as_array().unwrap().len(),
        carrier.normalized_plan.nodes.len(),
        "evaluation-time refusal includes the projection node"
    );
}

/// @ref LLP 0209#41-per-node-production-rules — each parent range retains
/// its own interval and lookahead fact; a mixed exhausted/truncated set of
/// named ranges composes to the node's window arm.
#[test]
fn mixed_parent_named_child_ranges_keep_per_parent_has_more() {
    let corpus = graph_corpus();
    let case = executable_case(&corpus, "g0-pair-list-hidden-internal-root");
    let (carrier, mut request) = request_for_case(&corpus, case);
    let mut plan_value = serde_json::to_value(&carrier.normalized_plan).unwrap();
    plan_value["nodes"][2]["page"] = json!({"kind":"demand"});
    Map::from_iter([
        ("maxWindowPages".to_owned(), json!(1)),
        ("maxWindowRootRows".to_owned(), json!(0)),
        ("maxWindowScannedRows".to_owned(), json!(33792)),
        ("maxWindowResultRows".to_owned(), json!(1024)),
        ("maxWindowResultBytes".to_owned(), json!(33554432)),
        ("maxWindowIndexRanges".to_owned(), json!(17408)),
    ])
    .into_iter()
    .for_each(|(key, value)| {
        plan_value["queryCost"]["graph"]["nodes"][2][key] = value;
    });
    plan_value["queryCost"]["graph"]["windowRollup"] = json!({
        "maxWindowPages":2,"maxWindowRootRows":1024,"maxWindowScannedRows":88065,
        "maxWindowResultRows":2048,"maxWindowResultBytes":67108864,
        "maxWindowIndexRanges":54273
    });
    let plan: GraphQueryPlanV1 = serde_json::from_value(plan_value.clone()).unwrap();
    assert!(
        graph_query_plan_faults_v1(&plan).is_empty(),
        "demand-paged mutation remains a fully bounded admitted plan: {:?}",
        graph_query_plan_faults_v1(&plan)
    );

    let tables = corpus_seed_tables(&corpus);
    let project = request.args["projectID"].clone();
    let mut roots = tables["issueListRead"]
        .iter()
        .filter(|row| row["projectID"] == project)
        .collect::<Vec<_>>();
    roots.sort_by(|left, right| {
        right["modified"]
            .as_i64()
            .cmp(&left["modified"].as_i64())
            .then_with(|| {
                right["sourceIssueID"]
                    .as_str()
                    .cmp(&left["sourceIssueID"].as_str())
            })
            .then_with(|| left["_id"].as_str().cmp(&right["_id"].as_str()))
    });
    let selected = [&roots[7], &roots[8]];
    let root_end = |row: &Map<String, Value>| {
        json!({
            "kind":"inclusive","key":{
                "entries":[["modified",row["modified"]],["sourceIssueID",row["sourceIssueID"]]],
                "id":row["_id"]
            }
        })
    };
    request.windows[0].intervals[0].window.lower =
        serde_json::from_value(root_end(selected[0])).unwrap();
    request.windows[0].intervals[0].window.upper =
        serde_json::from_value(root_end(selected[1])).unwrap();
    request.windows[0].intervals[0].window.take = 2;

    let intervals = selected
        .iter()
        .map(|root| {
            let mut labels = tables["issueLabelRead"]
                .iter()
                .filter(|row| row["issueID"] == root["issueID"])
                .collect::<Vec<_>>();
            labels.sort_by(|left, right| {
                left["labelID"]
                    .as_str()
                    .cmp(&right["labelID"].as_str())
                    .then_with(|| left["_id"].as_str().cmp(&right["_id"].as_str()))
            });
            assert!(!labels.is_empty());
            let child_end = |row: &Map<String, Value>| {
                json!({
                    "kind":"inclusive","key":{
                        "entries":[["labelID",row["labelID"]]],"id":row["_id"]
                    }
                })
            };
            json!({
                "parentKey":{"table":"issueListRead","id":root["_id"]},
                "window":{
                    "order":plan_value["nodes"][2]["order"],"direction":"forward",
                    "lower":child_end(labels.first().unwrap()),
                    "upper":child_end(labels.last().unwrap()),"take":1
                }
            })
        })
        .collect::<Vec<_>>();
    request
        .windows
        .push(serde_json::from_value(json!({"nodeId":"n2","intervals":intervals})).unwrap());
    request.advanced_node_id = "n2".to_owned();
    let output = graph_store(&corpus, None)
        .evaluate_graph_query(&plan, &request)
        .expect("mixed named child ranges evaluate");
    let output = serde_json::to_value(output).unwrap();
    let mixed_case = evaluator_edge_case(&corpus, "g2-mixed-parent-named-child-ranges");
    let proof = &output["nodeCompleteness"][2]["proof"];
    assert_eq!(output["nodeCompleteness"][2]["label"], "window");
    let ranges = proof["ranges"].as_array().unwrap();
    assert_eq!(ranges.len(), 2);
    assert_eq!(
        ranges
            .iter()
            .map(|range| range["hasMore"].as_bool().unwrap())
            .collect::<BTreeSet<_>>(),
        BTreeSet::from([false, true])
    );
    assert!(ranges.iter().all(|range| range["interval"].is_object()));
    assert_eq!(
        output["structuralWork"],
        mixed_case["expect"]["structuralWork"]
    );
    assert_eq!(
        output["windowLedgers"],
        mixed_case["expect"]["windowLedgers"]
    );
}

fn ledger_for<'a>(ledgers: &'a [GraphWindowLedgerV1], node_id: &str) -> &'a GraphWindowLedgerV1 {
    ledgers
        .iter()
        .find(|ledger| ledger.node_id == node_id)
        .unwrap_or_else(|| panic!("missing ledger for {node_id}"))
}

fn double_window_budget(plan: &mut Value, node_id: &str) {
    let cost = plan["queryCost"]["graph"]["nodes"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|cost| cost["nodeId"] == node_id)
        .unwrap_or_else(|| panic!("missing cost for {node_id}"));
    for field in [
        "maxWindowPages",
        "maxWindowRootRows",
        "maxWindowScannedRows",
        "maxWindowResultRows",
        "maxWindowResultBytes",
        "maxWindowIndexRanges",
    ] {
        let value = cost[field]
            .as_u64()
            .unwrap_or_else(|| panic!("missing {field} for {node_id}"));
        cost[field] = json!(value.checked_mul(2).expect("test window budget doubles"));
    }
}

fn assert_first_page_charged(
    output: &snapback_engine::graph_evaluator::GraphEvaluationOutputV1,
    expected_node_ids: &Value,
) {
    let expected_node_ids = expected_node_ids
        .as_array()
        .unwrap()
        .iter()
        .map(|node_id| node_id.as_str().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(
        output
            .window_ledgers
            .iter()
            .map(|ledger| ledger.node_id.as_str())
            .collect::<Vec<_>>(),
        expected_node_ids,
    );
    let result_bytes = output.result_bytes.as_ref().unwrap().len() as u64;
    for ledger in &output.window_ledgers {
        assert_eq!(ledger.pages, 1, "{} charges its first page", ledger.node_id);
        assert_eq!(ledger.result_rows, output.result_length);
        assert_eq!(ledger.result_bytes, result_bytes);
    }
}

fn changed_lineages<'a>(
    before: &'a [GraphWindowLedgerV1],
    after: &'a [GraphWindowLedgerV1],
) -> Vec<&'a str> {
    after
        .iter()
        .filter(|ledger| ledger_for(before, &ledger.node_id) != *ledger)
        .map(|ledger| ledger.node_id.as_str())
        .collect()
}

/// @ref LLP 0209#24-plan-instance-and-contextual-materialization-identity —
/// a first-page request charges every evaluated demand-node lineage; a
/// continuation advances exactly one and carries every sibling byte-for-byte.
#[test]
fn child_and_sibling_continuations_advance_only_the_bound_lineage() {
    let corpus = graph_corpus();
    let case = executable_case(&corpus, "g0-pair-detail-notification-principal");
    let child_edge = evaluator_edge_case(&corpus, "g2-child-only-ledger-continuation");
    let (carrier, mut child_request) = request_for_case(&corpus, case);
    let mut child_plan_value = serde_json::to_value(&carrier.normalized_plan).unwrap();
    double_window_budget(&mut child_plan_value, "n2");
    let child_plan: GraphQueryPlanV1 = serde_json::from_value(child_plan_value).unwrap();
    child_request.advanced_node_id = "n2".to_owned();
    let first_child_output = graph_store(&corpus, None)
        .evaluate_graph_query(&child_plan, &child_request)
        .expect("first page charges every evaluated demand lineage");
    assert_first_page_charged(
        &first_child_output,
        &child_edge["expect"]["firstPageChargedNodeIds"],
    );
    assert_eq!(
        serde_json::to_value(&first_child_output.window_ledgers).unwrap(),
        case["expect"]["windowLedgers"],
        "first-page lineages charge their induced subtrees and whole result",
    );
    child_request.prior_window_ledgers = first_child_output.window_ledgers;
    let before = child_request.prior_window_ledgers.clone();
    let child_output = graph_store(&corpus, None)
        .evaluate_graph_query(&child_plan, &child_request)
        .expect("child-only continuation evaluates past an untouched root sibling");
    assert_eq!(
        changed_lineages(&before, &child_output.window_ledgers),
        child_edge["expect"]["changedNodeIds"]
            .as_array()
            .unwrap()
            .iter()
            .map(|node_id| node_id.as_str().unwrap())
            .collect::<Vec<_>>(),
        "child continuation changes exactly its bound lineage",
    );
    assert_eq!(
        ledger_for(&child_output.window_ledgers, "n2").pages - ledger_for(&before, "n2").pages,
        child_edge["expect"]["advancedPagesDelta"].as_u64().unwrap(),
    );

    let (carrier, mut sibling_request) = request_for_case(&corpus, case);
    let sibling_edge = evaluator_edge_case(&corpus, "g2-sibling-only-ledger-continuation");
    let mut plan_value = serde_json::to_value(&carrier.normalized_plan).unwrap();
    plan_value["nodes"][4]["page"] = json!({"kind":"demand"});
    for (field, value) in [
        ("maxWindowPages", 2_u64),
        ("maxWindowRootRows", 0),
        ("maxWindowScannedRows", 128),
        ("maxWindowResultRows", 2),
        ("maxWindowResultBytes", 16_777_216),
        ("maxWindowIndexRanges", 128),
    ] {
        plan_value["queryCost"]["graph"]["nodes"][4][field] = json!(value);
    }
    let sibling_plan: GraphQueryPlanV1 = serde_json::from_value(plan_value).unwrap();
    let parent_key = sibling_request.windows[1].intervals[0]
        .parent_key
        .clone()
        .expect("detail child parent");
    let sibling_order = match &sibling_plan.nodes[4] {
        GraphNodeV1::BoundedToMany { order, .. } => order.clone(),
        _ => panic!("n4 is the sibling bounded range"),
    };
    sibling_request.windows.push(
        serde_json::from_value(json!({
            "nodeId":"n4",
            "intervals":[{
                "parentKey":parent_key,
                "window":{
                    "order":sibling_order,
                    "direction":"forward",
                    "lower":{"kind":"unbounded"},
                    "upper":{"kind":"unbounded"},
                    "take":16
                }
            }]
        }))
        .unwrap(),
    );
    sibling_request.advanced_node_id = "n4".to_owned();
    let first_sibling_output = graph_store(&corpus, None)
        .evaluate_graph_query(&sibling_plan, &sibling_request)
        .expect("first page charges the added demand sibling too");
    assert_first_page_charged(
        &first_sibling_output,
        &sibling_edge["expect"]["firstPageChargedNodeIds"],
    );
    sibling_request.prior_window_ledgers = first_sibling_output.window_ledgers;
    let before = sibling_request.prior_window_ledgers.clone();
    let sibling_output = graph_store(&corpus, None)
        .evaluate_graph_query(&sibling_plan, &sibling_request)
        .expect("sibling-only continuation carries untouched lineages");
    assert_eq!(
        changed_lineages(&before, &sibling_output.window_ledgers),
        sibling_edge["expect"]["changedNodeIds"]
            .as_array()
            .unwrap()
            .iter()
            .map(|node_id| node_id.as_str().unwrap())
            .collect::<Vec<_>>(),
        "sibling continuation changes exactly its bound lineage",
    );
    assert_eq!(
        ledger_for(&sibling_output.window_ledgers, "n4").pages - ledger_for(&before, "n4").pages,
        sibling_edge["expect"]["advancedPagesDelta"]
            .as_u64()
            .unwrap(),
    );
}

/// @ref LLP 0209#23-closure-admission-demand-time-evaluation-time-and-qualification-registers —
/// the evaluator owns the demand-time validation ladder and class-2 reads
/// fail closed when the materialized permission context is incomplete.
#[test]
fn evaluator_validates_demands_and_class_two_context_before_reads() {
    let corpus = graph_corpus();
    let case = executable_case(&corpus, "g0-pair-list-hidden-internal-root");
    let (carrier, request) = request_for_case(&corpus, case);

    let mut unknown = request.clone();
    let mut extra = unknown.windows[0].clone();
    extra.node_id = "n999".to_owned();
    unknown.windows.push(extra);
    assert_eq!(
        graph_store(&corpus, None)
            .evaluate_graph_query(&carrier.normalized_plan, &unknown)
            .unwrap_err()
            .diagnostic
            .code,
        "SNAPBACK_GRAPH_WINDOW_VECTOR_INVALID"
    );

    let mut duplicate = request.clone();
    duplicate.windows.push(duplicate.windows[0].clone());
    assert_eq!(
        graph_store(&corpus, None)
            .evaluate_graph_query(&carrier.normalized_plan, &duplicate)
            .unwrap_err()
            .diagnostic
            .code,
        "SNAPBACK_GRAPH_WINDOW_VECTOR_INVALID"
    );

    let mut order_mismatch = request.clone();
    order_mismatch.windows[0].intervals[0].window.order[0].direction = OrderDirection::Asc;
    assert_eq!(
        graph_store(&corpus, None)
            .evaluate_graph_query(&carrier.normalized_plan, &order_mismatch)
            .unwrap_err()
            .diagnostic
            .code,
        "SNAPBACK_GRAPH_DEMAND_IDENTITY_MISMATCH"
    );

    let mut missing_permission = request;
    missing_permission
        .authority
        .permission_values_by_table
        .clear();
    let refused = graph_store(&corpus, None)
        .evaluate_graph_query(&carrier.normalized_plan, &missing_permission)
        .expect("missing class-2 context materializes a denial");
    assert_eq!(
        serde_json::to_value(refused).unwrap()["refusalReason"],
        "SNAPBACK_AUTH_STALE_RESULT"
    );
}

fn class_two_plan_with_declared_kind(
    plan: &GraphQueryPlanV1,
    kind: GraphPolicyInputKindV1,
) -> (GraphQueryPlanV1, BTreeSet<String>) {
    let mut value = serde_json::to_value(plan).unwrap();
    let mut declaration_ids = BTreeSet::new();
    for node in value["nodes"].as_array_mut().unwrap() {
        if node["authority"]["declaredClass"] != 2 {
            continue;
        }
        let mut proof: GraphPartitionEquivalenceProofV1 =
            serde_json::from_value(node["authority"]["proof"].clone()).unwrap();
        for input in &mut proof.policy_inputs {
            input.kind = kind;
            declaration_ids.insert(input.declaration_id.clone());
        }
        node["authority"]["proof"] =
            serde_json::to_value(recompute_graph_partition_equivalence_proof_v1(&proof).unwrap())
                .unwrap();
    }
    (serde_json::from_value(value).unwrap(), declaration_ids)
}

#[test]
fn class_two_context_is_complete_per_declared_policy_input_kind() {
    let corpus = graph_corpus();
    let case = executable_case(&corpus, "g0-pair-list-hidden-internal-root");
    let (carrier, request) = request_for_case(&corpus, case);

    for (kind, edge_case_id) in [
        (
            GraphPolicyInputKindV1::Membership,
            "g2-class2-membership-only-context",
        ),
        (GraphPolicyInputKindV1::Role, "g2-class2-role-only-context"),
    ] {
        let (plan, declarations) =
            class_two_plan_with_declared_kind(&carrier.normalized_plan, kind);
        let mut request = request.clone();
        request.authority.permission_values_by_table.clear();
        match kind {
            GraphPolicyInputKindV1::Membership => {
                request.authority.resolved_membership_inputs = declarations;
            }
            GraphPolicyInputKindV1::Role => {
                request.authority.resolved_role_inputs = declarations;
            }
            GraphPolicyInputKindV1::PermissionBacking => unreachable!(),
        }
        let output = graph_store(&corpus, None)
            .evaluate_graph_query(&plan, &request)
            .unwrap_or_else(|error| panic!("{edge_case_id}: {error:?}"));
        assert_eq!(output.label, GraphCompletenessLabelV1::Complete);
    }

    let (membership_plan, _) = class_two_plan_with_declared_kind(
        &carrier.normalized_plan,
        GraphPolicyInputKindV1::Membership,
    );
    let mut missing = request;
    missing.authority.permission_values_by_table.clear();
    missing.authority.resolved_membership_inputs.clear();
    let refused = graph_store(&corpus, None)
        .evaluate_graph_query(&membership_plan, &missing)
        .expect("missing declared membership input fails closed as a materialized result");
    assert_eq!(
        refused.refusal_reason,
        Some(GraphMaterializedRefusalReasonV1::AuthStaleResult),
    );
}

#[test]
fn optional_argument_omission_stays_absent_with_zero_cardinality() {
    let corpus = graph_corpus();
    let case = executable_case(&corpus, "g0-pair-list-hidden-internal-root");
    let (carrier, mut request) = request_for_case(&corpus, case);
    let mut plan_value = serde_json::to_value(&carrier.normalized_plan).unwrap();
    let optional = plan_value["arguments"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|argument| argument["name"] == "selectedLabelIDs")
        .expect("selected-label argument");
    optional["contract"]["required"] = json!(false);
    let optional_id = optional["argumentId"].as_str().unwrap().to_owned();
    let plan: GraphQueryPlanV1 = serde_json::from_value(plan_value).unwrap();
    request
        .args
        .as_object_mut()
        .unwrap()
        .remove("selectedLabelIDs");

    let output = graph_store(&corpus, None)
        .evaluate_graph_query(&plan, &request)
        .expect("optional omission is executable");
    assert_eq!(
        output
            .structural_work
            .argument_items_by_argument
            .iter()
            .find(|argument| argument.argument_id == optional_id)
            .expect("optional argument observation")
            .observed,
        0,
    );
}

#[test]
fn root_and_child_zero_take_emit_unknown_without_continuations() {
    let corpus = graph_corpus();

    let root_case = executable_case(&corpus, "g0-pair-list-hidden-internal-root");
    let (root_carrier, mut root_request) = request_for_case(&corpus, root_case);
    root_request.windows[0].intervals[0].window.take = 0;
    let root_output = graph_store(&corpus, None)
        .evaluate_graph_query(&root_carrier.normalized_plan, &root_request)
        .expect("root take zero evaluates without a panic path");
    let root_proof = &root_output.node_completeness[0];
    assert_eq!(root_proof.label, GraphCompletenessLabelV1::Unknown);
    assert_eq!(
        root_proof.proof_class,
        GraphNodeCompletenessProofClassV1::None
    );
    assert_eq!(root_proof.proof["reason"], "zero-take-unproved");
    assert!(root_proof.proof.get("continuation").is_none());

    let child_case = executable_case(&corpus, "g0-pair-detail-notification-principal");
    let (child_carrier, mut child_request) = request_for_case(&corpus, child_case);
    child_request.windows[1].intervals[0].window.take = 0;
    child_request.advanced_node_id = "n2".to_owned();
    let child_output = graph_store(&corpus, None)
        .evaluate_graph_query(&child_carrier.normalized_plan, &child_request)
        .expect("child take zero evaluates without a panic path");
    let child_proof = child_output
        .node_completeness
        .iter()
        .find(|proof| proof.node_id == "n2")
        .expect("child node proof");
    assert_eq!(child_proof.label, GraphCompletenessLabelV1::Unknown);
    assert_eq!(
        child_proof.proof_class,
        GraphNodeCompletenessProofClassV1::None,
    );
    assert_eq!(child_proof.proof["reason"], "zero-take-unproved");
    assert!(child_proof.proof.get("continuation").is_none());
}

#[test]
fn hypothetically_admitted_search_materializes_the_ruled_refusal() {
    let corpus = graph_corpus();
    let case = executable_case(&corpus, "g0-pair-point-view-state-principal");
    let (carrier, request) = request_for_case(&corpus, case);
    let mut plan = carrier.normalized_plan;
    let search: GraphNodeV1 = serde_json::from_value(json!({
        "nodeId":"search", "kind":"search-membership", "edgeName":"search",
        "authority":{"declaredClass":1,"proof":null},
        "parentNodeId":"n0", "providerCapabilityId":"search.v1",
        "membershipIdentity":{
            "format":"snapback.graph-search-membership-identity.v1",
            "providerPlanHash":zero_hash(), "argumentContractHash":zero_hash(),
            "scopeContractHash":zero_hash(), "authorityClass":1,
            "providerVersion":"v1", "providerCompletenessClass":"complete-membership-v1",
            "membershipHash":zero_hash()
        },
        "memberField":"sourceIssueID", "scopeBindings":[],
        "invalidationTables":["issue"],
        "providerCompletenessClass":"complete-membership-v1"
    }))
    .unwrap();
    plan.nodes.insert(plan.nodes.len() - 1, search);

    let output = graph_store(&corpus, None)
        .evaluate_graph_query(&plan, &request)
        .expect("search defense-in-depth arm materializes instead of escaping");
    assert_eq!(
        output.refusal_reason,
        Some(GraphMaterializedRefusalReasonV1::QueryCostEvidenceRequired),
    );
    assert_eq!(output.node_completeness.len(), plan.nodes.len());
    assert_legal_node_proof_classes(
        &serde_json::to_value(&output.node_completeness).unwrap(),
        "search defense-in-depth refusal",
    );
}

#[test]
fn kernel_read_failure_materializes_full_refusal_evidence() {
    let corpus = graph_corpus();
    let case = executable_case(&corpus, "g0-pair-point-view-state-principal");
    let (carrier, request) = request_for_case(&corpus, case);
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("graph-kernel-read-failure.sqlite3");
    let mut store = LocalSnapback::open(&path).unwrap();
    let tables = corpus_seed_tables(&corpus);
    let diagnostics = store.apply_schema(corpus_schema(&tables)).unwrap();
    assert!(
        diagnostics
            .iter()
            .all(|diagnostic| diagnostic.severity != DiagnosticSeverity::Error)
    );
    store.seed(SeedData { tables }).unwrap();
    {
        let connection = rusqlite::Connection::open(&path).unwrap();
        connection
            .execute("UPDATE issueListRead SET _version = -1", [])
            .expect("inject a forced kernel row-version read failure");
    }
    let output = store
        .evaluate_graph_query(&carrier.normalized_plan, &request)
        .expect("closed kernel read failure materializes instead of returning Err");
    assert_eq!(
        output.refusal_reason,
        Some(GraphMaterializedRefusalReasonV1::StorageVersionCorrupt),
    );
    assert_eq!(
        output.node_completeness.len(),
        carrier.normalized_plan.nodes.len(),
        "refusal carries every data-node proof plus projection composition",
    );
    assert_legal_node_proof_classes(
        &serde_json::to_value(&output.node_completeness).unwrap(),
        "kernel read failure refusal",
    );
}

/// @ref LLP 0209#24-plan-instance-and-contextual-materialization-identity —
/// the reported evaluation cut is sampled from the already-pinned read view,
/// even when a successor commits before evaluation continues.
#[test]
fn graph_evaluation_tuple_uses_the_pinned_snapshot_cut() {
    let corpus = graph_corpus();
    let case = executable_case(&corpus, "g0-pair-point-hidden-internal-root");
    let (carrier, mut request) = request_for_case(&corpus, case);
    request.evaluation_cut = GraphEvaluationCutV1(u64::MAX);

    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("graph-snapshot.sqlite3");
    let tables = corpus_seed_tables(&corpus);
    let mut reader = LocalSnapback::open(&path).unwrap();
    let diagnostics = reader.apply_schema(corpus_schema(&tables)).unwrap();
    assert!(
        diagnostics
            .iter()
            .all(|diagnostic| diagnostic.severity != DiagnosticSeverity::Error)
    );
    reader
        .seed(SeedData {
            tables: tables.clone(),
        })
        .unwrap();
    let lane = reader.read_lane();

    let (reached_tx, reached_rx) = std::sync::mpsc::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    let _hook = reader.set_graph_evaluation_snapshot_debug_hook(reached_tx, release_rx);
    let writer_thread = std::thread::spawn(move || {
        let pinned = reached_rx
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("graph evaluator pins its predecessor snapshot");
        let mut successor_row = tables["comment"][0].clone();
        successor_row.insert("_id".to_owned(), json!("graph_snapshot_successor"));
        successor_row.insert("id".to_owned(), json!("graph_snapshot_successor"));
        reader
            .seed(SeedData {
                tables: BTreeMap::from([("comment".to_owned(), vec![successor_row])]),
            })
            .expect("interleaved successor commit succeeds");
        release_tx.send(()).unwrap();
        pinned
    });

    let output = lane
        .evaluate_graph_query(&carrier.normalized_plan, &request)
        .expect("pinned graph evaluation completes");
    let pinned = writer_thread.join().unwrap();
    assert_ne!(pinned, u64::MAX, "caller-supplied cut was not trusted");
    assert_eq!(output.graph_completeness.evaluation_cut.0, pinned);
    assert!(
        output
            .node_completeness
            .iter()
            .all(|node| { node.proof["evaluationCut"].as_u64() == Some(pinned) })
    );
}

#[test]
fn all_semijoin_admission_requires_its_declared_collection_argument_filter() {
    let corpus = graph_corpus();
    let case = executable_case(&corpus, "g0-pair-list-hidden-internal-root");
    let carrier: GraphQueryCarrierV1 = serde_json::from_value(case["plan"].clone()).unwrap();
    for replacement in [
        json!({"Literal":["literal-must-not-bind"]}),
        json!({"Arg":"a0"}),
    ] {
        let mut value = serde_json::to_value(&carrier.normalized_plan).unwrap();
        value["nodes"][4]["filters"][0]["value"] = replacement;
        let plan: GraphQueryPlanV1 = serde_json::from_value(value).unwrap();
        assert!(
            graph_query_plan_faults_v1(&plan)
                .iter()
                .any(|fault| fault.reason == GraphAdmissionRefusalReasonV1::ArgumentUnbound)
        );
    }

    let mut value = serde_json::to_value(&carrier.normalized_plan).unwrap();
    value["arguments"][1]["contract"]["value"] = json!({"kind":"string","maxBytes":128});
    let plan: GraphQueryPlanV1 = serde_json::from_value(value).unwrap();
    assert!(
        graph_query_plan_faults_v1(&plan)
            .iter()
            .any(|fault| fault.reason == GraphAdmissionRefusalReasonV1::ArgumentUnbound)
    );
}

/// The G2-B freezer is downstream of real evaluator output. It writes the
/// graph-only sidecar consumed by the JS G0 freezer and the exact per-node
/// replay ledger; the ordinary shared Query/Row/Auth dependencies remain
/// runtime-only and are asserted through the registration result here.
///
/// Run with `SNAPBACK_FREEZE_GRAPH_G2_B=1` to regenerate both artifacts, then
/// run the JS graph freezer so its embedded capture vectors/digests follow the
/// runtime sidecar. A normal test run is read-only.
///
/// @ref LLP 0209#51-captured-vocabulary-by-normalized-node — the evaluator is
/// the sole capture authority and sync validates the exact shared carrier.
/// @ref LLP 0209#52-per-node-decision-ledger — frozen commit shapes bind every
/// Zerobugs graph's per-node disposition in normalized order.
#[test]
fn graph_runtime_captures_register_and_match_replays_are_frozen() {
    let corpus = graph_corpus();
    let runs = normal_graph_evaluations(&corpus);
    assert_eq!(runs.len(), 3, "all three Zerobugs graphs evaluate");
    assert!(runs.iter().all(|(_, _, _, reads)| {
        reads
            .iter()
            .any(|read| read.kind == CapturedReadKind::GraphNode)
            && reads
                .iter()
                .any(|read| read.kind == CapturedReadKind::Query)
    }));

    let captures = runtime_capture_artifact(&runs);
    let dispositions = match_disposition_artifact(&corpus, &runs);
    if std::env::var_os("SNAPBACK_FREEZE_GRAPH_G2_B").is_some() {
        write_frozen_json(RUNTIME_CAPTURES_FILE, &captures);
        write_frozen_json(MATCH_DISPOSITIONS_FILE, &dispositions);
        return;
    }

    assert_eq!(
        load_json(RUNTIME_CAPTURES_FILE),
        captures,
        "runtime graph capture sidecar is stale"
    );
    assert_eq!(
        load_json(MATCH_DISPOSITIONS_FILE),
        dispositions,
        "graph matcher disposition corpus is stale"
    );
    for (query, carrier, _, reads) in &runs {
        let frozen = corpus["g0ExitObservationEvidence"]
            .as_array()
            .unwrap()
            .iter()
            .find(|row| row["graphPlanHash"] == carrier.plan_hash.as_str())
            .unwrap_or_else(|| panic!("frozen observation for {query}"));
        let actual = reads
            .iter()
            .filter_map(|read| read.graph.as_ref())
            .collect::<Vec<_>>();
        assert_eq!(
            frozen["capturedDependencies"],
            serde_json::to_value(actual).unwrap(),
            "G0 exit capture vector for {query} must be evaluator-authored"
        );
    }
}

/// @ref LLP 0209#9-sequencing-and-measurement-what-lands-first-and-how-it-is-measured — executable graph corpus entries run
/// through the real snapshot-pinned evaluator. The three admission refusals
/// remain structural because they deliberately carry no invocation; the
/// required-edge miss exercises the evaluation-time register.
#[test]
fn executes_the_corpus_through_the_evaluator() {
    let corpus = graph_corpus();
    let paired = paired_world_fixtures();

    for case in corpus["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|case| case["caseKind"] == "pairedWorld")
    {
        let carrier: GraphQueryCarrierV1 = serde_json::from_value(case["plan"].clone()).unwrap();
        let query = case["query"].as_str().unwrap();
        let (materialization, partition) = if query == "publicRooms" {
            validate_broadcast_invocation(&carrier, &case["invocation"], query)
        } else {
            validate_corpus_invocation_with_disposition(
                &carrier,
                &case["invocation"],
                query,
                Some(&case["windowVectorDisposition"]),
            )
        };
        let request =
            evaluation_request(&corpus, &case["invocation"], &materialization, &partition);
        let fixture = paired["pairs"]
            .as_array()
            .unwrap()
            .iter()
            .find(|pair| pair["id"] == case["fixturePairId"])
            .unwrap();
        let table = fixture["namedSlice"]["table"].as_str().unwrap();
        for world in ["present", "absent"] {
            let store = graph_store(&corpus, Some((table, &fixture[world]["sliceTableRows"])));
            let result = store
                .evaluate_graph_query(&carrier.normalized_plan, &request)
                .unwrap_or_else(|error| panic!("{} {world}: {error:?}", case["id"]));
            assert_evaluator_matches_frozen_result(
                &format!("{} {world}", case["id"].as_str().unwrap()),
                &result,
                &case["expect"],
                true,
            );
        }
    }

    let allow_deny = corpus["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|case| case["caseKind"] == "allowDeny")
        .unwrap();
    let carrier: GraphQueryCarrierV1 = serde_json::from_value(allow_deny["plan"].clone()).unwrap();
    let call = &allow_deny["invocations"]["allowed"];
    let (materialization, partition) = validate_corpus_invocation(&carrier, call, "listIssueByID");
    let request = evaluation_request(&corpus, call, &materialization, &partition);
    let result = graph_store(&corpus, None)
        .evaluate_graph_query(&carrier.normalized_plan, &request)
        .expect("allowed class-2 graph evaluates");
    assert_evaluator_matches_frozen_result(
        allow_deny["id"].as_str().unwrap(),
        &result,
        &allow_deny["expect"]["allowed"],
        true,
    );
    assert_eq!(allow_deny["expect"]["denied"], "deny");
    assert!(allow_deny["expect"]["deniedResultBytes"].is_null());

    let required_miss = corpus["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|case| case["caseKind"] == "refusal" && case["trigger"]["phase"] == "evaluation")
        .expect("one evaluation-time required-edge refusal");
    let carrier: GraphQueryCarrierV1 =
        serde_json::from_value(required_miss["plan"].clone()).unwrap();
    let call = &required_miss["invocation"];
    let (materialization, partition) =
        validate_corpus_invocation(&carrier, call, required_miss["query"].as_str().unwrap());
    let request = evaluation_request(&corpus, call, &materialization, &partition);
    let result = graph_store(
        &corpus,
        Some((
            required_miss["fixture"]["table"].as_str().unwrap(),
            &required_miss["fixture"]["rows"],
        )),
    )
    .evaluate_graph_query(&carrier.normalized_plan, &request)
    .expect("required to-one miss materializes a refusal result");
    assert_evaluator_matches_frozen_result(
        required_miss["id"].as_str().unwrap(),
        &result,
        &required_miss["expect"],
        true,
    );
}

/// The corpus-local class-1 graph executes two genuinely distinct evaluations
/// per principal: the establishment lookup, and a fresh fail-closed function
/// membership plus delivered-query evaluation.
#[test]
fn broadcast_prover_cases_are_executable() {
    let corpus = graph_corpus();
    let fixture = &corpus["broadcastFixture"]["data"];
    let schema_value = &corpus["broadcastFixture"]["schema"];
    let installed_schema: SchemaManifest =
        serde_json::from_value(schema_value.clone()).expect("broadcast installed schema");
    assert_eq!(
        fixture["format"],
        "snapback.graph-broadcast-fixture-data.v1"
    );
    let cases = corpus["cases"]
        .as_array()
        .expect("cases")
        .iter()
        .filter(|case| {
            matches!(
                case["caseKind"].as_str(),
                Some("audienceParity" | "scopeMismatch")
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(cases.len(), 3, "two audience pairs plus one scope mismatch");
    for case in cases {
        let carrier: GraphQueryCarrierV1 =
            serde_json::from_value(case["plan"].clone()).expect("broadcast carrier");
        assert_eq!(
            graph_plan_identity_v1(&carrier.normalized_plan).expect("broadcast plan identity"),
            carrier,
        );
        validate_graph_query_plan_v1(&carrier.normalized_plan)
            .expect("generated broadcast/query-shaped carrier admits");
        match case["caseKind"].as_str().unwrap() {
            "audienceParity" => {
                assert_exact_object_keys(
                    case,
                    &[
                        "caseKind",
                        "id",
                        "plan",
                        "invocations",
                        "principals",
                        "evaluationEvidence",
                        "expect",
                    ],
                    "audienceParity case",
                );
                let GraphBroadcastAdmissionV1::Broadcast { establishment, .. } =
                    &carrier.normalized_plan.broadcast
                else {
                    panic!("audienceParity uses the admitted broadcast carrier")
                };
                assert_eq!(establishment.scope.resource_equalities.len(), 1);
                assert_eq!(establishment.invalidation.len(), 18);
                assert_eq!(
                    establishment.audience.installed_owner_identity,
                    graph_broadcast_installed_owner_identity_v1(&installed_schema, "roomMembers",)
                        .expect("host recomputes installed audience owner"),
                );
                let invocations = case["invocations"]
                    .as_array()
                    .expect("audience invocations");
                let principals = case["principals"].as_array().expect("audience principals");
                assert_eq!(invocations.len(), 2);
                assert_eq!(principals.len(), 2);
                let mut establishment_evaluations = Vec::new();
                let mut strict_evaluations = Vec::new();
                let mut g2a_delivery_evaluations = 0;
                for (invocation, principal) in invocations.iter().zip(principals) {
                    let (materialization, partition) =
                        validate_broadcast_invocation(&carrier, invocation, "publicRooms");
                    let principal = principal.as_str().expect("principal");
                    establishment_evaluations.push(fixture_establishment_evaluation(
                        &case["plan"],
                        schema_value,
                        fixture,
                        &invocation["args"],
                        principal,
                    ));
                    let strict_evaluation = fixture_strict_delivery_evaluation(
                        &case["plan"],
                        schema_value,
                        fixture,
                        &invocation["args"],
                        principal,
                    );
                    if strict_evaluation["outcome"] == "allow" {
                        let request =
                            evaluation_request(&corpus, invocation, &materialization, &partition);
                        let result = graph_store(&corpus, None)
                            .evaluate_graph_query(&carrier.normalized_plan, &request)
                            .expect("strictly admitted class-1 delivery executes in G2-A");
                        assert_evaluator_matches_frozen_result(
                            case["id"].as_str().unwrap(),
                            &result,
                            &case["expect"]["allowedDelivery"],
                            true,
                        );
                        g2a_delivery_evaluations += 1;
                    } else {
                        assert!(
                            strict_evaluation["resultBytes"].is_null(),
                            "strict denial never invokes the graph evaluator or yields bytes",
                        );
                    }
                    strict_evaluations.push(strict_evaluation);
                }
                assert_eq!(
                    g2a_delivery_evaluations, 1,
                    "only the strictly admitted member reaches the G2-A evaluator",
                );
                assert_eq!(
                    json!(establishment_evaluations),
                    case["evaluationEvidence"]["establishment"],
                );
                assert_eq!(
                    json!(strict_evaluations),
                    case["evaluationEvidence"]["strict"],
                );
                let establishment_outcomes = establishment_evaluations
                    .iter()
                    .map(|row| row["outcome"].clone())
                    .collect::<Vec<_>>();
                let strict_outcomes = strict_evaluations
                    .iter()
                    .map(|row| row["outcome"].clone())
                    .collect::<Vec<_>>();
                assert_eq!(json!(establishment_outcomes), json!(["allow", "deny"]));
                assert_eq!(strict_outcomes, establishment_outcomes);
                assert_eq!(
                    case["expect"]["establishment"],
                    json!(establishment_outcomes)
                );
                assert_eq!(case["expect"]["strict"], json!(strict_outcomes));
                assert!(
                    strict_evaluations[1]["resultBytes"].is_null(),
                    "authenticated outsider is denied end-to-end",
                );
            }
            "scopeMismatch" => {
                assert_exact_object_keys(
                    case,
                    &[
                        "caseKind",
                        "id",
                        "plan",
                        "invocations",
                        "principal",
                        "expect",
                    ],
                    "scopeMismatch case",
                );
                assert!(matches!(
                    carrier.normalized_plan.broadcast,
                    GraphBroadcastAdmissionV1::QueryShaped {
                        reason: GraphQueryShapedReasonV1::ScopeUnbound,
                        ..
                    }
                ));
                validate_broadcast_invocation(
                    &carrier,
                    &case["invocations"]["memberScope"],
                    "publicRoomsUnbound",
                );
                validate_broadcast_invocation(
                    &carrier,
                    &case["invocations"]["presentedInstance"],
                    "publicRoomsUnbound",
                );
                assert_ne!(
                    case["invocations"]["memberScope"]["materialization"]["graphInstanceHash"],
                    case["invocations"]["presentedInstance"]["materialization"]["graphInstanceHash"],
                );
                let principal = case["principal"].as_str().unwrap();
                let member_scope = case["invocations"]["memberScope"]["args"]["roomId"]
                    .as_str()
                    .unwrap();
                let presented_scope = case["invocations"]["presentedInstance"]["args"]["roomId"]
                    .as_str()
                    .unwrap();
                assert_ne!(
                    member_scope, presented_scope,
                    "P and Q are distinct resources"
                );
                assert!(
                    fixture["roomMembers"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .any(|row| {
                            row["principal"] == principal && row["roomId"] == member_scope
                        })
                );
                assert!(
                    !fixture["roomMembers"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .any(|row| {
                            row["principal"] == principal && row["roomId"] == presented_scope
                        }),
                    "the selected principal is a member of P but not Q",
                );
                assert_eq!(case["expect"]["classification"], "query-shaped");
                assert_eq!(case["expect"]["reason"], "scope-unbound");
                assert!(case["expect"]["resultBytes"].is_null());
            }
            _ => unreachable!(),
        }
    }

    let query = |name: &str| {
        &corpus["broadcastFixture"]["queries"]
            .as_array()
            .unwrap()
            .iter()
            .find(|query| query["query"] == name)
            .unwrap()["carrier"]
    };
    let divergence = &corpus["broadcastFixture"]["divergence"];
    let establishment = fixture_establishment_evaluation(
        query("publicRooms"),
        schema_value,
        fixture,
        &divergence["args"],
        divergence["principal"].as_str().unwrap(),
    );
    let strict = fixture_strict_delivery_evaluation(
        query("publicRoomsDivergent"),
        schema_value,
        fixture,
        &divergence["args"],
        divergence["principal"].as_str().unwrap(),
    );
    assert_eq!(establishment, divergence["establishment"]);
    assert_eq!(strict, divergence["strict"]);
    assert_eq!(establishment["outcome"], "allow");
    assert_eq!(strict["outcome"], "deny");
    assert_eq!(
        divergence["compilerDisposition"],
        json!({
            "classification":"query-shaped",
            "format":"snapback.graph-broadcast-admission.v1",
            "reason":"audience-parity-failed",
        }),
        "establishment/strict divergence is refused, never certified",
    );
}

/// The shared G2 sidecar retains its exact four-row top-level contract. G0
/// prover dispositions live in a separate additive artifact.
#[test]
fn g2_pending_broadcast_cases_are_structurally_frozen() {
    let pending = pending_broadcast_cases();
    assert_exact_object_keys(
        &pending,
        &[
            "format",
            "version",
            "description",
            "caseKinds",
            "cases",
            "contentDigest",
        ],
        "pending corpus",
    );
    let mut without_digest = pending.clone();
    without_digest
        .as_object_mut()
        .unwrap()
        .remove("contentDigest");
    assert_eq!(
        pending["contentDigest"].as_str(),
        Some(jcs_domain_hash("", &without_digest).as_str()),
    );
    assert_eq!(
        pending["caseKinds"],
        json!([
            "audienceParity",
            "scopeMismatch",
            "authorityTransition",
            "mixedCommit"
        ]),
    );
    let cases = pending["cases"].as_array().expect("pending cases");
    assert_eq!(cases.len(), 4);

    for case in cases {
        assert!(
            case.get("pending").is_none(),
            "the closed case union has no pending arm"
        );
        let carrier: GraphQueryCarrierV1 =
            serde_json::from_value(case["plan"].clone()).expect("pending carrier");
        assert_eq!(
            graph_plan_identity_v1(&carrier.normalized_plan).expect("pending host plan identity"),
            carrier,
        );
        match case["caseKind"].as_str().expect("pending case kind") {
            "audienceParity" => {
                assert_exact_object_keys(
                    case,
                    &[
                        "caseKind",
                        "id",
                        "plan",
                        "invocations",
                        "principals",
                        "expect",
                    ],
                    "audienceParity sidecar case",
                );
                assert_eq!(case["invocations"].as_array().unwrap().len(), 2);
                for invocation in case["invocations"].as_array().unwrap() {
                    validate_corpus_invocation(&carrier, invocation, "listIssueByID");
                }
            }
            "scopeMismatch" => {
                assert_exact_object_keys(
                    case,
                    &[
                        "caseKind",
                        "id",
                        "plan",
                        "invocations",
                        "principal",
                        "expect",
                    ],
                    "scopeMismatch sidecar case",
                );
                validate_corpus_invocation(
                    &carrier,
                    &case["invocations"]["memberScope"],
                    "listIssueByID",
                );
                validate_corpus_invocation(
                    &carrier,
                    &case["invocations"]["presentedInstance"],
                    "listIssueByID",
                );
            }
            "authorityTransition" | "mixedCommit" => {
                assert_exact_object_keys(
                    case,
                    &[
                        "caseKind",
                        "id",
                        "plan",
                        "invocations",
                        "principal",
                        "commit",
                        "observed",
                    ],
                    "transition case",
                );
                validate_corpus_invocation(
                    &carrier,
                    &case["invocations"]["before"],
                    "listIssueByID",
                );
                validate_corpus_invocation(
                    &carrier,
                    &case["invocations"]["after"],
                    "listIssueByID",
                );
                assert_eq!(
                    case["invocations"]["before"]["authorizationVersion"]["epoch"],
                    0
                );
                assert_eq!(
                    case["invocations"]["after"]["authorizationVersion"]["epoch"],
                    1
                );
                assert!(
                    case["commit"]["authorityEvents"]
                        .as_array()
                        .is_some_and(|events| !events.is_empty())
                );
                let changes = case["commit"]["dataChanges"]
                    .as_array()
                    .expect("data changes");
                if case["caseKind"] == "authorityTransition" {
                    assert!(changes.is_empty());
                } else {
                    assert!(!changes.is_empty());
                }
                assert_eq!(
                    case["commit"]["afterAuthorizationVersion"],
                    case["invocations"]["after"]["authorizationVersion"],
                );
                let observed = case["observed"].as_array().expect("fence sequence");
                assert_eq!(observed.len(), 2);
                assert_eq!(observed[0]["ordinal"], 0);
                assert_eq!(observed[0]["kind"], "fence");
                assert_eq!(observed[1]["ordinal"], 1);
                assert_eq!(observed[1]["kind"], "delivery");
                assert_eq!(
                    observed[0]["authorizationVersion"],
                    case["commit"]["afterAuthorizationVersion"],
                );
                assert_eq!(
                    observed[1]["authorizationVersion"],
                    case["commit"]["afterAuthorizationVersion"],
                );
            }
            kind => panic!("unexpected pending case kind {kind}"),
        }
    }
}

#[test]
fn broadcast_prover_dispositions_are_additive() {
    let pending = pending_broadcast_cases();
    let artifact = broadcast_prover_dispositions();
    assert_exact_object_keys(
        &artifact,
        &[
            "format",
            "version",
            "description",
            "dispositions",
            "contentDigest",
        ],
        "broadcast prover dispositions",
    );
    let mut without_digest = artifact.clone();
    without_digest
        .as_object_mut()
        .unwrap()
        .remove("contentDigest");
    assert_eq!(
        artifact["contentDigest"].as_str(),
        Some(jcs_domain_hash("", &without_digest).as_str()),
    );
    let dispositions = artifact["dispositions"].as_array().unwrap();
    assert_eq!(dispositions.len(), 4);
    for case in pending["cases"].as_array().unwrap() {
        let disposition = dispositions
            .iter()
            .find(|row| row["id"] == case["id"])
            .expect("each unchanged G2 row has one additive prover disposition");
        assert_eq!(disposition["caseKind"], case["caseKind"]);
        assert!(disposition["proverDisposition"].as_str().is_some());
        assert!(
            disposition["reason"]
                .as_str()
                .is_some_and(|reason| !reason.is_empty())
        );
    }
}

/// Every executable paired-world and allowed activation result carries one
/// exact proof per normalized node, a typed composed proof, and citations
/// hashing the complete outer NodeCompleteness record in canonical node order.
#[test]
fn completeness_labels() {
    let corpus = graph_corpus();
    for case in corpus["cases"]
        .as_array()
        .expect("cases")
        .iter()
        .filter(|case| matches!(case["caseKind"].as_str(), Some("pairedWorld" | "allowDeny")))
    {
        let plan: GraphQueryCarrierV1 = serde_json::from_value(case["plan"].clone()).unwrap();
        let (call, expected, disposition) = if case["caseKind"] == "pairedWorld" {
            (
                &case["invocation"],
                &case["expect"],
                Some(&case["windowVectorDisposition"]),
            )
        } else {
            (
                &case["invocations"]["allowed"],
                &case["expect"]["allowed"],
                None,
            )
        };
        let query = case["query"].as_str().expect("executable result query");
        let (materialization, partition) = if query == "publicRooms" {
            validate_broadcast_invocation(&plan, call, query)
        } else {
            validate_corpus_invocation_with_disposition(&plan, call, query, disposition)
        };
        let nodes = expected["nodeCompleteness"]
            .as_array()
            .expect("node proofs");
        assert_eq!(nodes.len(), plan.normalized_plan.nodes.len());
        for (entry, plan_node) in nodes.iter().zip(&plan.normalized_plan.nodes) {
            assert_eq!(entry["nodeId"].as_str(), Some(plan_node.node_id()));
            assert_eq!(entry["nodeKind"], entry["proof"]["kind"]);
            assert_eq!(entry["label"], entry["proof"]["label"]);
            serde_json::from_value::<GraphNodeCompletenessProofV1>(entry["proof"].clone())
                .expect("closed node completeness proof");
            assert_eq!(
                entry["proof"]["partitionHash"].as_str(),
                Some(partition.partition_hash.as_str()),
                "every node proof binds the Rust-reconstructed partition",
            );
            assert_eq!(
                entry["proof"]["materializationHash"].as_str(),
                Some(materialization.materialization_hash.as_str()),
            );
        }
        let composition: GraphCompositionProofV1 =
            serde_json::from_value(expected["graphCompleteness"]["proof"].clone())
                .expect("closed composition proof");
        let citations = expected["graphCompleteness"]["proof"]["nodes"]
            .as_array()
            .expect("composition citations");
        assert_eq!(citations.len() + 1, nodes.len());
        assert_eq!(
            expected["graphCompleteness"]["partitionHash"].as_str(),
            Some(partition.partition_hash.as_str()),
        );
        assert_eq!(
            expected["graphCompleteness"]["proof"]["partitionHash"].as_str(),
            Some(partition.partition_hash.as_str()),
            "composition proof binds the reconstructed partition",
        );
        for (citation, entry) in citations.iter().zip(nodes) {
            assert_eq!(citation["nodeId"], entry["nodeId"]);
            assert_eq!(citation["nodeKind"], entry["nodeKind"]);
            assert_eq!(citation["label"], entry["label"]);
            assert_eq!(
                citation["proofHash"].as_str(),
                Some(jcs_domain_hash("snapback:graph-node-completeness:v1:", entry).as_str()),
            );
        }
        let projection = nodes.last().expect("projection proof");
        assert_eq!(projection["proofClass"], "projection-composition");
        assert_eq!(
            projection["proof"]["composition"],
            serde_json::to_value(composition).unwrap()
        );
        assert_eq!(
            projection["proof"]["partitionHash"].as_str(),
            Some(partition.partition_hash.as_str()),
        );
        assert_eq!(
            projection["proof"]["composition"]["partitionHash"].as_str(),
            Some(partition.partition_hash.as_str()),
        );
    }
}

#[test]
fn every_frozen_node_proof_class_is_legal_including_refusals() {
    let corpus = graph_corpus();
    for case in corpus["cases"].as_array().expect("cases") {
        for expected in [&case["expect"], &case["expect"]["allowed"]] {
            if expected["nodeCompleteness"].is_array() {
                assert_legal_node_proof_classes(
                    &expected["nodeCompleteness"],
                    case["id"].as_str().expect("case id"),
                );
            }
        }
    }
}

fn assert_derived_field(derived: &Value, actual: &Value, location: &str) {
    assert_eq!(
        &derived["value"], actual,
        "{location} value binds the declaration"
    );
    assert!(
        derived["derivation"]
            .as_str()
            .is_some_and(|text| !text.trim().is_empty()),
        "{location} has a derivation",
    );
}

fn assert_provisional_records_name_validation(value: &Value) {
    match value {
        Value::Array(values) => {
            for value in values {
                assert_provisional_records_name_validation(value);
            }
        }
        Value::Object(fields) => {
            if fields.get("provisional") == Some(&Value::Bool(true)) {
                let command = fields
                    .get("validationCommand")
                    .and_then(Value::as_str)
                    .expect("every provisional record names its validation command");
                assert!(
                    command.contains("zb5-large.mjs") || command.contains("zb5-hot.mjs"),
                    "provisional validation is a pinned zb5 command",
                );
            }
            for value in fields.values() {
                assert_provisional_records_name_validation(value);
            }
        }
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => {}
    }
}

/// Every numeric declaration has a neighboring derivation record. Logical
/// maxima cite fixtures/oracle bytes; physical declarations retain the
/// required `[G2 measures]` posture and exact-match the admitted carriers.
#[test]
fn bounds_are_fixture_derived() {
    let corpus = graph_corpus();
    let bounds = graph_bounds();
    assert_eq!(bounds["fixtures"]["normal"]["users"], 14);
    assert_eq!(bounds["fixtures"]["normal"]["issues"], 516);
    assert_eq!(bounds["fixtures"]["normal"]["comments"], 924);
    assert_eq!(bounds["fixtures"]["normal"]["labels"], 30);
    assert_eq!(bounds["fixtures"]["normal"]["issueLabelEdges"], 603);
    assert_eq!(bounds["fixtures"]["normal"]["maxCommentsPerIssue"], 21);
    assert_eq!(bounds["fixtures"]["normal"]["maxLabelsPerIssue"], 5);
    assert_eq!(bounds["fixtures"]["large"]["users"], 100);
    assert_eq!(bounds["fixtures"]["large"]["issues"], 1_000_000);
    assert_eq!(bounds["fixtures"]["large"]["comments"], 2_527_886);
    assert_eq!(bounds["fixtures"]["large"]["labels"], 4_810);
    assert_eq!(bounds["fixtures"]["large"]["issueLabelEdges"], 2_000_370);
    assert_eq!(
        bounds["fixtures"]["documentedPerIssueDistribution"]["labels"]["maximum"],
        3,
    );
    assert_eq!(
        bounds["fixtures"]["documentedPerIssueDistribution"]["comments"]["obtainableReceiptCeiling"],
        2_527_886,
    );
    assert_provisional_records_name_validation(&bounds);

    let mut without_digest = bounds.clone();
    without_digest
        .as_object_mut()
        .unwrap()
        .remove("contentDigest");
    assert_eq!(
        bounds["contentDigest"].as_str(),
        Some(jcs_domain_hash("", &without_digest).as_str()),
    );

    for query in corpus_queries(&corpus) {
        let name = query["query"].as_str().unwrap();
        let carrier: GraphQueryCarrierV1 =
            serde_json::from_value(query["carrier"].clone()).unwrap();
        let actual = serde_json::to_value(&carrier.normalized_plan.query_cost).unwrap();
        let derivation = &bounds["queries"][name]["derivationTable"];
        assert_eq!(
            derivation["queryCost"]["maxResultBytes"]["provisional"], true,
            "large/hot result-byte maxima are not yet verified",
        );
        assert_eq!(
            bounds["queries"][name]["physical"]["observationPosture"],
            "[G2 measures]"
        );
        for (field, actual_value) in actual.as_object().unwrap() {
            if field == "graph" {
                continue;
            }
            assert_derived_field(
                &derivation["queryCost"][field],
                actual_value,
                &format!("{name}.queryCost.{field}"),
            );
        }
        let graph = &actual["graph"];
        assert_derived_field(
            &derivation["graph"]["maxArgumentItems"],
            &graph["maxArgumentItems"],
            &format!("{name}.graph.maxArgumentItems"),
        );
        assert_derived_field(
            &derivation["graph"]["maxPageResultBytes"],
            &graph["maxPageResultBytes"],
            &format!("{name}.graph.maxPageResultBytes"),
        );
        assert_derived_field(
            &derivation["graph"]["maxMaintainedWritesPerMutation"],
            &graph["maxMaintainedWritesPerMutation"],
            &format!("{name}.graph.maxMaintainedWritesPerMutation"),
        );
        assert_eq!(graph["maxMaintainedWritesPerMutation"], 0);
        for (field, actual_value) in graph["windowRollup"].as_object().unwrap() {
            assert_derived_field(
                &derivation["graph"]["windowRollup"][field],
                actual_value,
                &format!("{name}.graph.windowRollup.{field}"),
            );
        }
        for (index, node) in graph["nodes"].as_array().unwrap().iter().enumerate() {
            let record = &derivation["graph"]["nodes"][index];
            assert_eq!(record["nodeId"], node["nodeId"]);
            for (field, actual_value) in node.as_object().unwrap() {
                if field == "nodeId" {
                    continue;
                }
                assert_derived_field(
                    &record["fields"][field],
                    actual_value,
                    &format!("{name}.graph.nodes[{index}].{field}"),
                );
            }
        }
        for (index, argument) in graph["arguments"].as_array().unwrap().iter().enumerate() {
            let record = &derivation["graph"]["arguments"][index];
            assert_eq!(record["argumentId"], argument["argumentId"]);
            assert_derived_field(
                &record["fields"]["maxItems"],
                &argument["maxItems"],
                &format!("{name}.graph.arguments[{index}].maxItems"),
            );
        }
    }

    let list_root_pages = &bounds["queries"]["issueListV2"]["derivationTable"]["graph"]["nodes"][0]
        ["fields"]["maxWindowPages"];
    assert_eq!(list_root_pages["value"], 1);
    assert_eq!(list_root_pages["provisional"], true);
    assert!(
        list_root_pages["derivation"]
            .as_str()
            .is_some_and(|text| text.contains("filtered interval") && !text.contains("/ 1,000,000")),
        "list pages derive from the filtered interval rather than whole-table rows",
    );

    let detail = &bounds["queries"]["issueDetail"];
    let comments = &detail["derivationTable"]["graph"]["nodes"][2];
    assert_eq!(comments["nodeId"], "n2");
    assert_eq!(comments["fields"]["maxWindowPages"]["value"], 1);
    assert_eq!(comments["fields"]["maxWindowPages"]["provisional"], true);
    assert!(
        comments["fields"]["maxWindowPages"]["derivation"]
            .as_str()
            .is_some_and(
                |text| text.contains("21 / declared maxChildrenPerParent 1,024")
                    && text.contains("= 1")
            ),
    );
    assert_eq!(
        comments["fields"]["maxWindowPages"]["validationCommand"],
        "ZBUGS_LARGE_FIXTURE_ROOT=demos/zerobugs/fixtures-local/large-seed42-v1 ZBUGS_ATTEMPT=v4 volta run --node 24.18.0 node demos/zerobugs/control/tests/acceptance/gates/zb5-large.mjs",
    );
    assert_eq!(comments["fields"]["maxWindowScannedRows"]["value"], 1_025);
    assert_eq!(comments["fields"]["maxWindowIndexRanges"]["value"], 1);
    assert_eq!(comments["fields"]["maxWindowResultRows"]["value"], 1);
    assert_eq!(
        comments["fields"]["maxWindowResultBytes"]["value"],
        8_388_608
    );
    let rollup = &detail["derivationTable"]["graph"]["windowRollup"];
    for (field, value) in [
        ("maxWindowPages", 2),
        ("maxWindowRootRows", 1),
        ("maxWindowScannedRows", 2_092),
        ("maxWindowResultRows", 2),
        ("maxWindowResultBytes", 16_777_216),
        ("maxWindowIndexRanges", 27),
    ] {
        assert_eq!(rollup[field]["value"], value, "detail rollup {field}");
        assert_eq!(rollup[field]["provisional"], true);
    }

    let spot = &bounds["largeFixtureSpotCheck"];
    let large_fixture = repository_path("demos/zerobugs/fixtures-local/large-seed42-v1");
    if large_fixture.exists() {
        assert_eq!(spot["status"], "available-requires-zb5-rerun");
    } else {
        assert_eq!(spot["status"], "deferred-to-zb5-gate-rerun");
        assert_eq!(
            spot["command"],
            "ZBUGS_LARGE_FIXTURE_ROOT=demos/zerobugs/fixtures-local/large-seed42-v1 ZBUGS_ATTEMPT=v4 volta run --node 24.18.0 node demos/zerobugs/control/tests/acceptance/gates/zb5-large.mjs"
        );
    }
}

/// The corpus retains the seven-kind schema, executes the prover-owned case
/// kinds, and keeps the two delivery-order cases honestly partial.
/// All nine LLP 0268 labels carry the extension re-record posture.
#[test]
fn broadcast_inputs_complete() {
    let corpus = graph_corpus();
    assert_eq!(
        corpus["caseKinds"],
        json!([
            "pairedWorld",
            "allowDeny",
            "audienceParity",
            "scopeMismatch",
            "authorityTransition",
            "mixedCommit",
            "refusal"
        ]),
    );
    assert_eq!(
        corpus["executableCaseKinds"],
        json!([
            "pairedWorld",
            "allowDeny",
            "audienceParity",
            "scopeMismatch",
            "refusal"
        ]),
    );
    let kinds = corpus["cases"]
        .as_array()
        .unwrap()
        .iter()
        .map(|case| case["caseKind"].as_str().unwrap())
        .collect::<BTreeSet<_>>();
    assert_eq!(
        kinds,
        BTreeSet::from([
            "allowDeny",
            "audienceParity",
            "pairedWorld",
            "refusal",
            "scopeMismatch"
        ]),
    );
    for case in corpus["cases"].as_array().unwrap() {
        assert!(case.get("pending").is_none());
    }
    let input_rows = corpus["broadcastInputs"]
        .as_array()
        .expect("broadcast inputs");
    let labels = input_rows
        .iter()
        .map(|entry| entry["label"].as_str().unwrap())
        .collect::<BTreeSet<_>>();
    assert_eq!(
        labels,
        BTreeSet::from([
            "G0-BCAST-CLASS",
            "G0-BCAST-SEPARATION",
            "G0-BCAST-SCOPE",
            "G0-BCAST-SCOPE-BINDING",
            "G0-BCAST-AUDIENCE",
            "G0-BCAST-INVALIDATION",
            "G0-BCAST-IDENTITY",
            "G0-BCAST-CORPUS",
            "G0-BCAST-BOUNDS",
        ]),
    );
    let satisfied = input_rows
        .iter()
        .filter(|entry| entry["status"] == "SATISFIED")
        .map(|entry| entry["label"].as_str().unwrap())
        .collect::<BTreeSet<_>>();
    assert_eq!(
        satisfied,
        BTreeSet::from([
            "G0-BCAST-AUDIENCE",
            "G0-BCAST-CLASS",
            "G0-BCAST-IDENTITY",
            "G0-BCAST-SCOPE",
            "G0-BCAST-SCOPE-BINDING",
            "G0-BCAST-SEPARATION",
        ]),
    );
    for entry in input_rows {
        match entry["status"].as_str().unwrap() {
            "SATISFIED" => assert!(entry["missingCarrier"].is_null()),
            "PARTIAL" => assert!(
                entry["missingCarrier"]
                    .as_str()
                    .is_some_and(|value| !value.is_empty())
            ),
            status => panic!("unexpected broadcast input status {status}"),
        }
    }
    let observations = corpus["g0ExitObservations"]
        .as_array()
        .expect("observations");
    assert_eq!(observations.len(), 3);
    let evidence_rows = corpus["g0ExitObservationEvidence"]
        .as_array()
        .expect("normal observation evidence");
    assert_eq!(evidence_rows.len(), 3);
    for observation in observations {
        assert_exact_object_keys(
            observation,
            &[
                "format",
                "fixture",
                "graphPlanHash",
                "groupCount",
                "subscriberFanout",
                "groups",
            ],
            "typed G0 exit observation",
        );
        assert_eq!(observation["fixture"], "normal-seed-v1");
        assert_eq!(
            observation["format"],
            "snapback.graph-g0-exit-observation.v1"
        );
        assert_eq!(observation["groupCount"], 1);
        assert_eq!(observation["subscriberFanout"], 1);
        let groups = observation["groups"].as_array().unwrap();
        assert_eq!(groups.len(), 1);
        assert_exact_object_keys(
            &groups[0],
            &[
                "groupOrdinal",
                "resultBytes",
                "dependencyBytes",
                "groupStateBytes",
            ],
            "observation group",
        );
        assert_eq!(groups[0]["groupOrdinal"], 0);
        let evidence = evidence_rows
            .iter()
            .find(|row| row["graphPlanHash"] == observation["graphPlanHash"])
            .expect("observation has exact normal evidence");
        let result_bytes = evidence["resultBytes"].as_str().unwrap();
        assert_eq!(
            evidence["resultDigest"].as_str(),
            Some(byte_hash(result_bytes).as_str()),
        );
        let dependencies = evidence["capturedDependencies"]
            .as_array()
            .expect("captured dependency vector");
        let query = corpus_queries(&corpus)
            .find(|query| query["carrier"]["planHash"] == observation["graphPlanHash"])
            .expect("observation plan carrier");
        let carrier: GraphQueryCarrierV1 =
            serde_json::from_value(query["carrier"].clone()).unwrap();
        for dependency in dependencies {
            let capture: GraphCapturedReadV1 =
                serde_json::from_value(dependency.clone()).expect("typed captured dependency");
            validate_graph_captured_read_v1(&capture, &carrier.normalized_plan).unwrap_or_else(
                |reason| {
                    panic!(
                        "captured dependency binds the exact plan node: plan={} node={} dependency={:?} reason={reason:?}",
                        capture.graph_plan_hash, capture.node_id, capture.dependency,
                    )
                },
            );
        }
        assert_eq!(
            evidence["capturedDependencyVectorDigest"].as_str(),
            Some(jcs_domain_hash("", &evidence["capturedDependencies"]).as_str()),
        );
        assert_eq!(
            evidence["groupStateDigest"].as_str(),
            Some(jcs_domain_hash("", &evidence["groupState"]).as_str()),
        );
        assert_exact_object_keys(
            &evidence["groupState"],
            &["result", "proofTuple"],
            "memo-entry equivalent group state",
        );
        let (_, partition) = validate_corpus_invocation(
            &carrier,
            &evidence["invocation"],
            query["query"].as_str().unwrap(),
        );
        assert_eq!(
            evidence["groupState"]["proofTuple"]["partitionHash"].as_str(),
            Some(partition.partition_hash.as_str()),
        );
        assert_eq!(
            groups[0]["resultBytes"],
            result_bytes.as_bytes().len() as u64,
        );
        assert_eq!(
            groups[0]["dependencyBytes"],
            serde_json::to_string(&evidence["capturedDependencies"])
                .unwrap()
                .as_bytes()
                .len() as u64,
        );
        assert_eq!(
            groups[0]["groupStateBytes"],
            serde_json::to_string(&evidence["groupState"])
                .unwrap()
                .as_bytes()
                .len() as u64,
        );
    }
    let gaps = corpus["g0ExitObservationGaps"]
        .as_array()
        .expect("large/hot gap table");
    assert_eq!(gaps.len(), 6);
    for gap in gaps {
        assert_eq!(gap["status"], "NOT SATISFIED");
        assert!(gap["missingCarrier"].as_str().is_some());
        assert!(
            gap["command"]
                .as_str()
                .is_some_and(|command| command.contains("zb5-"))
        );
    }
}
