use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;

use serde_json::{Map, Value, json};
use snapback::local::{GraphServingAuthorityContextV1, LiveSubscribeInput, LocalSnapback};
use snapback::manifest::*;
use snapback_engine::graph_evaluator::{
    GraphEvaluationAuthorityV1, GraphPermissionValuesV1, GraphWindowLedgerV1,
};
use snapback_kernel::storage::{ChangeOp, ChangedRow};
use snapback_types::diagnostic::DiagnosticSeverity;

const CORPUS_FILE: &str = "tests/conformance/graph/corpus.v1.json";
const GRAPH_CORPUS_ORDINARY_PRINCIPAL: &str = "usr_00000000000000000000000000";
const GRAPH_CORPUS_AUTHORITY_TABLE: &str = "graphSchedulerAuthority";
const GRAPH_CORPUS_AUTHORITY_ROW: &str = "graph_scheduler_authority";
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

const PATCH_ISSUE: &str = "graphCorpusPatchIssue";
const PATCH_ISSUE_TWO_FIELDS: &str = "graphCorpusPatchIssueTwoFields";
const PATCH_ISSUE_ORDER: &str = "graphCorpusPatchIssueOrder";
const PATCH_ISSUE_ASSIGNEE: &str = "graphCorpusPatchIssueAssignee";
const PATCH_ISSUE_LIST_ORDER: &str = "graphCorpusPatchIssueListOrder";
const PATCH_ISSUE_LABEL_READ: &str = "graphCorpusPatchIssueLabelRead";
const PATCH_COMMENT: &str = "graphCorpusPatchComment";
const PATCH_CREATOR: &str = "graphCorpusPatchCreator";
const PATCH_ASSIGNEE_USER: &str = "graphCorpusPatchAssigneeUser";
const PATCH_LABEL: &str = "graphCorpusPatchLabel";
const ADD_MEMBERSHIP: &str = "graphCorpusAddMembership";

#[derive(Debug)]
pub struct GraphReplay {
    pub case: Value,
    pub plan: GraphQueryPlanV1,
    pub call: Value,
    pub auth: AuthInput,
    pub before: Value,
    pub after: Value,
    pub frame: Value,
    pub disposition: Value,
    pub before_rows: Vec<Value>,
    pub reference_read_rows: BTreeMap<String, Vec<Value>>,
    pub change: Option<ChangedRow>,
    pub delivery_before: (bool, bool),
    pub delivery_after: (bool, bool),
}

#[derive(Debug)]
pub struct ExecDisabledProbe {
    pub frame_kinds: Vec<String>,
    pub delta_deliveries_before: u64,
    pub delta_deliveries_after: u64,
    pub delta_evaluation_cost_before: u64,
    pub delta_evaluation_cost_after: u64,
    pub diagnostic_codes: Vec<String>,
}

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

pub fn graph_corpus() -> Value {
    load_json(CORPUS_FILE)
}

fn corpus_seed_tables(corpus: &Value) -> BTreeMap<String, Vec<Map<String, Value>>> {
    let base = corpus["fixtures"]["normal"]
        .as_str()
        .expect("normal graph fixture path");
    let fixture = load_json(&format!("{base}/fixture.json"));
    let mut tables = fixture["tableFiles"]
        .as_object()
        .expect("graph fixture table files")
        .iter()
        .map(|(table, file)| {
            let rows = load_json(&format!("{base}/{}", file.as_str().unwrap()))
                .as_array()
                .expect("graph fixture rows")
                .iter()
                .map(|row| row.as_object().expect("graph fixture row").clone())
                .collect::<Vec<_>>();
            (table.clone(), rows)
        })
        .collect::<BTreeMap<_, _>>();

    for table in ["rooms", "roomMembers"] {
        tables.insert(
            table.to_owned(),
            corpus["broadcastFixture"]["data"][table]
                .as_array()
                .expect("broadcast fixture rows")
                .iter()
                .map(|row| row.as_object().expect("broadcast fixture row").clone())
                .collect(),
        );
    }

    let paired = load_json("tests/conformance/graph/paired-world-fixtures.v1.json");
    for pair_id in [
        "g0-pair-point-hidden-internal-root",
        "g0-pair-detail-hidden-root-empty-child-demand",
        "g0-pair-detail-notification-principal",
        "g0-pair-point-view-state-principal",
    ] {
        let pair = paired["pairs"]
            .as_array()
            .expect("paired graph fixtures")
            .iter()
            .find(|pair| pair["id"] == pair_id)
            .expect("paired graph fixture id");
        let table = pair["namedSlice"]["table"]
            .as_str()
            .expect("paired slice table");
        tables.insert(
            table.to_owned(),
            pair["present"]["sliceTableRows"]
                .as_array()
                .expect("paired present rows")
                .iter()
                .map(|row| row.as_object().expect("paired present row").clone())
                .collect(),
        );
    }

    tables.insert(
        "identityBinding".to_owned(),
        corpus["authorityOwner"]["facts"]
            .as_array()
            .expect("authority owner facts")
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

fn graph_index_manifest(table: &str, fields: &BTreeSet<String>) -> Vec<IndexManifest> {
    let indexes: &[(&str, &[&str], bool)] = match table {
        "issue" => &[
            ("by_source_id", &["id"], true),
            (
                "by_project_modified",
                &["projectID", "modified", "id"],
                false,
            ),
        ],
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
        _ => &[],
    };
    indexes
        .iter()
        .filter(|(_, names, _)| {
            names
                .iter()
                .all(|field| *field == "_id" || fields.contains(*field))
        })
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
        FieldType::Id {
            table: table.to_owned(),
        }
    } else if (table, field) == ("identityBinding", "principal") {
        FieldType::Principal
    } else if matches!(field, "modified" | "created" | "viewed") {
        FieldType::Real
    } else {
        inferred
    }
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
    SchemaManifest {
        app_id: "zerobugs-graph-g2-corpus".to_owned(),
        schema_hash: Some(CORPUS_SCHEMA_HASH.to_owned()),
        inputs_hash: Some(CORPUS_INPUTS_HASH.to_owned()),
        tables: tables
            .iter()
            .map(|(name, rows)| {
                let fields = rows
                    .iter()
                    .flat_map(|row| row.keys())
                    .filter(|field| field.as_str() != "_id")
                    .cloned()
                    .collect::<BTreeSet<_>>();
                TableManifest {
                    name: name.clone(),
                    fields: fields
                        .iter()
                        .map(|field| FieldManifest {
                            name: field.clone(),
                            field_type: corpus_declared_field_type(
                                name,
                                field,
                                inferred_field_type(
                                    rows.iter()
                                        .map(|row| row.get(field).cloned().unwrap_or(Value::Null)),
                                ),
                            ),
                            optional: corpus_declared_field_optional(name, field),
                        })
                        .collect(),
                    indexes: graph_index_manifest(name, &fields),
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
            .collect(),
        ..SchemaManifest::default()
    }
}

fn graph_store(corpus: &Value) -> LocalSnapback {
    let tables = corpus_seed_tables(corpus);
    let mut snapback = LocalSnapback::memory().expect("graph Stage-B memory store");
    let diagnostics = snapback
        .apply_schema(corpus_schema(&tables))
        .expect("apply graph Stage-B schema");
    assert!(
        diagnostics
            .iter()
            .all(|diagnostic| diagnostic.severity != DiagnosticSeverity::Error),
        "graph Stage-B schema diagnostics: {diagnostics:?}",
    );
    snapback
        .seed(SeedData { tables })
        .expect("seed graph Stage-B store");
    snapback
}

fn corpus_authority(corpus: &Value, principal: &str) -> GraphEvaluationAuthorityV1 {
    let fact = corpus["authorityOwner"]["facts"]
        .as_array()
        .expect("graph authority facts")
        .iter()
        .find(|fact| fact["principal"] == principal)
        .expect("graph authority principal");
    GraphEvaluationAuthorityV1 {
        auth: AuthInput {
            principal: Some(principal.to_owned()),
            user_id: Some(principal.to_owned()),
            ..AuthInput::default()
        },
        permission_values_by_table: fact["visibilityPolicyInputs"]
            .as_array()
            .expect("visibility policy inputs")
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
            .collect(),
        resolved_membership_inputs: BTreeSet::new(),
        resolved_role_inputs: BTreeSet::new(),
    }
}

fn corpus_invocation_principal(call: &Value) -> &str {
    call["partition"]["class3"]["principalDataScope"]["userId"]
        .as_str()
        .or_else(|| call["corpusAuthorityPrincipal"].as_str())
        .unwrap_or(GRAPH_CORPUS_ORDINARY_PRINCIPAL)
}

fn mutation_input(args: Value) -> HandlerInput {
    HandlerInput {
        args,
        auth: AuthInput {
            principal: Some(GRAPH_CORPUS_ORDINARY_PRINCIPAL.to_owned()),
            user_id: Some(GRAPH_CORPUS_ORDINARY_PRINCIPAL.to_owned()),
            ..AuthInput::default()
        },
        ..HandlerInput::default()
    }
}

fn served_graph_carriers(
    snapback: &LocalSnapback,
    corpus: &Value,
) -> Vec<(String, GraphQueryCarrierV1, FunctionDefinition)> {
    corpus["queries"]
        .as_array()
        .expect("graph corpus queries")
        .iter()
        .map(|query| {
            let name = query["query"].as_str().unwrap().to_owned();
            let carrier: GraphQueryCarrierV1 =
                serde_json::from_value(query["carrier"].clone()).unwrap();
            let result_contract = snapback
                .graph_result_contract_for_test(&carrier.normalized_plan)
                .unwrap_or_else(|reason| panic!("reify served {name} contract: {reason:?}"));
            assert_eq!(
                result_contract_hash(&result_contract).expect("graph result contract hash"),
                carrier.normalized_plan.result_contract_hash.as_str(),
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

fn patch_function(name: &str, table: &str, field: &str) -> FunctionDefinition {
    FunctionDefinition::new(
        name,
        FunctionKind::Mutation,
        FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
            owner_write_checks: Vec::new(),
            steps: vec![MutationStep::Patch {
                table: table.to_owned(),
                id: ValueExpr::Arg("rowID".to_owned()),
                values: BTreeMap::from([(field.to_owned(), ValueExpr::Arg("value".to_owned()))]),
            }],
            return_value: None,
        })),
    )
}

fn mutation_functions() -> Vec<FunctionDefinition> {
    let patch_two = FunctionDefinition::new(
        PATCH_ISSUE_TWO_FIELDS,
        FunctionKind::Mutation,
        FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
            owner_write_checks: Vec::new(),
            steps: vec![MutationStep::Patch {
                table: "issue".to_owned(),
                id: ValueExpr::Arg("rowID".to_owned()),
                values: BTreeMap::from([
                    ("title".to_owned(), ValueExpr::Arg("title".to_owned())),
                    ("open".to_owned(), ValueExpr::Arg("open".to_owned())),
                ]),
            }],
            return_value: None,
        })),
    );
    vec![
        patch_function(PATCH_ISSUE, "issue", "title"),
        patch_two,
        patch_function(PATCH_ISSUE_ORDER, "issue", "modified"),
        patch_function(PATCH_ISSUE_ASSIGNEE, "issue", "assigneeID"),
        patch_function(PATCH_ISSUE_LIST_ORDER, "issueListRead", "modified"),
        patch_function(PATCH_ISSUE_LABEL_READ, "issueLabelRead", "labelID"),
        patch_function(PATCH_COMMENT, "comment", "body"),
        patch_function(PATCH_CREATOR, "user", "login"),
        patch_function(PATCH_ASSIGNEE_USER, "user", "login"),
        patch_function(PATCH_LABEL, "label", "name"),
        patch_function(ADD_MEMBERSHIP, "issueListRead", "modified"),
    ]
}

fn served_graph_manifest(
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
            .chain(mutation_functions())
            .collect(),
        ..FunctionManifest::default()
    }
}

fn ensure_graph_window_pages(carrier: &mut GraphQueryCarrierV1, minimum_pages: u64) {
    let plan = &mut carrier.normalized_plan;
    for cost in &mut plan.query_cost.graph.nodes {
        let Some(old_pages) = cost.max_window_pages else {
            continue;
        };
        let max_pages = old_pages.max(minimum_pages);
        let rescale = |total: u64| {
            assert_eq!(total % old_pages, 0);
            (total / old_pages).checked_mul(max_pages).unwrap()
        };
        cost.max_window_pages = Some(max_pages);
        cost.max_window_root_rows = Some(rescale(cost.max_window_root_rows.unwrap()));
        cost.max_window_scanned_rows = Some(rescale(cost.max_window_scanned_rows.unwrap()));
        cost.max_window_result_rows = Some(rescale(cost.max_window_result_rows.unwrap()));
        cost.max_window_result_bytes = Some(rescale(cost.max_window_result_bytes.unwrap()));
        cost.max_window_index_ranges = Some(rescale(cost.max_window_index_ranges.unwrap()));
    }
    let mut rollup = GraphWindowRollupV1::default();
    for cost in plan
        .query_cost
        .graph
        .nodes
        .iter()
        .filter(|cost| cost.max_window_pages.is_some())
    {
        rollup.max_window_pages += cost.max_window_pages.unwrap();
        rollup.max_window_root_rows += cost.max_window_root_rows.unwrap();
        rollup.max_window_scanned_rows += cost.max_window_scanned_rows.unwrap();
        rollup.max_window_result_rows += cost.max_window_result_rows.unwrap();
        rollup.max_window_result_bytes += cost.max_window_result_bytes.unwrap();
        rollup.max_window_index_ranges += cost.max_window_index_ranges.unwrap();
    }
    plan.query_cost.graph.window_rollup = rollup;
    *carrier = graph_plan_identity_v1(plan).expect("rescaled graph plan remains admitted");
}

fn all_rows(snapback: &LocalSnapback, table: &str) -> Vec<Value> {
    let scan = snapback
        .scan_table(table, 20_000, 0)
        .unwrap_or_else(|error| panic!("scan {table}: {error:?}"));
    assert_eq!(
        scan.rows.len(),
        scan.total,
        "Stage-B fixture table fits scan"
    );
    scan.rows
}

fn change_descriptor(case: &Value, before_rows: &[Value], after_rows: &[Value]) -> ChangedRow {
    let table = case["changeTable"].as_str().expect("case change table");
    let id = case["changeRowId"].as_str().expect("case change row id");
    let before = before_rows.iter().find(|row| row["_id"] == id).cloned();
    let after = after_rows.iter().find(|row| row["_id"] == id).cloned();
    assert!(
        before.is_some() && after.is_some(),
        "graph cases patch one retained row"
    );
    ChangedRow {
        table: table.to_owned(),
        id: id.to_owned(),
        op: ChangeOp::Update,
        row: after,
        changed_fields: case["changedFields"]
            .as_array()
            .expect("case changed fields")
            .iter()
            .map(|field| field.as_str().unwrap().to_owned())
            .collect(),
    }
}

pub fn graph_delta_cases(corpus: &Value) -> Vec<Value> {
    let membership_row = corpus_seed_tables(corpus)["issueListRead"]
        .iter()
        .min_by_key(|row| row["modified"].as_u64().expect("numeric modified"))
        .and_then(|row| row["_id"].as_str())
        .expect("membership-add row")
        .to_owned();
    vec![
        json!({"id":"issue-list-child-update","query":"issueListV2","shape":"equality-to-one-child-with-sibling-array","expectedLane":"replace","mutation":PATCH_ISSUE,"args":{"rowID":"issue_33999fea163c421dc30f2bbb","value":"G3 issueListV2 retained child update"},"changeTable":"issue","changeRowId":"issue_33999fea163c421dc30f2bbb","changedFields":["title"]}),
        json!({"id":"issue-list-to-many-update","query":"issueListV2","shape":"to-many-child-update","expectedLane":"replace","mutation":PATCH_ISSUE_LABEL_READ,"args":{"rowID":"issueLabelRead_89fee73d0fb9a7dbb44c2f42","value":"label_f433ea7a1e0d16c17fd0e8b4"},"changeTable":"issueLabelRead","changeRowId":"issueLabelRead_89fee73d0fb9a7dbb44c2f42","changedFields":["labelID"]}),
        json!({"id":"issue-detail-root-update","query":"issueDetail","shape":"root-update-with-sibling-array","expectedLane":"replace","mutation":PATCH_ISSUE,"args":{"rowID":"issue_da43a7cfca272ba1c3f411ee","value":"G3 issueDetail root update in place"},"changeTable":"issue","changeRowId":"issue_da43a7cfca272ba1c3f411ee","changedFields":["title"]}),
        json!({"id":"issue-detail-to-many-update","query":"issueDetail","shape":"to-many-child-update","expectedLane":"replace","mutation":PATCH_COMMENT,"args":{"rowID":"comment_c390407f429dd9c72db13062","value":"G3 to-many comment replacement witness"},"changeTable":"comment","changeRowId":"comment_c390407f429dd9c72db13062","changedFields":["body"]}),
        json!({"id":"list-by-id-child-update","query":"listIssueByID","shape":"equality-to-one-child-with-sibling-array","expectedLane":"replace","mutation":PATCH_ISSUE,"args":{"rowID":"issue_da43a7cfca272ba1c3f411ee","value":"G3 listIssueByID retained child update"},"changeTable":"issue","changeRowId":"issue_da43a7cfca272ba1c3f411ee","changedFields":["title"]}),
        json!({"id":"list-by-id-to-many-update","query":"listIssueByID","shape":"to-many-child-update","expectedLane":"replace","mutation":PATCH_ISSUE_LABEL_READ,"args":{"rowID":"issueLabelRead_218338e94f97000dcc5e2a02","value":"label_f433ea7a1e0d16c17fd0e8b4"},"changeTable":"issueLabelRead","changeRowId":"issueLabelRead_218338e94f97000dcc5e2a02","changedFields":["labelID"]}),
        json!({"id":"issue-detail-sibling-array-corruption","query":"issueDetail","shape":"equality-child-below-to-many-sibling-array-corruption","expectedLane":"replace","mutation":PATCH_LABEL,"args":{"rowID":"label_a8bf0091490f728ca1d433a8","value":"G3 one label only"},"changeTable":"label","changeRowId":"label_a8bf0091490f728ca1d433a8","changedFields":["name"]}),
        json!({"id":"issue-list-in-window-reorder","query":"issueListV2","shape":"root-window-in-window-reorder","expectedLane":"replace","mutation":PATCH_ISSUE_LIST_ORDER,"args":{"rowID":"issueListRead_00c0991548f2f2652d6c5157","value":1900000000000_u64},"changeTable":"issueListRead","changeRowId":"issueListRead_00c0991548f2f2652d6c5157","changedFields":["modified"]}),
        json!({"id":"issue-list-membership-add","query":"issueListV2","shape":"root-window-membership-add","expectedLane":"replace","mutation":ADD_MEMBERSHIP,"args":{"rowID":membership_row,"value":1800000000000_u64},"changeTable":"issueListRead","changeRowId":membership_row,"changedFields":["modified"]}),
        json!({"id":"issue-detail-creator-user-change","query":"issueDetail","shape":"equality-to-one-creator-with-sibling-arrays","expectedLane":"replace","mutation":PATCH_CREATOR,"args":{"rowID":"user_885982503097c2548c6cba45","value":"g3-creator-change"},"changeTable":"user","changeRowId":"user_885982503097c2548c6cba45","changedFields":["login"]}),
        json!({"id":"list-by-id-two-field-coalesced-patch","query":"listIssueByID","shape":"equality-to-one-two-field-coalesced-patch-with-sibling-array","expectedLane":"replace","mutation":PATCH_ISSUE_TWO_FIELDS,"args":{"rowID":"issue_da43a7cfca272ba1c3f411ee","title":"G3 coalesced title","open":true},"changeTable":"issue","changeRowId":"issue_da43a7cfca272ba1c3f411ee","changedFields":["open","title"]}),
        json!({"id":"issue-summary-root-scalar-update","query":"issueSummary","shape":"root-row-scalar-update-position-unchanged","expectedLane":"delta","mutation":PATCH_ISSUE,"args":{"rowID":"issue_ded0c2976675c34f4756035d","value":"G3 issueSummary retained root scalar update"},"changeTable":"issue","changeRowId":"issue_ded0c2976675c34f4756035d","changedFields":["title"]}),
        json!({"id":"issue-summary-assignee-user-rename","query":"issueSummary","shape":"equality-to-one-assignee-scalar-update","expectedLane":"delta","mutation":PATCH_ASSIGNEE_USER,"args":{"rowID":"user_47a7fdef09689e6736359a9c","value":"g3-assignee-rename"},"changeTable":"user","changeRowId":"user_47a7fdef09689e6736359a9c","changedFields":["login"]}),
        json!({"id":"issue-summary-two-field-coalesced-patch","query":"issueSummary","shape":"root-row-two-field-coalesced-patch","expectedLane":"delta","mutation":PATCH_ISSUE_TWO_FIELDS,"args":{"rowID":"issue_ded0c2976675c34f4756035d","title":"G3 issueSummary coalesced title","open":false},"changeTable":"issue","changeRowId":"issue_ded0c2976675c34f4756035d","changedFields":["open","title"]}),
        json!({"id":"issue-summary-order-key-move","query":"issueSummary","shape":"root-window-order-key-move","expectedLane":"replace","mutation":PATCH_ISSUE_ORDER,"args":{"rowID":"issue_ded0c2976675c34f4756035d","value":1_u64},"changeTable":"issue","changeRowId":"issue_ded0c2976675c34f4756035d","changedFields":["modified"]}),
        json!({"id":"issue-summary-assignee-repoint","query":"issueSummary","shape":"equality-to-one-assignee-repoint","expectedLane":"replace","mutation":PATCH_ISSUE_ASSIGNEE,"args":{"rowID":"issue_ded0c2976675c34f4756035d","value":"user_804808a3aa5ef7440e34bd42"},"changeTable":"issue","changeRowId":"issue_ded0c2976675c34f4756035d","changedFields":["assigneeID"]}),
        json!({"id":"issue-summary-take-window-change","query":"issueSummary","shape":"root-window-take-change","expectedLane":"replace","windowChange":true}),
    ]
}

fn invocation<'a>(corpus: &'a Value, carrier: &GraphQueryCarrierV1) -> &'a Value {
    &corpus["g0ExitObservationEvidence"]
        .as_array()
        .expect("G0 exit evidence")
        .iter()
        .find(|evidence| evidence["graphPlanHash"] == carrier.plan_hash.as_str())
        .expect("graph case invocation")["invocation"]
}

fn graph_demand_args(call: &Value) -> Value {
    let mut args = call["args"].as_object().expect("graph args").clone();
    args.insert(
        snapback_engine::graph_evaluator::GRAPH_SERVING_DEMAND_ARG.to_owned(),
        json!({
            "format":"snapback.graph-serving-demand.v1",
            "windows":call["windows"],
            "advancedNodeId":call["advancedNodeId"],
            "priorWindowLedgers":[],
            "deltaFormat":"snapback.graph-live-delta.v1",
        }),
    );
    Value::Object(args)
}

fn execute_commit_case(corpus: &Value, case: &Value) -> GraphReplay {
    let query = case["query"].as_str().expect("graph case query");
    let mut snapback = graph_store(corpus);
    eprintln!("stage-b-audit: {} store-ready", case["id"]);
    snapback.declare_graph_query_v1_capability();
    snapback.require_graph_delta_convergence_for_test();
    let mut carriers = served_graph_carriers(&snapback, corpus);
    let original = carriers
        .iter()
        .find(|(name, _, _)| name == query)
        .expect("graph case carrier")
        .1
        .clone();
    let call = invocation(corpus, &original).clone();
    let (_, carrier, definition) = carriers
        .iter_mut()
        .find(|(name, _, _)| name == query)
        .expect("graph case mutable carrier");
    ensure_graph_window_pages(carrier, 2);
    definition.runtime = FunctionRuntime::HostPlan(HandlerPlan::GraphQuery(carrier.clone()));
    let plan = carrier.normalized_plan.clone();
    let diagnostics = snapback.load_functions(served_graph_manifest(&carriers));
    eprintln!("stage-b-audit: {} functions-ready", case["id"]);
    assert!(
        diagnostics
            .iter()
            .all(|diagnostic| diagnostic.severity != DiagnosticSeverity::Error),
        "graph Stage-B manifest diagnostics: {diagnostics:?}",
    );
    let authority = corpus_authority(corpus, corpus_invocation_principal(&call));
    let reference_auth = authority.auth.clone();
    snapback.install_graph_serving_authority_context_for_test(
        query,
        GraphServingAuthorityContextV1 {
            evaluation: authority.clone(),
            class2: serde_json::from_value(call["partition"]["class2"].clone()).unwrap(),
        },
    );
    let connection = format!("stage-b-graph-{}", case["id"].as_str().unwrap());
    let established = snapback
        .subscribe_live(
            query,
            LiveSubscribeInput {
                connection_id: connection.clone(),
                input: HandlerInput {
                    args: graph_demand_args(&call),
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
        .unwrap_or_else(|error| panic!("establish graph case {query}: {error:?}"));
    eprintln!("stage-b-audit: {} subscribed", case["id"]);
    assert!(established.snapshot.is_some());
    let before = snapback
        .graph_serving_observation_for_test(&established.subscription_id)
        .expect("graph predecessor observation");
    let delivery_before = snapback
        .graph_delta_delivery_state_for_test(&established.subscription_id)
        .expect("graph predecessor delivery state");
    assert!(snapback.drain_live_stream(&connection).is_empty());
    let table = case["changeTable"].as_str().unwrap();
    let before_rows = all_rows(&snapback, table);
    let mutation = snapback.invoke_mutation(
        case["mutation"].as_str().expect("graph mutation"),
        mutation_input(case["args"].clone()),
    );
    eprintln!("stage-b-audit: {} mutated", case["id"]);
    mutation.unwrap_or_else(|error| panic!("mutate graph case {query}: {error:?}"));
    let after_rows = all_rows(&snapback, table);
    let frames = snapback
        .drain_live_stream(&connection)
        .into_iter()
        .map(|frame| serde_json::from_str::<Value>(&frame).expect("graph frame JSON"))
        .collect::<Vec<_>>();
    assert_eq!(frames.len(), 1, "one graph content frame: {frames:#?}");
    let frame = frames.into_iter().next().unwrap();
    let lane = frame["kind"]
        .as_str()
        .expect("graph frame kind")
        .strip_prefix("live_")
        .expect("graph live frame kind")
        .to_owned();
    let after = snapback
        .graph_serving_observation_for_test(&established.subscription_id)
        .expect("graph successor observation");
    let delivery_after = snapback
        .graph_delta_delivery_state_for_test(&established.subscription_id)
        .expect("graph successor delivery state");
    assert_eq!(after["deltaDelivery"]["lane"], lane);
    let change = change_descriptor(case, &before_rows, &after_rows);
    let reference_read_tables = plan
        .nodes
        .iter()
        .filter_map(|node| match node {
            GraphNodeV1::EqualityToOne {
                parent_node_id,
                table,
                join_on,
                ..
            } if join_on
                .iter()
                .any(|join| change.changed_fields.contains(&join.root_field)) =>
            {
                let parent_table = plan
                    .nodes
                    .iter()
                    .find(|node| node.node_id() == parent_node_id)
                    .and_then(|parent| match parent {
                        GraphNodeV1::RootWindow { table, .. }
                        | GraphNodeV1::EqualityToOne { table, .. }
                        | GraphNodeV1::BoundedToMany { table, .. }
                        | GraphNodeV1::PrincipalBound { table, .. } => Some(table),
                        _ => None,
                    });
                (parent_table == Some(&change.table)).then_some(table.clone())
            }
            _ => None,
        })
        .collect::<BTreeSet<_>>();
    let reference_read_rows = reference_read_tables
        .into_iter()
        .map(|table| {
            let rows = all_rows(&snapback, &table);
            (table, rows)
        })
        .collect();
    let disposition = json!({
        "id":case["id"],
        "query":query,
        "shape":case["shape"],
        "lane":lane,
        "matchedNodeIds":after["deltaDelivery"]["matchedNodeIds"],
        "deltaOps":if lane == "delta" { frame["graph"]["ops"].clone() } else { Value::Null },
        "convergenceChecked":after["deltaDelivery"]["convergenceChecked"],
        "convergenceMatched":after["deltaDelivery"]["convergenceMatched"],
    });
    GraphReplay {
        case: case.clone(),
        plan,
        call,
        auth: reference_auth,
        before,
        after,
        frame,
        disposition,
        before_rows,
        reference_read_rows,
        change: Some(change),
        delivery_before,
        delivery_after,
    }
}

fn execute_window_change(corpus: &Value, case: &Value) -> GraphReplay {
    let query = case["query"].as_str().unwrap();
    let mut snapback = graph_store(corpus);
    snapback.declare_graph_query_v1_capability();
    let carriers = served_graph_carriers(&snapback, corpus);
    let diagnostics = snapback.load_functions(served_graph_manifest(&carriers));
    assert!(
        diagnostics
            .iter()
            .all(|row| row.severity != DiagnosticSeverity::Error)
    );
    let (_, carrier, _) = carriers.iter().find(|(name, _, _)| name == query).unwrap();
    let call = invocation(corpus, carrier).clone();
    let authority = corpus_authority(corpus, corpus_invocation_principal(&call));
    let reference_auth = authority.auth.clone();
    snapback.install_graph_serving_authority_context_for_test(
        query,
        GraphServingAuthorityContextV1 {
            evaluation: authority.clone(),
            class2: serde_json::from_value(call["partition"]["class2"].clone()).unwrap(),
        },
    );
    let connection = "stage-b-graph-window-supersession".to_owned();
    let established = snapback
        .subscribe_live(
            query,
            LiveSubscribeInput {
                connection_id: connection.clone(),
                input: HandlerInput {
                    args: graph_demand_args(&call),
                    auth: authority.auth.clone(),
                    read_set: Vec::new(),
                    correlation: None,
                    ctx_ledger: None,
                },
                authorization_namespace: None,
                supersedes: None,
                resume_from_token: None,
            },
        )
        .expect("establish graph before demand change");
    let before = snapback
        .graph_serving_observation_for_test(&established.subscription_id)
        .unwrap();
    let delivery_before = snapback
        .graph_delta_delivery_state_for_test(&established.subscription_id)
        .unwrap();
    assert!(snapback.drain_live_stream(&connection).is_empty());
    let mut changed_call = call.clone();
    changed_call["windows"][0]["intervals"][0]["window"]["take"] = json!(1);
    let replacement = snapback
        .subscribe_live(
            query,
            LiveSubscribeInput {
                connection_id: connection.clone(),
                input: HandlerInput {
                    args: graph_demand_args(&changed_call),
                    auth: authority.auth,
                    read_set: Vec::new(),
                    correlation: None,
                    ctx_ledger: None,
                },
                authorization_namespace: None,
                supersedes: Some(established.subscription_id),
                resume_from_token: None,
            },
        )
        .expect("supersede graph demand");
    assert!(replacement.superseded.is_some());
    let snapshot = replacement.snapshot.expect("replacement snapshot");
    assert_eq!(snapshot.rows.len(), 1);
    let after = snapback
        .graph_serving_observation_for_test(&replacement.subscription_id)
        .unwrap();
    let delivery_after = snapback
        .graph_delta_delivery_state_for_test(&replacement.subscription_id)
        .unwrap();
    GraphReplay {
        case: case.clone(),
        plan: carrier.normalized_plan.clone(),
        call,
        auth: reference_auth,
        before,
        after,
        frame: json!({"kind":"subscription_snapshot","rows":snapshot.rows}),
        disposition: json!({
            "id":case["id"],
            "query":query,
            "shape":case["shape"],
            "lane":"replace",
            "dispositionBasis":"subscription supersession creates a new graph instance",
        }),
        before_rows: Vec::new(),
        reference_read_rows: BTreeMap::new(),
        change: None,
        delivery_before,
        delivery_after,
    }
}

pub fn execute_graph_cases(corpus: &Value) -> Vec<GraphReplay> {
    graph_delta_cases(corpus)
        .iter()
        .map(|case| {
            eprintln!(
                "stage-b-audit: shipped {}",
                case["id"].as_str().expect("graph case id")
            );
            if case["windowChange"] == true {
                execute_window_change(corpus, case)
            } else {
                execute_commit_case(corpus, case)
            }
        })
        .collect()
}

pub fn execute_exec_disabled_probe(corpus: &Value) -> ExecDisabledProbe {
    let case = graph_delta_cases(corpus)
        .into_iter()
        .find(|case| case["id"] == "issue-summary-root-scalar-update")
        .expect("eligible graph exec-disabled probe");
    let query = case["query"].as_str().expect("graph probe query");
    let mut snapback = graph_store(corpus);
    snapback.declare_graph_query_v1_capability();
    let mut carriers = served_graph_carriers(&snapback, corpus);
    let original = carriers
        .iter()
        .find(|(name, _, _)| name == query)
        .expect("graph probe carrier")
        .1
        .clone();
    let call = invocation(corpus, &original).clone();
    let (_, carrier, definition) = carriers
        .iter_mut()
        .find(|(name, _, _)| name == query)
        .expect("graph probe mutable carrier");
    ensure_graph_window_pages(carrier, 2);
    definition.runtime = FunctionRuntime::HostPlan(HandlerPlan::GraphQuery(carrier.clone()));
    let diagnostics = snapback.load_functions(served_graph_manifest(&carriers));
    assert!(
        diagnostics
            .iter()
            .all(|diagnostic| diagnostic.severity != DiagnosticSeverity::Error),
        "graph exec-disabled probe manifest diagnostics: {diagnostics:?}",
    );
    let authority = corpus_authority(corpus, corpus_invocation_principal(&call));
    snapback.install_graph_serving_authority_context_for_test(
        query,
        GraphServingAuthorityContextV1 {
            evaluation: authority.clone(),
            class2: serde_json::from_value(call["partition"]["class2"].clone()).unwrap(),
        },
    );
    let connection = "stage-b-graph-exec-disabled".to_owned();
    let established = snapback
        .subscribe_live(
            query,
            LiveSubscribeInput {
                connection_id: connection.clone(),
                input: HandlerInput {
                    args: graph_demand_args(&call),
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
        .expect("establish graph exec-disabled probe");
    assert!(established.snapshot.is_some());
    assert!(snapback.drain_live_stream(&connection).is_empty());
    let before = snapback
        .inspect_core()
        .expect("inspect graph exec-disabled probe before mutation")
        .live_evaluation;

    // SAFETY: the Stage-B audit target contains one test, and the switch is
    // removed immediately after the synchronous mutation returns.
    unsafe { std::env::set_var("SNAPBACK_GRAPH_EXEC_DISABLED", "1") };
    let mutation = snapback.invoke_mutation(
        case["mutation"].as_str().expect("graph probe mutation"),
        mutation_input(case["args"].clone()),
    );
    // SAFETY: paired with the scoped set above.
    unsafe { std::env::remove_var("SNAPBACK_GRAPH_EXEC_DISABLED") };
    mutation.expect("mutate graph exec-disabled probe");

    let frame_kinds = snapback
        .drain_live_stream(&connection)
        .into_iter()
        .map(|frame| serde_json::from_str::<Value>(&frame).expect("graph probe frame JSON"))
        .filter_map(|frame| frame["kind"].as_str().map(str::to_owned))
        .collect();
    let after = snapback
        .inspect_core()
        .expect("inspect graph exec-disabled probe after mutation");
    ExecDisabledProbe {
        frame_kinds,
        delta_deliveries_before: before.graph_delta_deliveries,
        delta_deliveries_after: after.live_evaluation.graph_delta_deliveries,
        delta_evaluation_cost_before: before.graph_delta_evaluation_cost,
        delta_evaluation_cost_after: after.live_evaluation.graph_delta_evaluation_cost,
        diagnostic_codes: after
            .recent_diagnostics
            .iter()
            .map(|diagnostic| diagnostic.code.clone())
            .collect(),
    }
}

pub fn root_window_ledger(observation: &Value) -> GraphWindowLedgerV1 {
    serde_json::from_value(
        observation["windowLedgers"]
            .as_array()
            .expect("graph window ledgers")
            .iter()
            .find(|ledger| ledger["nodeId"] == "n0")
            .expect("root window ledger")
            .clone(),
    )
    .expect("root window ledger shape")
}
