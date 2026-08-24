//! Graph captured-read registration at the durable subscription seam.
//!
//! Evaluator output crosses this exact validator before its dependency vector
//! reaches the shared live matcher. G2-C attaches serving here rather than
//! inventing a second registration path.

pub use snapback_kernel::live_matcher::RegisteredGraphSubscriptionDependenciesV1;
use snapback_kernel::live_matcher::attest_graph_subscription_dependencies;
pub use snapback_kernel::live_matcher::{
    GraphCapturedQueryOutputV1, GraphRegistrationPermissionValuesV1,
    GraphSubscriptionRegistrationDemandV1,
};
pub use snapback_types::manifest::{
    GraphCapturedDependencyV1, GraphCapturedReadAttachmentV1, GraphCapturedReadV1,
    validate_graph_captured_read_v1,
};
use snapback_types::storage::CapturedReadDependency;

/// Enforce the shared-carrier invariant without interpreting graph matching
/// semantics.
///
/// @ref LLP 0209#51-captured-vocabulary-by-normalized-node — the optional
/// graph payload is present exactly for the single additive `GraphNode` kind.
pub fn graph_capture_carrier_is_well_formed(read: &CapturedReadDependency) -> bool {
    read.graph_pairing_is_valid()
}

/// Validate and retain the evaluator-emitted dependency vector in the exact
/// shared carrier consumed by relational/handler live subscriptions.
///
/// It performs no evaluation and mints no dependency facts: the evaluator is
/// the sole capture authority, while sync owns registration.
///
/// @ref LLP 0209#51-captured-vocabulary-by-normalized-node — every graph
/// payload binds the admitted plan/node and remains paired with `GraphNode`.
pub fn register_graph_subscription_dependencies(
    carrier: &snapback_types::manifest::GraphQueryCarrierV1,
    schema: &snapback_types::manifest::SchemaManifest,
    demand: &GraphSubscriptionRegistrationDemandV1,
    reads: &[CapturedReadDependency],
    attachments: &[GraphCapturedReadAttachmentV1],
    query_outputs: &[GraphCapturedQueryOutputV1],
) -> Result<
    RegisteredGraphSubscriptionDependenciesV1,
    snapback_types::manifest::GraphDemandTimeRefusalReasonV1,
> {
    attest_graph_subscription_dependencies(
        carrier,
        schema,
        demand,
        reads,
        attachments,
        query_outputs,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use snapback_types::manifest::*;
    use snapback_types::storage::CapturedReadKind;
    use std::collections::BTreeMap;

    fn graph_read(
        instance_hash: &Sha256V1,
        node_id: &str,
        node_kind: &str,
        dependency: serde_json::Value,
    ) -> CapturedReadDependency {
        serde_json::from_value(serde_json::json!({
            "kind":"graphNode",
            "graph":{
                "format":"snapback.graph-captured-read.v1",
                "graphPlanHash":"sha256:568efc828e03e4b56d4d09cc3d3dee804fc977d9e6c50f1f2d5b18709f8f1e1e",
                "instanceHash":instance_hash,
                "nodeId":node_id,
                "nodeKind":node_kind,
                "authorityClass":1,
                "dependency":dependency,
            }
        }))
        .unwrap()
    }

    fn registration_demand(carrier: &GraphQueryCarrierV1) -> GraphSubscriptionRegistrationDemandV1 {
        let windows = vec![GraphNodeWindowIdentityV1 {
            node_id: "n0".to_owned(),
            intervals: vec![GraphParentWindowIdentityV1 {
                parent_key: None,
                window: GraphWindowIdentityV1 {
                    order: vec![OrderExpr {
                        field: "updatedAt".to_owned(),
                        direction: OrderDirection::Desc,
                        max_encoded_bytes: None,
                    }],
                    direction: GraphDirectionV1::Forward,
                    lower: GraphIntervalEndV1::Unbounded,
                    upper: GraphIntervalEndV1::Unbounded,
                    take: 2,
                },
            }],
        }];
        let instance = graph_instance_identity_v1(
            carrier,
            &serde_json::json!({}),
            windows.clone(),
            &BTreeMap::new(),
        )
        .unwrap();
        let materialization_preimage: GraphMaterializationPreimageV1 =
            serde_json::from_value(serde_json::json!({
                "format":"snapback.graph-materialization.v1",
                "appId":"registration-test",
                "databaseId":"database",
                "deploymentId":"deployment",
                "targetProfileId":"local",
                "activationHash":"sha256:0000000000000000000000000000000000000000000000000000000000000000",
                "function":{
                    "artifactKind":"functionReference",
                    "schemaVersion":"snapback.v1",
                    "appId":"registration-test",
                    "id":"graph-test",
                    "name":"graphTest",
                    "kind":"LiveQuery",
                    "implementationHash":"sha256:0000000000000000000000000000000000000000000000000000000000000000",
                    "argsContractHash":"sha256:0000000000000000000000000000000000000000000000000000000000000000",
                    "resultContractHash":carrier.normalized_plan.result_contract_hash,
                    "expectedGeneration":{
                        "schemaVersion":"snapback.v1", "appId":"registration-test",
                        "schemaHash":"schema", "bundleHash":"bundle", "inputsHash":"inputs"
                    }
                },
                "graphInstanceHash":instance.instance_hash,
            }))
            .unwrap();
        let materialization = graph_materialization_identity_v1(materialization_preimage).unwrap();
        let partition = graph_authority_partition_identity_v1(GraphAuthorityPartitionPreimageV1 {
            format: "snapback.graph-authority-partition.v1".to_owned(),
            graph_plan_hash: carrier.plan_hash.clone(),
            class2: Vec::new(),
            class3: None,
        })
        .unwrap();
        GraphSubscriptionRegistrationDemandV1 {
            args: serde_json::json!({}),
            windows,
            input: HandlerInput {
                args: serde_json::json!({}),
                auth: AuthInput::default(),
                read_set: Vec::new(),
                correlation: None,
                ctx_ledger: None,
            },
            permission_values_by_table: BTreeMap::new(),
            materialization,
            partition,
        }
    }

    #[test]
    fn graph_captured_read_v1_requires_payload_exactly_for_graph_kind() {
        let ordinary = CapturedReadDependency {
            graph: None,
            kind: CapturedReadKind::Auth,
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
        assert!(graph_capture_carrier_is_well_formed(&ordinary));
        let mut explicit_null = serde_json::to_value(&ordinary).unwrap();
        explicit_null["graph"] = serde_json::Value::Null;
        assert!(serde_json::from_value::<CapturedReadDependency>(explicit_null).is_err());
        assert!(!graph_capture_carrier_is_well_formed(
            &CapturedReadDependency {
                graph: None,
                kind: CapturedReadKind::GraphNode,
                ..ordinary
            }
        ));
    }

    #[test]
    fn registration_attests_exact_identity_attachment_and_node_order() {
        let carrier: GraphQueryCarrierV1 = serde_json::from_str(include_str!(
            "../../../tests/conformance/graph/minimal-carrier.v1.json"
        ))
        .unwrap();
        let demand = registration_demand(&carrier);
        let instance_hash = demand.materialization.preimage.graph_instance_hash.clone();
        let root = graph_read(
            &instance_hash,
            "n0",
            "root-window",
            serde_json::json!({
                "kind":"root-range", "table":"issues", "index":"by_updated",
                "predicate":[], "order":[{"field":"updatedAt","direction":"Desc"}],
                "direction":"forward", "lower":{"kind":"unbounded"},
                "upper":{"kind":"unbounded"},
                "limit":2, "resultCount":0, "boundary":null, "complete":true
            }),
        );
        let query = CapturedReadDependency {
            graph: None,
            kind: CapturedReadKind::Query,
            table: Some("issues".to_owned()),
            id: None,
            version: Some(1),
            predicate: Some(serde_json::json!({
                "table":"issues", "filters":[],
                "order":[{"field":"updatedAt","direction":"Desc"}],
                "limit":2, "indexed_by":"by_updated"
            })),
            rows: Vec::new(),
            field: None,
            value: None,
            order: Some(serde_json::json!([{"field":"updatedAt","direction":"Desc"}])),
            limit: Some(2),
            result_count: Some(0),
            boundary: None,
        };
        let projection = graph_read(
            &instance_hash,
            "n1",
            "closed-projection",
            serde_json::json!({"kind":"projection", "sourceNodeIds":["n0"]}),
        );
        let reads = vec![root.clone(), query.clone(), projection.clone()];
        let attachments = vec![
            GraphCapturedReadAttachmentV1 {
                graph_read_index: 0,
                ordinary_read_indices: vec![1],
            },
            GraphCapturedReadAttachmentV1 {
                graph_read_index: 2,
                ordinary_read_indices: Vec::new(),
            },
        ];
        let query_outputs = vec![GraphCapturedQueryOutputV1 {
            query_read_index: 1,
            rows: Vec::new(),
        }];
        assert_eq!(
            register_graph_subscription_dependencies(
                &carrier,
                &SchemaManifest::default(),
                &demand,
                &reads,
                &attachments,
                &query_outputs,
            )
            .unwrap()
            .reads(),
            reads.as_slice(),
            "registration must preserve graph and ordinary dependency ordering byte-for-byte"
        );
        assert!(
            register_graph_subscription_dependencies(
                &carrier,
                &SchemaManifest::default(),
                &demand,
                &reads,
                &attachments[..1],
                &query_outputs,
            )
            .is_err(),
            "every graph read needs an explicit attachment"
        );
        let reordered_reads = vec![projection, root, query];
        let reordered_attachments = vec![
            GraphCapturedReadAttachmentV1 {
                graph_read_index: 0,
                ordinary_read_indices: Vec::new(),
            },
            GraphCapturedReadAttachmentV1 {
                graph_read_index: 1,
                ordinary_read_indices: vec![2],
            },
        ];
        assert!(
            register_graph_subscription_dependencies(
                &carrier,
                &SchemaManifest::default(),
                &demand,
                &reordered_reads,
                &reordered_attachments,
                &[GraphCapturedQueryOutputV1 {
                    query_read_index: 2,
                    rows: Vec::new(),
                }],
            )
            .is_err(),
            "normalized node order is a registration invariant"
        );

        let stale_instance = snapback_types::manifest::Sha256V1::new(
            "sha256:3333333333333333333333333333333333333333333333333333333333333333".to_owned(),
        )
        .unwrap();
        let mut stale_demand = demand.clone();
        stale_demand.materialization.preimage.graph_instance_hash = stale_instance;
        assert!(
            register_graph_subscription_dependencies(
                &carrier,
                &SchemaManifest::default(),
                &stale_demand,
                &reads,
                &attachments,
                &query_outputs,
            )
            .is_err(),
            "a prior evaluation vector cannot register for a new instance"
        );
    }
}
