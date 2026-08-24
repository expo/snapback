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
use snapback::auth::invalidation::QueryNamespace;
use snapback::live_matcher::{
    GraphNodeMatchDispositionV1, LiveMatchOutcome,
    live_subscription_match_decision_with_graph_registration, live_subscription_match_outcome,
};
use snapback::local::{GraphServingAuthorityContextV1, LiveSubscribeInput, LocalSnapback};
use snapback::manifest::*;
use snapback_engine::graph_evaluator::{
    GraphEvaluationAuthorityV1, GraphEvaluationOutputV1, GraphEvaluationRequestV1,
    GraphPermissionValuesV1, GraphWindowLedgerV1,
};
use snapback_engine::test_support::{
    configure_graph_corpus_scheduler, graph_corpus_authorization_frames, graph_corpus_memo_entries,
    invoke_graph_corpus_mutation, measure_graph_serving_groups, refresh_graph_corpus_scheduler,
    set_graph_corpus_memo_limits, subscribe_graph_corpus_case,
    subscribe_graph_corpus_partition_case,
};
use snapback_kernel::storage::{ChangeOp, ChangedRow};
use snapback_sync::graph_captured_read::{
    GraphRegistrationPermissionValuesV1, GraphSubscriptionRegistrationDemandV1,
    RegisteredGraphSubscriptionDependenciesV1, graph_capture_carrier_is_well_formed,
    register_graph_subscription_dependencies,
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
const SERVED_OBSERVATIONS_FILE: &str = "tests/conformance/graph/served-observations.g2-c.v1.json";
const GRAPH_CORPUS_AUTHORIZATION_INCARNATION: &str = "01890f3c-9d5b-7000-8000-000000000001";
const GRAPH_CORPUS_DATA_VERSION_STREAM: &str = "01890f3c-9d5b-7000-8000-000000000002";
const GRAPH_CORPUS_AUTHORITY_TABLE: &str = "graphSchedulerAuthority";
const GRAPH_CORPUS_AUTHORITY_ROW: &str = "graph_scheduler_authority";
const GRAPH_CORPUS_AUTHORITY_MUTATION: &str = "graphCorpusAuthorityTransition";
const GRAPH_CORPUS_MIXED_MUTATION: &str = "graphCorpusMixedCommit";
const GRAPH_CORPUS_MATCHING_DATA_MUTATION: &str = "graphCorpusMatchingDataCommit";
const GRAPH_CORPUS_DISJOINT_DATA_MUTATION: &str = "graphCorpusDisjointDataCommit";
const OWNER_SCOPE_DOMAIN: &str = "snapback:g0-corpus-authority-scope:v1:";
const CORPUS_SCHEMA_HASH: &str =
    "sha256:1111111111111111111111111111111111111111111111111111111111111111";
const CORPUS_INPUTS_HASH: &str =
    "sha256:2222222222222222222222222222222222222222222222222222222222222222";
const CORPUS_BUNDLE_HASH: &str =
    "sha256:3333333333333333333333333333333333333333333333333333333333333333";
const CORPUS_IMPLEMENTATION_HASH: &str =
    "sha256:4444444444444444444444444444444444444444444444444444444444444444";
const CORPUS_ARGS_HASH: &str =
    "sha256:5555555555555555555555555555555555555555555555555555555555555555";

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
    tables.insert(
        GRAPH_CORPUS_AUTHORITY_TABLE.to_owned(),
        vec![Map::from_iter([
            ("_id".to_owned(), json!(GRAPH_CORPUS_AUTHORITY_ROW)),
            ("generation".to_owned(), json!(0)),
        ])],
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
            where_applicable: *unique
                && fields
                    .iter()
                    .any(|field| corpus_declared_field_optional(table, field)),
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

fn corpus_declared_field_type(table: &str, field: &str, inferred: FieldType) -> FieldType {
    let id_target = match (table, field) {
        ("issue", "projectID")
        | ("label", "projectID")
        | ("issueListRead", "projectID")
        | ("issueLabelRead", "projectID") => Some("project"),
        ("issue", "creatorID")
        | ("issue", "assigneeID")
        | ("comment", "creatorID")
        | ("viewState", "userID")
        | ("issueNotifications", "userID")
        | ("identityBinding", "userID")
        | ("issueListRead", "creatorID")
        | ("issueListRead", "assigneeID") => Some("user"),
        ("comment", "issueID")
        | ("viewState", "issueID")
        | ("issueNotifications", "issueID")
        | ("issueListRead", "issueID")
        | ("issueLabelRead", "issueID") => Some("issue"),
        ("issueLabelRead", "labelID") => Some("label"),
        _ => None,
    };
    if let Some(table) = id_target {
        return FieldType::Id {
            table: table.to_owned(),
        };
    }
    if (table, field) == ("identityBinding", "principal") {
        return FieldType::Principal;
    }
    if matches!(field, "modified" | "created" | "viewed") {
        return FieldType::Real;
    }
    inferred
}

fn corpus_declared_field_optional(table: &str, field: &str) -> bool {
    matches!(
        (table, field),
        ("user", "name")
            | ("user", "email")
            | ("project", "issueCountEstimate")
            | ("project", "markURL")
            | ("project", "logoURL")
            | ("issue", "shortID")
            | ("issue", "assigneeID")
            | ("issueListRead", "assigneeID")
    )
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
                        field_type: corpus_declared_field_type(
                            name,
                            &field,
                            inferred_field_type(
                                rows.iter()
                                    .map(|row| row.get(&field).cloned().unwrap_or(Value::Null)),
                            ),
                        ),
                        optional: corpus_declared_field_optional(name, &field),
                        name: field,
                    })
                    .collect(),
                indexes: graph_index_manifest(name),
                search_indexes: Vec::new(),
                vector_indexes: Vec::new(),
                search_live_limits: None,
                syncable: true,
                permission_backing: matches!(
                    name.as_str(),
                    "issue" | "issueListRead" | GRAPH_CORPUS_AUTHORITY_TABLE
                ),
                permission_fields: match name.as_str() {
                    "issue" | "issueListRead" => Some(vec!["visibility".to_owned()]),
                    GRAPH_CORPUS_AUTHORITY_TABLE => Some(vec!["generation".to_owned()]),
                    _ => None,
                },
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
        schema_hash: Some(CORPUS_SCHEMA_HASH.to_owned()),
        inputs_hash: Some(CORPUS_INPUTS_HASH.to_owned()),
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

fn normalized_served_capture_vector(value: &Value) -> Value {
    let mut normalized = value.clone();
    for capture in normalized
        .as_array_mut()
        .expect("served graph capture vector")
    {
        if let Some(partition_hash) = capture
            .get_mut("dependency")
            .and_then(Value::as_object_mut)
            .and_then(|dependency| dependency.get_mut("partitionHash"))
        {
            *partition_hash = json!("<served-authority-partition>");
        }
    }
    normalized
}

fn normal_graph_evaluations(
    corpus: &Value,
) -> Vec<(
    String,
    GraphQueryCarrierV1,
    HandlerInput,
    RegisteredGraphSubscriptionDependenciesV1,
)> {
    let registration_schema = corpus_schema(&corpus_seed_tables(corpus));
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
            let matcher_input = normalized_matcher_input(&carrier.normalized_plan, &request);
            let registration_demand = GraphSubscriptionRegistrationDemandV1 {
                args: request.args.clone(),
                windows: request.windows.clone(),
                input: matcher_input.clone(),
                permission_values_by_table: request
                    .authority
                    .permission_values_by_table
                    .iter()
                    .map(|(table, permission)| {
                        (
                            table.clone(),
                            GraphRegistrationPermissionValuesV1 {
                                field: permission.field.clone(),
                                allowed_values: permission.allowed_values.clone(),
                            },
                        )
                    })
                    .collect(),
                materialization: materialization.clone(),
                partition: partition.clone(),
            };
            let registered = register_graph_subscription_dependencies(
                &carrier,
                &registration_schema,
                &registration_demand,
                &output.captured_reads,
                &output.capture_attachments,
                &output.captured_query_outputs,
            )
            .unwrap_or_else(|error| panic!("register {query_name}: {error:?}"));
            (query_name, carrier, matcher_input, registered)
        })
        .collect()
}

fn registration_fixture(
    corpus: &Value,
    query_name: &str,
) -> (
    GraphQueryCarrierV1,
    SchemaManifest,
    GraphSubscriptionRegistrationDemandV1,
    GraphEvaluationOutputV1,
) {
    let query = corpus_queries(corpus)
        .find(|query| query["query"] == query_name)
        .unwrap_or_else(|| panic!("missing corpus query {query_name}"));
    let carrier: GraphQueryCarrierV1 =
        serde_json::from_value(query["carrier"].clone()).expect("registration carrier");
    let evidence = corpus["g0ExitObservationEvidence"]
        .as_array()
        .expect("G0 exit evidence")
        .iter()
        .find(|evidence| evidence["graphPlanHash"] == carrier.plan_hash.as_str())
        .unwrap_or_else(|| panic!("missing invocation for {query_name}"));
    let call = &evidence["invocation"];
    let (materialization, partition) = validate_corpus_invocation(&carrier, call, query_name);
    let request = evaluation_request(corpus, call, &materialization, &partition);
    let output = graph_store(corpus, None)
        .evaluate_graph_query(&carrier.normalized_plan, &request)
        .unwrap_or_else(|error| panic!("evaluate {query_name}: {error:?}"));
    let input = normalized_matcher_input(&carrier.normalized_plan, &request);
    let demand = GraphSubscriptionRegistrationDemandV1 {
        args: request.args.clone(),
        windows: request.windows.clone(),
        input,
        permission_values_by_table: request
            .authority
            .permission_values_by_table
            .iter()
            .map(|(table, permission)| {
                (
                    table.clone(),
                    GraphRegistrationPermissionValuesV1 {
                        field: permission.field.clone(),
                        allowed_values: permission.allowed_values.clone(),
                    },
                )
            })
            .collect(),
        materialization,
        partition,
    };
    (
        carrier,
        corpus_schema(&corpus_seed_tables(corpus)),
        demand,
        output,
    )
}

fn first_captured_parent_key_mut(
    reads: &mut [CapturedReadDependency],
) -> Option<&mut GraphRowKeyV1> {
    reads.iter_mut().find_map(|read| {
        let dependency = &mut read.graph.as_mut()?.dependency;
        match dependency {
            GraphCapturedDependencyV1::ParentPoint { parent_key, .. }
            | GraphCapturedDependencyV1::ParentLookupSkipped { parent_key, .. }
            | GraphCapturedDependencyV1::ParentRange { parent_key, .. }
            | GraphCapturedDependencyV1::Membership { parent_key, .. } => Some(parent_key),
            GraphCapturedDependencyV1::PrincipalField { parent_key, .. } => parent_key.as_mut(),
            _ => None,
        }
    })
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
            vec![update_change(
                "issueListRead",
                in_project.clone(),
                &["open"],
            )],
        ),
        (
            "issue-edit-out-of-project".to_owned(),
            vec![update_change(
                "issueListRead",
                out_project.clone(),
                &["open"],
            )],
        ),
        (
            "label-edge-add".to_owned(),
            vec![insert_change("issueLabelRead", label_add)],
        ),
        ("label-edge-remove".to_owned(), vec![label_remove]),
        (
            "comment-add".to_owned(),
            vec![insert_change("comment", comment.clone())],
        ),
        (
            "view-state-write-self".to_owned(),
            vec![insert_change("viewState", view_self)],
        ),
        (
            "view-state-write-other".to_owned(),
            vec![insert_change("viewState", view_other.clone())],
        ),
        (
            "selected-label-membership-change".to_owned(),
            vec![insert_change("issueLabelRead", membership_change)],
        ),
        (
            "ledger-multi-row-multi-table".to_owned(),
            vec![
                update_change("issueListRead", in_project, &["open"]),
                update_change("issueListRead", out_project, &["open"]),
                insert_change("comment", comment),
                insert_change("viewState", view_other),
                insert_change(
                    "matcherUnrelated",
                    json!({"_id":"g2b_unrelated", "value":true}),
                ),
            ],
        ),
    ]
}

fn runtime_capture_artifact(
    runs: &[(
        String,
        GraphQueryCarrierV1,
        HandlerInput,
        RegisteredGraphSubscriptionDependenciesV1,
    )],
) -> Value {
    let captures = runs
        .iter()
        .map(|(query, carrier, _, registered)| {
            json!({
                "query": query,
                "graphPlanHash": carrier.plan_hash,
                "capturedDependencies": registered.reads().iter().filter_map(|read| read.graph.as_ref()).collect::<Vec<_>>(),
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
        RegisteredGraphSubscriptionDependenciesV1,
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
        for (query, carrier, input, registered) in runs {
            let definition = FunctionDefinition::new(
                query,
                FunctionKind::LiveQuery,
                FunctionRuntime::HostPlan(HandlerPlan::GraphQuery(carrier.clone())),
            );
            let decision = live_subscription_match_decision_with_graph_registration(
                &definition,
                input,
                registered,
                &changes,
            );
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

fn served_graph_carriers(
    snapback: &LocalSnapback,
    corpus: &Value,
) -> Vec<(String, GraphQueryCarrierV1, FunctionDefinition)> {
    corpus_queries(corpus)
        .map(|query| {
            let name = query["query"].as_str().unwrap().to_owned();
            let carrier: GraphQueryCarrierV1 =
                serde_json::from_value(query["carrier"].clone()).unwrap();
            let result_contract = snapback
                .graph_result_contract_for_test(&carrier.normalized_plan)
                .unwrap_or_else(|reason| panic!("reify served {name} result contract: {reason:?}"));
            assert_eq!(
                result_contract_hash(&result_contract).expect("reified graph result hash"),
                carrier.normalized_plan.result_contract_hash.as_str(),
                "served {name} installed schema must reconstruct the frozen result contract",
            );
            let mut definition = FunctionDefinition::new(
                &name,
                FunctionKind::LiveQuery,
                FunctionRuntime::HostPlan(HandlerPlan::GraphQuery(carrier.clone())),
            );
            definition.handler_form = Some("plan".to_owned());
            definition.implementation_hash = Some(CORPUS_IMPLEMENTATION_HASH.to_owned());
            definition.args_contract_hash = Some(CORPUS_ARGS_HASH.to_owned());
            definition.result_contract = result_contract;
            definition.result_contract_hash =
                Some(carrier.normalized_plan.result_contract_hash.to_string());
            definition.required_capabilities = vec![
                TargetCapabilityId::ArgsContractV1.as_str().to_owned(),
                TargetCapabilityId::GraphQueryV1.as_str().to_owned(),
                TargetCapabilityId::HostPlanRuntime.as_str().to_owned(),
                TargetCapabilityId::LiveSubscriptions.as_str().to_owned(),
                TargetCapabilityId::ResultContractV1.as_str().to_owned(),
            ];
            (name, carrier, definition)
        })
        .collect()
}

fn graph_corpus_scheduler_mutations(corpus: &Value) -> Vec<FunctionDefinition> {
    let tables = corpus_seed_tables(corpus);
    let disjoint_issue_id = tables["issue"]
        .iter()
        .find(|row| row["id"] == "zbav1_internal_issue")
        .and_then(|row| row["_id"].as_str())
        .expect("scheduler mixed-commit issue row")
        .to_owned();
    let matching_issue_id = tables["issue"]
        .iter()
        .find(|row| row["id"] == "SZ8UieCHMznEsf_Q6EybI")
        .and_then(|row| row["_id"].as_str())
        .expect("scheduler matcher-wake issue row")
        .to_owned();
    let authority_patch = || MutationStep::Patch {
        table: GRAPH_CORPUS_AUTHORITY_TABLE.to_owned(),
        id: ValueExpr::Literal(json!(GRAPH_CORPUS_AUTHORITY_ROW)),
        values: BTreeMap::from([(
            "generation".to_owned(),
            ValueExpr::Arg("generation".to_owned()),
        )]),
    };
    let mut authority = FunctionDefinition::new(
        GRAPH_CORPUS_AUTHORITY_MUTATION,
        FunctionKind::Mutation,
        FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
            owner_write_checks: Vec::new(),
            steps: vec![authority_patch()],
            return_value: None,
        })),
    );
    authority.authority_creating = true;
    let mut mixed = FunctionDefinition::new(
        GRAPH_CORPUS_MIXED_MUTATION,
        FunctionKind::Mutation,
        FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
            owner_write_checks: Vec::new(),
            steps: vec![
                MutationStep::Patch {
                    table: "issue".to_owned(),
                    id: ValueExpr::Literal(json!(disjoint_issue_id.clone())),
                    values: BTreeMap::from([(
                        "title".to_owned(),
                        ValueExpr::Arg("title".to_owned()),
                    )]),
                },
                authority_patch(),
            ],
            return_value: None,
        })),
    );
    mixed.authority_creating = true;
    let matching_data = FunctionDefinition::new(
        GRAPH_CORPUS_MATCHING_DATA_MUTATION,
        FunctionKind::Mutation,
        FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
            owner_write_checks: Vec::new(),
            steps: vec![MutationStep::Patch {
                table: "issue".to_owned(),
                id: ValueExpr::Literal(json!(matching_issue_id)),
                values: BTreeMap::from([("title".to_owned(), ValueExpr::Arg("title".to_owned()))]),
            }],
            return_value: None,
        })),
    );
    let disjoint_data = FunctionDefinition::new(
        GRAPH_CORPUS_DISJOINT_DATA_MUTATION,
        FunctionKind::Mutation,
        FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
            owner_write_checks: Vec::new(),
            steps: vec![MutationStep::Patch {
                table: "issue".to_owned(),
                id: ValueExpr::Literal(json!(disjoint_issue_id)),
                values: BTreeMap::from([("title".to_owned(), ValueExpr::Arg("title".to_owned()))]),
            }],
            return_value: None,
        })),
    );
    vec![authority, mixed, matching_data, disjoint_data]
}

fn served_graph_manifest(
    corpus: &Value,
    carriers: &[(String, GraphQueryCarrierV1, FunctionDefinition)],
) -> FunctionManifest {
    FunctionManifest {
        app_id: "zerobugs-graph-g2-corpus".to_owned(),
        bundle_hash: Some(CORPUS_BUNDLE_HASH.to_owned()),
        inputs_hash: Some(CORPUS_INPUTS_HASH.to_owned()),
        acknowledged_experimental_capabilities: vec![
            TargetCapabilityId::ArgsContractV1.as_str().to_owned(),
            TargetCapabilityId::GraphQueryV1.as_str().to_owned(),
            TargetCapabilityId::ResultContractV1.as_str().to_owned(),
        ],
        functions: carriers
            .iter()
            .map(|(_, _, definition)| definition.clone())
            .chain(graph_corpus_scheduler_mutations(corpus))
            .collect(),
        ..FunctionManifest::default()
    }
}

fn scheduler_invocation_from_observation(call: &Value, observation: &Value) -> Value {
    json!({
        "planHash": call["planHash"],
        "args": call["args"],
        "windows": call["windows"],
        "advancedNodeId": call["advancedNodeId"],
        "materialization": observation["materialization"],
        "partition": observation["partition"],
        "authorizationVersion": observation["authorizationVersion"],
        "evaluationCut": observation["evaluationCut"],
    })
}

fn graph_scheduler_memo_fixture(
    corpus: &Value,
) -> (
    LocalSnapback,
    String,
    Value,
    GraphEvaluationAuthorityV1,
    snapback::auth::invalidation::AuthorizationInvalidationConnection,
) {
    let case = corpus["cases"]
        .as_array()
        .expect("graph cases")
        .iter()
        .find(|case| case["caseKind"] == "authorityTransition")
        .expect("authority scheduler case");
    let call = case["invocations"]["before"].clone();
    let authorization: snapback_types::storage::AuthorizationVersion =
        serde_json::from_value(call["authorizationVersion"].clone())
            .expect("scheduler authorization version");
    let mut snapback = graph_store(corpus, None);
    snapback.declare_graph_query_v1_capability();
    let carriers = served_graph_carriers(&snapback, corpus);
    let diagnostics = snapback.load_functions(served_graph_manifest(corpus, &carriers));
    assert!(
        diagnostics
            .iter()
            .all(|diagnostic| diagnostic.severity != DiagnosticSeverity::Error),
        "scheduler memo graph manifest diagnostics: {diagnostics:?}",
    );
    let (name, _, _) = carriers
        .iter()
        .find(|(_, carrier, _)| carrier.plan_hash.as_str() == call["planHash"].as_str().unwrap())
        .expect("scheduler memo carrier");
    let principal = call["partition"]["class3"]["principalDataScope"]["userId"]
        .as_str()
        .expect("scheduler memo principal");
    let authority = corpus_authority(corpus, principal);
    snapback.install_graph_serving_authority_context_for_test(
        name,
        GraphServingAuthorityContextV1 {
            evaluation: authority.clone(),
            class2: serde_json::from_value(call["partition"]["class2"].clone())
                .expect("scheduler memo class-2 inputs"),
        },
    );
    let connection = configure_graph_corpus_scheduler(
        &mut snapback,
        authorization,
        GRAPH_CORPUS_DATA_VERSION_STREAM,
    )
    .expect("configure graph memo scheduler");
    (snapback, name.clone(), call, authority, connection)
}

fn graph_scheduler_memo_input(
    call: &Value,
    authority: &GraphEvaluationAuthorityV1,
    connection_id: &str,
    query_instance_id: u64,
    args_override: Option<Value>,
) -> LiveSubscribeInput {
    let args = args_override.unwrap_or_else(|| call["args"].clone());
    let mut args = args.as_object().expect("scheduler memo args").clone();
    args.insert(
        snapback_engine::graph_evaluator::GRAPH_SERVING_DEMAND_ARG.to_owned(),
        json!({
            "format":"snapback.graph-serving-demand.v1",
            "windows":call["windows"],
            "advancedNodeId":call["advancedNodeId"],
            "priorWindowLedgers":[],
        }),
    );
    LiveSubscribeInput {
        connection_id: connection_id.to_owned(),
        input: HandlerInput {
            args: Value::Object(args),
            auth: authority.auth.clone(),
            read_set: Vec::new(),
            correlation: None,
            ctx_ledger: None,
        },
        authorization_namespace: Some(QueryNamespace {
            client_store_id: "g3-a-graph-corpus".to_owned(),
            query_key: "same-authority-partition-memo".to_owned(),
            query_instance_id,
        }),
        supersedes: None,
        resume_from_token: None,
    }
}

fn execute_served_scheduler_case(corpus: &Value, case: &Value) -> Value {
    let before = &case["invocations"]["before"];
    let after = &case["invocations"]["after"];
    assert_eq!(before["planHash"], after["planHash"]);
    assert_eq!(before["args"], after["args"]);
    assert_eq!(before["windows"], after["windows"]);
    assert_eq!(before["advancedNodeId"], after["advancedNodeId"]);
    let authorization: snapback_types::storage::AuthorizationVersion =
        serde_json::from_value(before["authorizationVersion"].clone())
            .expect("frozen scheduler predecessor authorization version");
    assert_eq!(
        authorization.incarnation,
        GRAPH_CORPUS_AUTHORIZATION_INCARNATION,
    );

    let mut snapback = graph_store(corpus, None);
    snapback.declare_graph_query_v1_capability();
    let carriers = served_graph_carriers(&snapback, corpus);
    let diagnostics = snapback.load_functions(served_graph_manifest(corpus, &carriers));
    assert!(
        diagnostics
            .iter()
            .all(|diagnostic| diagnostic.severity != DiagnosticSeverity::Error),
        "scheduler graph manifest diagnostics: {diagnostics:?}",
    );
    let (name, _carrier, _) = carriers
        .iter()
        .find(|(_, carrier, _)| carrier.plan_hash.as_str() == before["planHash"].as_str().unwrap())
        .expect("scheduler carrier");
    let principal = before["partition"]["class3"]["principalDataScope"]["userId"]
        .as_str()
        .unwrap_or("principal_ordinary");
    let authority = corpus_authority(corpus, principal);
    snapback.install_graph_serving_authority_context_for_test(
        name,
        GraphServingAuthorityContextV1 {
            evaluation: authority.clone(),
            class2: serde_json::from_value(before["partition"]["class2"].clone())
                .expect("scheduler class-2 inputs"),
        },
    );
    let connection = configure_graph_corpus_scheduler(
        &mut snapback,
        authorization,
        GRAPH_CORPUS_DATA_VERSION_STREAM,
    )
    .expect("configure exact graph corpus scheduler");
    let connection_id = format!("g2-c-scheduler-{}", case["id"].as_str().unwrap());
    let mut args = before["args"].as_object().expect("scheduler args").clone();
    args.insert(
        snapback_engine::graph_evaluator::GRAPH_SERVING_DEMAND_ARG.to_owned(),
        json!({
            "format":"snapback.graph-serving-demand.v1",
            "windows":before["windows"],
            "advancedNodeId":before["advancedNodeId"],
            "priorWindowLedgers":[],
        }),
    );
    let established = subscribe_graph_corpus_case(
        &mut snapback,
        name,
        LiveSubscribeInput {
            connection_id: connection_id.clone(),
            input: HandlerInput {
                args: Value::Object(args),
                auth: authority.auth,
                read_set: Vec::new(),
                correlation: None,
                ctx_ledger: None,
            },
            authorization_namespace: Some(QueryNamespace {
                client_store_id: "g2-c-graph-corpus".to_owned(),
                query_key: format!("{name}:{}", case["id"].as_str().unwrap()),
                query_instance_id: if case["caseKind"] == "mixedCommit" {
                    2
                } else {
                    1
                },
            }),
            supersedes: None,
            resume_from_token: None,
        },
        connection,
    )
    .expect("serve exact scheduler corpus invocation");
    assert!(established.authorization_scope.is_some());
    assert!(snapback.drain_live_stream(&connection_id).is_empty());
    let before_observation = snapback
        .graph_serving_observation_for_test(&established.subscription_id)
        .expect("served scheduler predecessor observation");
    assert_eq!(
        before_observation["instanceHash"],
        before_observation["materialization"]["graphInstanceHash"],
    );
    assert!(
        refresh_graph_corpus_scheduler(&mut snapback, Some(&established.subscription_id))
            .expect("prime scheduler-case graph memo"),
    );
    let primed_entries = graph_corpus_memo_entries(&snapback);
    assert_eq!(primed_entries.as_array().unwrap().len(), 1);
    assert_eq!(
        primed_entries[0]["authorizationVersion"],
        before["authorizationVersion"],
    );
    assert_eq!(primed_entries[0]["evaluationCut"], before["evaluationCut"]);
    let _ = snapback.drain_live_stream(&connection_id);
    let _ = graph_corpus_authorization_frames(&mut snapback, &connection_id)
        .expect("drain graph memo priming projection");
    let memo_before = snapback
        .inspect_core()
        .expect("inspect scheduler memo before transition")
        .live_evaluation;

    let (mutation, mutation_args) = if case["caseKind"] == "mixedCommit" {
        (
            GRAPH_CORPUS_MIXED_MUTATION,
            json!({"generation":1,"title":"policy-extension-v1 internal issue (mixed commit)"}),
        )
    } else {
        (GRAPH_CORPUS_AUTHORITY_MUTATION, json!({"generation":1}))
    };
    let committed = invoke_graph_corpus_mutation(
        &mut snapback,
        mutation,
        HandlerInput {
            args: mutation_args,
            ..HandlerInput::default()
        },
    )
    .expect("commit exact scheduler corpus transition");
    assert!(
        snapback.flush_pending_live_fanout(),
        "the served scheduler must execute the fenced restoration",
    );
    let mut frame_strings = snapback.drain_live_stream(&connection_id);
    frame_strings.extend(
        graph_corpus_authorization_frames(&mut snapback, &connection_id)
            .expect("project scheduler authorization frames"),
    );
    let frames = frame_strings
        .iter()
        .map(|frame| serde_json::from_str::<Value>(frame).expect("scheduler frame JSON"))
        .collect::<Vec<_>>();
    let successor = &case["commit"]["afterAuthorizationVersion"];
    let mut emitted_authorization_frames = Vec::new();
    for (ordinal, frame) in frames.iter().enumerate() {
        if frame["kind"] != "authorization_invalidation" {
            continue;
        }
        let authorization_version = &frame["obligation"]["witness"]["authorization"];
        let kind = if frame.get("snapshot").is_some() {
            "delivery"
        } else {
            "fence"
        };
        if kind == "delivery" {
            assert_eq!(
                authorization_version, successor,
                "no predecessor-version graph delivery may cross the authority fence",
            );
        }
        emitted_authorization_frames.push(json!({
            "ordinal": ordinal,
            "kind": kind,
            "authorizationVersion": authorization_version,
        }));
    }
    let fences = emitted_authorization_frames
        .iter()
        .filter(|entry| entry["kind"] == "fence")
        .collect::<Vec<_>>();
    let deliveries = emitted_authorization_frames
        .iter()
        .filter(|entry| entry["kind"] == "delivery")
        .collect::<Vec<_>>();
    assert!(!fences.is_empty(), "at least one authority fence frame");
    assert_eq!(
        deliveries.len(),
        1,
        "exactly one fenced graph snapshot; frames={frames:#?}; diagnostics={:#?}",
        snapback
            .inspect_core()
            .expect("inspect scheduler diagnostics")
            .recent_diagnostics,
    );
    assert!(
        fences[0]["ordinal"].as_u64() < deliveries[0]["ordinal"].as_u64(),
        "the authority fence must precede graph delivery",
    );
    assert!(
        fences
            .iter()
            .all(|frame| frame["authorizationVersion"] == *successor),
        "every emitted fence names the successor authorization version",
    );
    assert_eq!(deliveries[0]["authorizationVersion"], *successor);
    let observed = vec![fences[0].clone(), deliveries[0].clone()];

    let memo_after = snapback
        .inspect_core()
        .expect("inspect scheduler memo after transition")
        .live_evaluation;
    let post_fence_evaluations = memo_after.evaluations_executed - memo_before.evaluations_executed;
    assert!(
        post_fence_evaluations >= 1,
        "the post-fence graph restoration evaluates fresh",
    );
    assert!(
        memo_after.memo_misses > memo_before.memo_misses,
        "the restored successor evaluation must miss rather than serving predecessor bytes",
    );
    assert_eq!(memo_after.memo_hits - memo_before.memo_hits, 0);
    assert!(
        memo_after.memo_retirements > memo_before.memo_retirements,
        "the authorization advance retires the predecessor graph memo",
    );
    let successor_entries = graph_corpus_memo_entries(&snapback);
    assert_eq!(successor_entries.as_array().unwrap().len(), 1);
    assert_eq!(successor_entries[0]["authorizationVersion"], *successor);
    assert_eq!(successor_entries[0]["evaluationCut"], committed.version);

    let after_observation = snapback
        .graph_serving_observation_for_test(&established.subscription_id)
        .expect("served scheduler successor observation");
    assert_eq!(after_observation["evaluationCut"], committed.version);
    let actual_before = scheduler_invocation_from_observation(before, &before_observation);
    let actual_after = scheduler_invocation_from_observation(after, &after_observation);
    if std::env::var_os("SNAPBACK_FREEZE_GRAPH_G2_C").is_none() {
        assert_eq!(
            &actual_before, before,
            "frozen predecessor invocation drifted"
        );
        assert_eq!(&actual_after, after, "frozen successor invocation drifted");
        assert_eq!(
            Value::Array(observed.clone()),
            case["observed"],
            "frozen emitted-frame evidence drifted"
        );
    }
    assert_eq!(
        case["commit"]["authorityEvents"],
        json!([{"kind":"authorization-epoch-change","cause":"permission-backing-write"}]),
        "the frozen event must name the real mutation path",
    );
    let expected_data_changes = if case["caseKind"] == "mixedCommit" {
        json!([{"table":"issue","rowId":"issue_ded0c2976675c34f4756035d"}])
    } else {
        json!([])
    };
    assert_eq!(case["commit"]["dataChanges"], expected_data_changes);
    json!({
        "id": case["id"],
        "caseKind": case["caseKind"],
        "invocations": {"before":actual_before,"after":actual_after},
        "commit": case["commit"],
        "observed": observed,
    })
}

fn drain_graph_scheduler_snapshots(
    snapback: &mut LocalSnapback,
    connection_id: &str,
) -> Vec<Value> {
    let mut frames = snapback.drain_live_stream(connection_id);
    frames.extend(
        graph_corpus_authorization_frames(snapback, connection_id)
            .expect("project graph scheduler authorization frames"),
    );
    frames
        .into_iter()
        .map(|frame| serde_json::from_str::<Value>(&frame).expect("graph scheduler frame JSON"))
        .filter(|frame| {
            frame["kind"] == "authorization_invalidation" && frame.get("snapshot").is_some()
        })
        .collect()
}

#[test]
fn graph_scheduler_case_same_key_memoizes_one_turn_and_delivers_three() {
    const N: usize = 3;
    let corpus = graph_corpus();
    let (mut snapback, name, call, authority, connection) = graph_scheduler_memo_fixture(&corpus);
    let connection_id = "g3-a-same-key";
    let mut subscriptions = Vec::new();
    for ordinal in 0..N {
        let established = subscribe_graph_corpus_case(
            &mut snapback,
            &name,
            graph_scheduler_memo_input(
                &call,
                &authority,
                connection_id,
                (ordinal + 1) as u64,
                None,
            ),
            connection.clone(),
        )
        .expect("subscribe same-key graph observer");
        subscriptions.push(established.subscription_id);
    }
    assert!(snapback.drain_live_stream(connection_id).is_empty());
    let before = snapback.inspect_core().expect("inspect before graph memo");

    assert!(
        refresh_graph_corpus_scheduler(&mut snapback, None)
            .expect("refresh same-key graph observers"),
    );

    let after = snapback.inspect_core().expect("inspect after graph memo");
    assert_eq!(
        after.live_evaluation.evaluations_started - before.live_evaluation.evaluations_started,
        N as u64,
        "delivery remains one scheduler turn per subscription",
    );
    assert_eq!(
        after.live_evaluation.evaluations_executed - before.live_evaluation.evaluations_executed,
        1,
    );
    assert_eq!(
        after.live_evaluation.memo_misses - before.live_evaluation.memo_misses,
        1,
    );
    assert_eq!(
        after.live_evaluation.memo_hits - before.live_evaluation.memo_hits,
        (N - 1) as u64,
    );
    assert_eq!(
        after.live_delivery.total_deliveries - before.live_delivery.total_deliveries,
        N as u64,
        "a hit skips evaluation only, never per-subscription delivery",
    );
    let snapshots = drain_graph_scheduler_snapshots(&mut snapback, connection_id);
    assert_eq!(snapshots.len(), N);
    let delivered_subscriptions = snapshots
        .iter()
        .map(|frame| frame["snapshot"]["subscriptionId"].as_str().unwrap())
        .collect::<BTreeSet<_>>();
    assert_eq!(
        delivered_subscriptions,
        subscriptions.iter().map(String::as_str).collect(),
    );
    assert!(snapshots.iter().all(|frame| {
        frame.get("obligation").is_some()
            && frame["obligation"]["witness"]["authorization"] == call["authorizationVersion"]
    }));
    let row_bytes = snapshots
        .iter()
        .map(|frame| serde_json::to_vec(&frame["snapshot"]["rows"]).unwrap())
        .collect::<Vec<_>>();
    assert!(row_bytes.windows(2).all(|pair| pair[0] == pair[1]));

    let entries = graph_corpus_memo_entries(&snapback);
    assert_eq!(entries.as_array().unwrap().len(), 1);
    assert_eq!(entries[0]["holders"].as_array().unwrap().len(), N);
    let observation = snapback
        .graph_serving_observation_for_test(&subscriptions[0])
        .expect("same-key graph observation");
    assert_eq!(
        entries[0]["materializationHash"],
        observation["materializationHash"]
    );
    assert_ne!(
        entries[0]["materializationHash"], observation["instanceHash"],
        "the memo key uses the outer materialization identity, never the inner instance hash",
    );
    assert_eq!(
        entries[0]["materializationIdentity"]["materializationHash"],
        observation["materializationHash"],
    );
    assert_eq!(
        entries[0]["authorityPartitionHash"],
        observation["partitionHash"]
    );
}

#[test]
fn graph_scheduler_case_matcher_wake_retires_then_reevaluates_once() {
    const N: usize = 3;
    let corpus = graph_corpus();
    let (mut snapback, name, call, authority, connection) = graph_scheduler_memo_fixture(&corpus);
    let connection_id = "g3-a-matcher-wake";
    let visible_args = json!({
        "sourceIssueID":"SZ8UieCHMznEsf_Q6EybI",
        "selectedLabelIDs":[],
    });
    for ordinal in 0..N {
        subscribe_graph_corpus_case(
            &mut snapback,
            &name,
            graph_scheduler_memo_input(
                &call,
                &authority,
                connection_id,
                (ordinal + 1) as u64,
                Some(visible_args.clone()),
            ),
            connection.clone(),
        )
        .expect("subscribe matcher-wake graph observer");
    }
    assert!(refresh_graph_corpus_scheduler(&mut snapback, None).unwrap());
    let _ = drain_graph_scheduler_snapshots(&mut snapback, connection_id);
    let before = snapback
        .inspect_core()
        .expect("inspect before matcher wake");
    let replacement_title = "G3-A matcher wake replacement";

    let committed = invoke_graph_corpus_mutation(
        &mut snapback,
        GRAPH_CORPUS_MATCHING_DATA_MUTATION,
        HandlerInput {
            args: json!({"title":replacement_title}),
            ..HandlerInput::default()
        },
    )
    .expect("commit matching graph data change");
    assert!(snapback.flush_pending_live_fanout());

    let after = snapback.inspect_core().expect("inspect after matcher wake");
    assert_eq!(
        after.live_evaluation.evaluations_executed - before.live_evaluation.evaluations_executed,
        1,
    );
    assert_eq!(
        after.live_evaluation.memo_misses - before.live_evaluation.memo_misses,
        1,
    );
    assert_eq!(
        after.live_evaluation.memo_hits - before.live_evaluation.memo_hits,
        (N - 1) as u64,
    );
    assert!(
        after.live_evaluation.memo_retirements > before.live_evaluation.memo_retirements,
        "the first holder wake retires the shared predecessor entry",
    );
    let snapshots = drain_graph_scheduler_snapshots(&mut snapback, connection_id);
    assert_eq!(snapshots.len(), N);
    assert!(snapshots.iter().all(|frame| {
        serde_json::to_string(&frame["snapshot"]["rows"])
            .unwrap()
            .contains(replacement_title)
    }));
    let entries = graph_corpus_memo_entries(&snapback);
    assert_eq!(entries.as_array().unwrap().len(), 1);
    assert_eq!(entries[0]["evaluationCut"], committed.version);
}

#[test]
fn graph_scheduler_case_materialization_and_partition_keys_do_not_share() {
    let corpus = graph_corpus();
    let (mut snapback, name, call, authority, connection) = graph_scheduler_memo_fixture(&corpus);
    let connection_id = "g3-a-mixed-keys";
    let alternate_args = json!({
        "sourceIssueID":"SZ8UieCHMznEsf_Q6EybI",
        "selectedLabelIDs":[],
    });
    subscribe_graph_corpus_case(
        &mut snapback,
        &name,
        graph_scheduler_memo_input(&call, &authority, connection_id, 1, None),
        connection.clone(),
    )
    .expect("subscribe base graph key");
    subscribe_graph_corpus_case(
        &mut snapback,
        &name,
        graph_scheduler_memo_input(&call, &authority, connection_id, 2, Some(alternate_args)),
        connection.clone(),
    )
    .expect("subscribe different materialization");
    subscribe_graph_corpus_partition_case(
        &mut snapback,
        &name,
        graph_scheduler_memo_input(&call, &authority, connection_id, 3, None),
        connection,
    )
    .expect("subscribe different authority partition");
    let before = snapback.inspect_core().expect("inspect before mixed keys");

    assert!(refresh_graph_corpus_scheduler(&mut snapback, None).unwrap());

    let after = snapback.inspect_core().expect("inspect after mixed keys");
    assert_eq!(
        after.live_evaluation.evaluations_executed - before.live_evaluation.evaluations_executed,
        3,
    );
    assert_eq!(
        after.live_evaluation.memo_misses - before.live_evaluation.memo_misses,
        3,
    );
    assert_eq!(
        after.live_evaluation.memo_hits - before.live_evaluation.memo_hits,
        0,
    );
    let entries = graph_corpus_memo_entries(&snapback);
    let entries = entries.as_array().unwrap();
    assert_eq!(entries.len(), 3);
    assert_eq!(
        entries
            .iter()
            .map(|entry| entry["materializationHash"].as_str().unwrap())
            .collect::<BTreeSet<_>>()
            .len(),
        2,
    );
    assert_eq!(
        entries
            .iter()
            .map(|entry| entry["authorityPartitionHash"].as_str().unwrap())
            .collect::<BTreeSet<_>>()
            .len(),
        2,
    );
}

#[test]
fn graph_scheduler_case_evaluation_cut_does_not_share() {
    let corpus = graph_corpus();
    let (mut snapback, name, call, authority, connection) = graph_scheduler_memo_fixture(&corpus);
    let connection_id = "g3-a-cut-isolation";
    let disjoint_args = json!({
        "sourceIssueID":"SZ8UieCHMznEsf_Q6EybI",
        "selectedLabelIDs":[],
    });
    let first = subscribe_graph_corpus_case(
        &mut snapback,
        &name,
        graph_scheduler_memo_input(
            &call,
            &authority,
            connection_id,
            1,
            Some(disjoint_args.clone()),
        ),
        connection.clone(),
    )
    .expect("subscribe predecessor-cut graph");
    assert!(refresh_graph_corpus_scheduler(&mut snapback, Some(&first.subscription_id)).unwrap(),);
    let predecessor_entries = graph_corpus_memo_entries(&snapback);
    assert_eq!(predecessor_entries.as_array().unwrap().len(), 1);
    let predecessor_cut = predecessor_entries[0]["evaluationCut"].as_u64().unwrap();
    let _ = drain_graph_scheduler_snapshots(&mut snapback, connection_id);

    let committed = invoke_graph_corpus_mutation(
        &mut snapback,
        GRAPH_CORPUS_DISJOINT_DATA_MUTATION,
        HandlerInput {
            args: json!({"title":"G3-A disjoint cut advance"}),
            ..HandlerInput::default()
        },
    )
    .expect("commit disjoint cut advance");
    assert!(committed.version > predecessor_cut);
    let second = subscribe_graph_corpus_case(
        &mut snapback,
        &name,
        graph_scheduler_memo_input(&call, &authority, connection_id, 2, Some(disjoint_args)),
        connection,
    )
    .expect("subscribe successor-cut graph");
    let before = snapback
        .inspect_core()
        .expect("inspect before cut isolation");

    assert!(refresh_graph_corpus_scheduler(&mut snapback, Some(&second.subscription_id)).unwrap(),);

    let after = snapback
        .inspect_core()
        .expect("inspect after cut isolation");
    assert_eq!(
        after.live_evaluation.evaluations_executed - before.live_evaluation.evaluations_executed,
        1,
    );
    assert_eq!(
        after.live_evaluation.memo_misses - before.live_evaluation.memo_misses,
        1,
    );
    assert_eq!(
        after.live_evaluation.memo_hits - before.live_evaluation.memo_hits,
        0,
    );
    let entries = graph_corpus_memo_entries(&snapback);
    assert_eq!(entries.as_array().unwrap().len(), 2);
    assert_eq!(
        entries
            .as_array()
            .unwrap()
            .iter()
            .map(|entry| entry["evaluationCut"].as_u64().unwrap())
            .collect::<BTreeSet<_>>(),
        BTreeSet::from([predecessor_cut, committed.version]),
    );
}

#[test]
fn graph_scheduler_case_tiny_budget_evicts_oldest_and_reevaluates() {
    let corpus = graph_corpus();
    let (mut snapback, name, call, authority, connection) = graph_scheduler_memo_fixture(&corpus);
    let connection_id = "g3-a-eviction";
    let alternate_args = json!({
        "sourceIssueID":"SZ8UieCHMznEsf_Q6EybI",
        "selectedLabelIDs":[],
    });
    let subscriptions = [None, Some(alternate_args), None]
        .into_iter()
        .enumerate()
        .map(|(ordinal, args)| {
            subscribe_graph_corpus_case(
                &mut snapback,
                &name,
                graph_scheduler_memo_input(
                    &call,
                    &authority,
                    connection_id,
                    (ordinal + 1) as u64,
                    args,
                ),
                connection.clone(),
            )
            .expect("subscribe eviction graph observer")
            .subscription_id
        })
        .collect::<Vec<_>>();
    set_graph_corpus_memo_limits(&mut snapback, 1, usize::MAX);
    let before = snapback
        .inspect_core()
        .expect("inspect before graph eviction");
    for subscription_id in &subscriptions {
        assert!(refresh_graph_corpus_scheduler(&mut snapback, Some(subscription_id)).unwrap());
    }

    let after = snapback
        .inspect_core()
        .expect("inspect after graph eviction");
    assert_eq!(
        after.live_evaluation.evaluations_executed - before.live_evaluation.evaluations_executed,
        3,
    );
    assert_eq!(
        after.live_evaluation.memo_misses - before.live_evaluation.memo_misses,
        3,
    );
    assert_eq!(
        after.live_evaluation.memo_hits - before.live_evaluation.memo_hits,
        0,
    );
    assert!(after.live_evaluation.memo_evictions - before.live_evaluation.memo_evictions >= 2,);
    assert_eq!(
        graph_corpus_memo_entries(&snapback)
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let snapshots = drain_graph_scheduler_snapshots(&mut snapback, connection_id);
    assert_eq!(snapshots.len(), subscriptions.len());
    let delivered = subscriptions
        .iter()
        .map(|subscription_id| {
            let snapshot = snapshots
                .iter()
                .find(|frame| frame["snapshot"]["subscriptionId"] == *subscription_id)
                .expect("targeted graph refresh delivered its own snapshot");
            serde_json::to_vec(&snapshot["snapshot"]["rows"]).unwrap()
        })
        .collect::<Vec<_>>();
    assert_eq!(delivered[0], delivered[2]);
    assert_ne!(delivered[0], delivered[1]);
}

/// Establish all three normal-fixture corpus graphs through the same
/// admitted function-manifest, live-subscription, evaluator, and attested
/// registration path used by serving. The frozen commit shapes are then
/// replayed against those served registrations without publishing synthetic
/// deliveries, keeping D2-H2 measurement separate from scheduler effects.
fn served_graph_execution_artifacts(corpus: &Value) -> (Value, Value) {
    let mut snapback = graph_store(corpus, None);
    snapback.declare_graph_query_v1_capability();

    let carriers = served_graph_carriers(&snapback, corpus);
    let diagnostics = snapback.load_functions(served_graph_manifest(corpus, &carriers));
    assert!(
        diagnostics
            .iter()
            .all(|diagnostic| diagnostic.severity != DiagnosticSeverity::Error),
        "served graph manifest diagnostics: {diagnostics:?}",
    );

    let mut observations = Vec::new();
    let mut subscriptions = Vec::new();
    for evidence in corpus["g0ExitObservationEvidence"]
        .as_array()
        .expect("G0 exit evidence")
    {
        let plan_hash = evidence["graphPlanHash"].as_str().unwrap();
        let (name, carrier, _) = carriers
            .iter()
            .find(|(_, carrier, _)| carrier.plan_hash.as_str() == plan_hash)
            .unwrap_or_else(|| panic!("served carrier for {plan_hash}"));
        let call = &evidence["invocation"];
        let principal = call["partition"]["class3"]["principalDataScope"]["userId"]
            .as_str()
            .unwrap_or("principal_ordinary");
        let authority = corpus_authority(corpus, principal);
        snapback.install_graph_serving_authority_context_for_test(
            name,
            GraphServingAuthorityContextV1 {
                evaluation: authority.clone(),
                class2: serde_json::from_value(call["partition"]["class2"].clone())
                    .expect("served class-2 partition inputs"),
            },
        );
        let mut args = call["args"].as_object().expect("served graph args").clone();
        args.insert(
            snapback_engine::graph_evaluator::GRAPH_SERVING_DEMAND_ARG.to_owned(),
            json!({
                "format":"snapback.graph-serving-demand.v1",
                "windows":call["windows"],
                "advancedNodeId":call["advancedNodeId"],
                "priorWindowLedgers":[],
            }),
        );
        let established = snapback
            .subscribe_live(
                name,
                LiveSubscribeInput {
                    connection_id: format!("g2-c-served-{name}"),
                    input: HandlerInput {
                        args: Value::Object(args),
                        auth: authority.auth,
                        read_set: Vec::new(),
                        correlation: None,
                        ctx_ledger: None,
                    },
                    authorization_namespace: None,
                    supersedes: None,
                    resume_from_token: None,
                },
            )
            .unwrap_or_else(|error| panic!("serve graph {name}: {error:?}"));
        let snapshot = established.snapshot.expect("served initial graph snapshot");
        let expected_rows: Vec<Value> =
            serde_json::from_str(evidence["resultBytes"].as_str().unwrap())
                .expect("frozen result bytes");
        assert_eq!(snapshot.rows, expected_rows, "served {name} result bytes");
        let expected_execution = corpus["cases"]
            .as_array()
            .expect("graph cases")
            .iter()
            .find(|case| {
                case["plan"]["planHash"] == plan_hash
                    && case["expect"]["resultBytes"] == evidence["resultBytes"]
            })
            .unwrap_or_else(|| panic!("frozen execution evidence for served {name}"));
        let observation = snapback
            .graph_serving_observation_for_test(&established.subscription_id)
            .unwrap_or_else(|| panic!("served graph observation for {name}"));
        assert_eq!(
            observation["structuralWork"], expected_execution["expect"]["structuralWork"],
            "served {name} structural work",
        );
        assert_eq!(
            observation["windowLedgers"], expected_execution["expect"]["windowLedgers"],
            "served {name} window ledgers",
        );
        assert_eq!(
            normalized_served_capture_vector(&observation["capturedDependencies"]),
            normalized_served_capture_vector(&evidence["capturedDependencies"]),
            "served {name} evaluator captures must equal the G2-B oracle after normalizing only the rotating authority-partition identity",
        );
        let captured_dependencies = observation["capturedDependencies"]
            .as_array()
            .expect("served captured dependencies");
        let mut captured_by_node_kind = BTreeMap::<String, u64>::new();
        for captured in captured_dependencies {
            *captured_by_node_kind
                .entry(
                    captured["nodeKind"]
                        .as_str()
                        .expect("served capture node kind")
                        .to_owned(),
                )
                .or_default() += 1;
        }
        observations.push(json!({
            "query":name,
            "graphPlanHash":carrier.plan_hash,
            "fixture":"normal-seed-v1",
            "structuralWork":observation["structuralWork"],
            "windowLedgers":observation["windowLedgers"],
            "instanceHash":observation["instanceHash"],
            "captureRegistration":{
                "source":"served-evaluator-attested",
                "capturedDependencyCount":captured_dependencies.len(),
                "byNodeKind":captured_by_node_kind,
                "oracleComparison":"exact after normalizing only the rotating authority-partition identity",
            },
        }));
        subscriptions.push((name.clone(), carrier.clone(), established.subscription_id));
    }

    let mut normal_group_measurements = measure_graph_serving_groups(&mut snapback)
        .expect("measure actual normal-fixture serving groups")
        .as_array()
        .expect("serving group measurement array")
        .iter()
        .map(|measurement| {
            let groups = measurement["groups"]
                .as_array()
                .expect("serving measurement groups")
                .iter()
                .enumerate()
                .map(|(group_ordinal, group)| {
                    json!({
                        "groupOrdinal":group_ordinal,
                        "resultBytes":group["resultBytes"],
                        "dependencyBytes":group["dependencyBytes"],
                        "groupStateBytes":group["retainedGroupStateBytes"],
                    })
                })
                .collect::<Vec<_>>();
            json!({
                "format":"snapback.graph-g0-exit-observation.v1",
                "fixture":"normal-seed-v1",
                "graphPlanHash":measurement["graphPlanHash"],
                "groupCount":measurement["groupCount"],
                "subscriberFanout":measurement["subscriberFanout"],
                "groups":groups,
                "measurementSource":"served-retained-live-evaluation-memo",
            })
        })
        .collect::<Vec<_>>();
    normal_group_measurements.sort_by(|left, right| {
        left["graphPlanHash"]
            .as_str()
            .cmp(&right["graphPlanHash"].as_str())
    });
    assert_eq!(normal_group_measurements.len(), 3);
    for measurement in &normal_group_measurements {
        assert_eq!(measurement["groupCount"], 1);
        assert_eq!(measurement["subscriberFanout"], 1);
        assert_eq!(measurement["groups"].as_array().unwrap().len(), 1);
    }

    let scheduler_cases = corpus["cases"]
        .as_array()
        .expect("graph cases")
        .iter()
        .filter(|case| {
            matches!(
                case["caseKind"].as_str(),
                Some("authorityTransition" | "mixedCommit")
            )
        })
        .map(|case| execute_served_scheduler_case(corpus, case))
        .collect::<Vec<_>>();
    assert_eq!(scheduler_cases.len(), 2);

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
    let commits = graph_match_replay_commits(corpus);
    for (commit_id, changes) in &commits {
        for (query, _, subscription_id) in &subscriptions {
            let decision = snapback
                .replay_graph_matcher_for_test(subscription_id, changes)
                .unwrap_or_else(|| panic!("served matcher registration for {query}"));
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
    let totals = summary.values().fold([0_u64; 3], |mut totals, counts| {
        totals[0] += counts[0];
        totals[1] += counts[1];
        totals[2] += counts[2];
        totals
    });
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

    (
        content_digest(json!({
            "format":"snapback.graph-served-observations.g2-c.v1",
            "version":1,
            "servingGate":{
                "targetCapability":"graph_query_v1",
                "killSwitchControl":"SNAPBACK_GRAPH_EXEC_DISABLED=1",
            },
            "observations":observations,
            "normalServingGroupMeasurements":normal_group_measurements,
            "schedulerCases":scheduler_cases,
        })),
        content_digest(json!({
            "format":"snapback.graph-match-dispositions.v1",
            "version":1,
            "registrationSource":"served-graph-subscription",
            "commits":commits.iter().map(|(id, _)| id).collect::<Vec<_>>(),
            "measurementScope":{
                "fixture":"normal-seed-v1",
                "fixtureRuns":1,
                "graphs":subscriptions.len(),
                "commitShapes":commits.len(),
                "graphCommitReplays":replays.len(),
                "nodeDecisions":totals.iter().sum::<u64>(),
                "totals":{
                    "skip":totals[0],
                    "match":totals[1],
                    "conservativeFallback":totals[2],
                },
                "nodeDisjointSkipRate":format!("{}/{}", totals[0], totals.iter().sum::<u64>()),
                "conservativeFallbackRate":format!("{}/{}", totals[2], totals.iter().sum::<u64>()),
                "caveat":"N=1 deterministic normal-fixture shape evidence; no magnitude, variance, large-fixture, hot-fixture, or publication claim",
            },
            "replays":replays,
            "summary":summary,
        })),
    )
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
            "direction":"forward", "lower":{"kind":"unbounded"},
            "upper":{"kind":"unbounded"},
            "limit":2, "resultCount":0, "boundary":null, "complete":true
        }
    }))
    .unwrap();
    let bound_carrier = carrier();
    let plan = &bound_carrier.normalized_plan;
    validate_graph_captured_read_v1(&graph, plan).expect("capture binds the normalized node");
    let mut missing_range_identity = graph.clone();
    if let GraphCapturedDependencyV1::RootRange { direction, .. } =
        &mut missing_range_identity.dependency
    {
        *direction = None;
    }
    assert!(
        validate_graph_captured_read_v1(&missing_range_identity, plan).is_err(),
        "a range without its executed direction is incomplete"
    );
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
fn default_targets_require_explicit_graph_capability_declaration() {
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
        .expect_err("a forged graph function cannot bypass target capability admission");
    assert_eq!(error.diagnostic.code, "SNAPBACK_CAPABILITY_UNSUPPORTED");
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

#[test]
fn graph_registration_refuses_semantically_forged_provenance() {
    let corpus = graph_corpus();
    let (carrier, schema, demand, output) = registration_fixture(&corpus, "issueListV2");
    let register = |demand: &GraphSubscriptionRegistrationDemandV1,
                    output: &GraphEvaluationOutputV1| {
        register_graph_subscription_dependencies(
            &carrier,
            &schema,
            demand,
            &output.captured_reads,
            &output.capture_attachments,
            &output.captured_query_outputs,
        )
    };
    assert!(register(&demand, &output).is_ok(), "baseline registers");

    let mut forged_filter = output.clone();
    let query_read_index = forged_filter
        .capture_attachments
        .iter()
        .flat_map(|attachment| attachment.ordinary_read_indices.iter())
        .copied()
        .find(|index| forged_filter.captured_reads[*index as usize].kind == CapturedReadKind::Query)
        .expect("ordinary query companion");
    let query_read = &mut forged_filter.captured_reads[query_read_index as usize];
    let mut query_plan: QueryPlan = serde_json::from_value(
        query_read
            .predicate
            .clone()
            .expect("query companion predicate"),
    )
    .expect("query companion plan");
    query_plan.filters.push(FilterExpr {
        field: "registrationForgery".to_owned(),
        op: FilterOp::Eq,
        value: ValueExpr::Literal(Value::Bool(true)),
    });
    query_read.predicate = Some(serde_json::to_value(&query_plan).unwrap());
    assert!(
        register(&demand, &forged_filter).is_err(),
        "a companion with a forged filter cannot register"
    );
    let captured_rows = output
        .captured_query_outputs
        .iter()
        .find(|query| query.query_read_index == query_read_index)
        .expect("captured query output");
    let inserted = captured_rows.rows.first().expect("non-empty root output");
    assert!(
        inserted.get("registrationForgery").is_none(),
        "the inserted row satisfies the real plan, not the forged filter"
    );
    let definition = FunctionDefinition::new(
        "issueListV2",
        FunctionKind::LiveQuery,
        FunctionRuntime::HostPlan(HandlerPlan::GraphQuery(carrier.clone())),
    );
    let outcome = live_subscription_match_outcome(
        &definition,
        &demand.input,
        &forged_filter.captured_reads,
        &[ChangedRow {
            table: query_plan.table,
            id: inserted["_id"].as_str().unwrap().to_owned(),
            op: ChangeOp::Insert,
            row: Some(inserted.clone()),
            changed_fields: Vec::new(),
        }],
    );
    assert_ne!(
        outcome,
        LiveMatchOutcome::Skip,
        "an insert satisfying the real filter but not the forged filter must not skip"
    );

    let mut wrong_table = output.clone();
    let parent_key = first_captured_parent_key_mut(&mut wrong_table.captured_reads)
        .expect("captured child parent key");
    parent_key.table = "wrong_parent_table".to_owned();
    assert!(
        register(&demand, &wrong_table).is_err(),
        "a wrong-table parent substitution with the same id cannot register"
    );

    let mut stale_closure = output.clone();
    let parent_key = first_captured_parent_key_mut(&mut stale_closure.captured_reads)
        .expect("captured child parent key");
    parent_key.id = "stale-parent-from-prior-demand".to_owned();
    assert!(
        register(&demand, &stale_closure).is_err(),
        "a stale same-cardinality parent closure cannot register"
    );

    let mut bare_hash = demand.clone();
    bare_hash.materialization.materialization_hash = Sha256V1::new(
        "sha256:3333333333333333333333333333333333333333333333333333333333333333".to_owned(),
    )
    .unwrap();
    assert!(
        register(&bare_hash, &output).is_err(),
        "a bare hash that disagrees with its supplied preimage cannot register"
    );
}

/// The G2-B freezer is downstream of real evaluator output. It writes the
/// graph-only sidecar consumed by the JS G0 freezer and the exact per-node
/// replay ledger; the ordinary shared Query/Row/Auth dependencies remain
/// runtime-only and are asserted through the registration result here.
///
/// Run with `SNAPBACK_FREEZE_GRAPH_G2_B=1` to regenerate the evaluator capture
/// artifact, then run the JS graph freezer so its embedded vectors/digests
/// follow the runtime sidecar. G2-C owns the matcher ledger now that a served
/// registration exists. A normal test run is read-only.
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
    assert!(runs.iter().all(|(_, _, _, registered)| {
        registered
            .reads()
            .iter()
            .any(|read| read.kind == CapturedReadKind::GraphNode)
            && registered
                .reads()
                .iter()
                .any(|read| read.kind == CapturedReadKind::Query)
    }));

    let captures = runtime_capture_artifact(&runs);
    let dispositions = match_disposition_artifact(&corpus, &runs);
    if std::env::var_os("SNAPBACK_FREEZE_GRAPH_G2_B").is_some() {
        write_frozen_json(RUNTIME_CAPTURES_FILE, &captures);
        return;
    }

    assert_eq!(
        load_json(RUNTIME_CAPTURES_FILE),
        captures,
        "runtime graph capture sidecar is stale"
    );
    let frozen_dispositions = load_json(MATCH_DISPOSITIONS_FILE);
    for field in ["commits", "replays", "summary"] {
        assert_eq!(
            frozen_dispositions[field], dispositions[field],
            "served and direct matcher disposition {field} drifted",
        );
    }
    assert_eq!(
        frozen_dispositions["registrationSource"],
        "served-graph-subscription",
    );
    for (query, carrier, _, registered) in &runs {
        let frozen = corpus["g0ExitObservationEvidence"]
            .as_array()
            .unwrap()
            .iter()
            .find(|row| row["graphPlanHash"] == carrier.plan_hash.as_str())
            .unwrap_or_else(|| panic!("frozen observation for {query}"));
        let actual = registered
            .reads()
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

/// G2-C's executable corpus arm. Every carrier first crosses graph admission
/// on an instance that explicitly declares `graph_query_v1`, then establishes
/// a live subscription, evaluates and registers its captures, and finally
/// consumes the frozen commit-shape replay through that served registration.
///
/// Run with `SNAPBACK_FREEZE_GRAPH_G2_C=1` to re-freeze the two measurement
/// artifacts after inspecting the generated diff. A normal run is read-only.
///
/// @ref LLP 0209#9-sequencing-and-measurement-what-lands-first-and-how-it-is-measured — G2-C discharges serving, structural-work,
/// and D2-H2 evidence without changing the opaque default path.
#[test]
fn graph_served_corpus_executes_and_records_structural_work_and_d2_h2() {
    let (observations, dispositions) = served_graph_execution_artifacts(&graph_corpus());
    if std::env::var_os("SNAPBACK_FREEZE_GRAPH_G2_C").is_some() {
        write_frozen_json(SERVED_OBSERVATIONS_FILE, &observations);
        write_frozen_json(MATCH_DISPOSITIONS_FILE, &dispositions);
        return;
    }
    assert_eq!(
        load_json(SERVED_OBSERVATIONS_FILE),
        observations,
        "served graph observation artifact is stale",
    );
    assert_eq!(
        load_json(MATCH_DISPOSITIONS_FILE),
        dispositions,
        "served matcher disposition ledger is stale",
    );
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

/// G2-C moves both scheduler cases into the executable corpus. The retained
/// sidecar stays structurally frozen but has no residual rows.
#[test]
fn g2_pending_broadcast_sidecar_is_empty_after_scheduler_discharge() {
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
    assert_eq!(pending["caseKinds"], json!([]),);
    let cases = pending["cases"].as_array().expect("pending cases");
    assert!(cases.is_empty());
}

#[test]
fn broadcast_prover_dispositions_are_final() {
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
    for disposition in dispositions {
        assert!(disposition["proverDisposition"].as_str().is_some());
        assert!(
            disposition["reason"]
                .as_str()
                .is_some_and(|reason| !reason.is_empty())
        );
        if matches!(
            disposition["caseKind"].as_str(),
            Some("authorityTransition" | "mixedCommit")
        ) {
            assert_eq!(
                disposition["proverDisposition"],
                "executable-in-g2-c-served-scheduler"
            );
        }
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
            "normal fixture measured through admitted serving; large/hot ceilings remain provisional"
        );
        let measured = &bounds["queries"][name]["physical"]["servedNormalMeasurement"];
        assert_eq!(measured["fixture"], "normal-seed-v1");
        assert_eq!(measured["graphPlanHash"], carrier.plan_hash.as_str());
        for field in measured["queryCost"].as_object().unwrap().values() {
            assert_eq!(field["disposition"], "fit");
        }
        for node in measured["nodes"].as_array().unwrap() {
            for field in node
                .as_object()
                .unwrap()
                .values()
                .filter(|value| value.is_object())
            {
                assert_eq!(field["disposition"], "fit");
            }
        }
        for field in measured["windowRollup"].as_object().unwrap().values() {
            assert_eq!(field["disposition"], "fit");
        }
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

/// The corpus retains the seven-kind schema and executes every case kind.
/// Eight labels are closed; bounds remains honestly partial on the absent
/// large/hot observations while normal measurements come from serving.
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
            "authorityTransition",
            "mixedCommit",
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
            "authorityTransition",
            "mixedCommit",
            "pairedWorld",
            "refusal",
            "scopeMismatch"
        ]),
    );
    for case in corpus["cases"].as_array().unwrap().iter().filter(|case| {
        matches!(
            case["caseKind"].as_str(),
            Some("authorityTransition" | "mixedCommit")
        )
    }) {
        let carrier: GraphQueryCarrierV1 =
            serde_json::from_value(case["plan"].clone()).expect("scheduler carrier");
        assert_eq!(
            graph_plan_identity_v1(&carrier.normalized_plan).expect("scheduler plan identity"),
            carrier,
        );
        validate_corpus_invocation(&carrier, &case["invocations"]["before"], "listIssueByID");
        validate_corpus_invocation(&carrier, &case["invocations"]["after"], "listIssueByID");
        let observed = case["observed"].as_array().expect("scheduler observations");
        assert_eq!(observed.len(), 2);
        assert_eq!(observed[0]["kind"], "fence");
        assert_eq!(observed[1]["kind"], "delivery");
        assert_eq!(
            observed[0]["authorizationVersion"],
            case["commit"]["afterAuthorizationVersion"]
        );
        assert_eq!(
            observed[1]["authorizationVersion"],
            case["commit"]["afterAuthorizationVersion"]
        );
        let data_changes = case["commit"]["dataChanges"].as_array().unwrap();
        assert_eq!(
            data_changes.is_empty(),
            case["caseKind"] == "authorityTransition"
        );
    }
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
        labels
            .iter()
            .copied()
            .filter(|label| *label != "G0-BCAST-BOUNDS")
            .collect::<BTreeSet<_>>(),
    );
    for entry in input_rows {
        if entry["label"] == "G0-BCAST-BOUNDS" {
            assert_eq!(entry["status"], "PARTIAL");
            let missing = entry["missingCarrier"]
                .as_str()
                .expect("bounds gap carrier");
            for needle in [
                "large-seed42-v1 GraphG0ExitObservationV1 rows are absent",
                "hot-recent-v1 GraphG0ExitObservationV1 rows are absent",
                "zb5-large.mjs",
                "zb5-hot.mjs",
            ] {
                assert!(missing.contains(needle), "bounds carrier names {needle}");
            }
        } else {
            assert_eq!(entry["status"], "SATISFIED");
            assert!(entry["missingCarrier"].is_null());
        }
    }
    let observations = corpus["g0ExitObservations"]
        .as_array()
        .expect("observations");
    assert_eq!(observations.len(), 3);
    let served_measurements = load_json(SERVED_OBSERVATIONS_FILE)["normalServingGroupMeasurements"]
        .as_array()
        .expect("actual served group measurements")
        .clone();
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
        let served = served_measurements
            .iter()
            .find(|row| row["graphPlanHash"] == observation["graphPlanHash"])
            .expect("observation has an actual served group measurement");
        assert_eq!(
            served["measurementSource"],
            "served-retained-live-evaluation-memo"
        );
        assert_eq!(served["groupCount"], observation["groupCount"]);
        assert_eq!(served["subscriberFanout"], observation["subscriberFanout"]);
        assert_eq!(served["groups"], observation["groups"]);
        for field in ["resultBytes", "dependencyBytes", "groupStateBytes"] {
            assert!(groups[0][field].as_u64().is_some_and(|bytes| bytes > 0));
        }
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
