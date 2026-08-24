//! G0 Stage B graph conformance seam.
//!
//! B1 freezes identity/capture/no-runtime-consumer behavior. B3 adds the
//! corpus-owned Zerobugs declarations, opaque-handler oracle records, closed
//! completeness proofs, fixture-derived logical bounds, analytical physical
//! declarations, the seven-kind schema, executable G0
//! oracle/paired/allow-deny/refusal evidence, and honest gaps for the LLP 0268
//! inputs. No test in this file
//! executes a graph; evaluator-dependent cases remain structurally frozen for G2.

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;
use std::sync::OnceLock;

use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use snapback::live_matcher::{LiveMatchOutcome, live_subscription_match_outcome};
use snapback::local::LocalSnapback;
use snapback::manifest::*;
use snapback_kernel::storage::{ChangeOp, ChangedRow};
use snapback_sync::graph_captured_read::graph_capture_carrier_is_well_formed;
use snapback_types::storage::{CapturedReadDependency, CapturedReadKind};

const CORPUS_FILE: &str = "tests/conformance/graph/corpus.v1.json";
const BOUNDS_FILE: &str = "tests/conformance/graph/bound-derivation.v1.json";
const PENDING_CASES_FILE: &str = "tests/conformance/graph/broadcast-cases.g2-pending.v1.json";
const PAIRED_FIXTURES_FILE: &str = "tests/conformance/graph/paired-world-fixtures.v1.json";
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

fn paired_world_fixtures() -> Value {
    load_json(PAIRED_FIXTURES_FILE)
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
    let instance =
        graph_instance_identity_v1(carrier, &call["args"], windows.clone(), &evaluated_parents);
    let instance_hash = if window_disposition.is_some_and(|row| row["status"] == "BLOCKED") {
        assert_eq!(
            window_disposition.unwrap()["expectedB1Refusal"],
            "SNAPBACK_GRAPH_WINDOW_VECTOR_INVALID",
        );
        assert!(
            matches!(
                instance,
                Err(GraphDemandTimeRefusalReasonV1::WindowVectorInvalid)
            ),
            "the empty-child vector records the current B1 acceptance blocker",
        );
        assert!(
            window_disposition.unwrap()["ticket"]
                .as_str()
                .is_some_and(|ticket| ticket.ends_with("graph-empty-child-demand-window-vector.md")),
        );
        let preimage = json!({
            "format":"snapback.graph-instance.v1",
            "graphPlanHash":carrier.plan_hash,
            "argsDigest":graph_args_digest_v1(&call["args"]).expect("blocked instance args digest"),
            "windows":windows,
        });
        jcs_domain_hash("snapback:graph-instance:v1:", &preimage)
    } else {
        if let Some(disposition) = window_disposition {
            assert_eq!(disposition["status"], "VALIDATED");
        }
        instance
            .unwrap_or_else(|reason| {
                panic!("{function_name} invocation instance identity reconstructs: {reason:?}")
            })
            .instance_hash
            .as_str()
            .to_owned()
    };
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
    assert_eq!(refusals.len(), 3);
    for case in refusals {
        let query = case["query"].as_str().expect("refusal query");
        assert_eq!(case["trigger"]["phase"], "admission");
        assert_eq!(case["expect"]["reason"], expected[query]);
        assert!(case["expect"]["resultBytes"].is_null());
    }
}

/// Five corpus-local present/absent fixture pairs differ only by a named,
/// wholly hidden slice and exact-match every oracle/result/proof observation.
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
    assert_eq!(cases.len(), 5, "five exact hidden-row graph-channel pairs");
    let fixture_pairs = fixtures["pairs"].as_array().expect("fixture pairs");
    assert_eq!(fixture_pairs.len(), 5);
    let mut covered_classes = BTreeSet::new();
    let mut covered_queries = BTreeSet::new();
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
        validate_corpus_invocation_with_disposition(
            &carrier,
            call,
            query,
            Some(&case["windowVectorDisposition"]),
        );
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
        let slice_table = pair["namedSlice"]["table"].as_str().unwrap();
        let slice_ids = pair["namedSlice"]["rowIds"]
            .as_array()
            .unwrap()
            .iter()
            .map(|id| id.as_str().unwrap())
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
            if table != slice_table {
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
        let present_rows = present["sliceTableRows"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| (row["_id"].as_str().unwrap(), row))
            .collect::<BTreeMap<_, _>>();
        let absent_rows = absent["sliceTableRows"]
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
        assert_eq!(changed, slice_ids, "only the named slice differs");

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
        BTreeSet::from(["issueDetail", "issueListV2", "listIssueByID"])
    );
    let declared_classes = corpus_queries(&corpus)
        .flat_map(|query| {
            let carrier: GraphQueryCarrierV1 =
                serde_json::from_value(query["carrier"].clone()).unwrap();
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

/// The four graph-evaluator case kinds are outside the executable G0 corpus.
/// Their separate file is a closed structural carrier: every plan and
/// invocation reconstructs, but this test performs no evaluation claim.
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
                    "audienceParity case",
                );
                let invocations = case["invocations"].as_array().expect("audience pair");
                let principals = case["principals"].as_array().expect("principal pair");
                assert_eq!(invocations.len(), 2);
                assert_eq!(principals.len(), 2);
                for invocation in invocations {
                    validate_corpus_invocation(&carrier, invocation, "listIssueByID");
                }
                assert_eq!(case["expect"]["establishment"], json!(["allow", "allow"]));
                assert_eq!(case["expect"]["strict"], json!(["allow", "allow"]));
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
                assert_ne!(
                    case["invocations"]["memberScope"]["materialization"]["graphInstanceHash"],
                    case["invocations"]["presentedInstance"]["materialization"]["graphInstanceHash"],
                    "scope mismatch must present a distinct instance identity",
                );
                assert_eq!(case["expect"]["classification"], "query-shaped");
                assert_eq!(case["expect"]["reason"], "scope-unbound");
                assert!(case["expect"]["resultBytes"].is_null());
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
        let (materialization, partition) = validate_corpus_invocation_with_disposition(
            &plan,
            call,
            case["query"].as_str().expect("executable result query"),
            disposition,
        );
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

/// The corpus retains the seven-kind schema while executing allow/deny through
/// the oracle and without pretending the four G2 records ran.
/// All nine LLP 0268 labels are present with exact satisfied/not-satisfied
/// posture, and only complete normal observation records inhabit the typed arm.
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
        json!(["pairedWorld", "allowDeny", "refusal"]),
    );
    let kinds = corpus["cases"]
        .as_array()
        .unwrap()
        .iter()
        .map(|case| case["caseKind"].as_str().unwrap())
        .collect::<BTreeSet<_>>();
    assert_eq!(
        kinds,
        BTreeSet::from(["allowDeny", "pairedWorld", "refusal"]),
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
    assert_eq!(satisfied, BTreeSet::from(["G0-BCAST-IDENTITY"]),);
    for entry in input_rows {
        match entry["status"].as_str().unwrap() {
            "SATISFIED" => assert!(entry["missingCarrier"].is_null()),
            "NOT SATISFIED" => assert!(
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
            validate_graph_captured_read_v1(&capture, &carrier.normalized_plan)
                .expect("captured dependency binds the exact plan node");
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
