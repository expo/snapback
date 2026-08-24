//! Graph captured-read registration at the durable subscription seam.
//!
//! G2-B keeps graph serving disabled, but test/test-support evaluation crosses
//! this exact validator before its dependency vector reaches the shared live
//! matcher. G2-C can therefore attach serving without inventing another
//! registration path.

pub use snapback_kernel::live_matcher::RegisteredGraphSubscriptionDependenciesV1;
#[cfg(any(test, feature = "test-support"))]
use snapback_kernel::live_matcher::attest_graph_subscription_dependencies;
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
/// This is intentionally test-support-only until graph serving exists. It
/// performs no evaluation and mints no dependency facts: the evaluator is the
/// sole capture authority, while sync owns registration.
///
/// @ref LLP 0209#51-captured-vocabulary-by-normalized-node — every graph
/// payload binds the admitted plan/node and remains paired with `GraphNode`.
#[cfg(any(test, feature = "test-support"))]
pub fn register_graph_subscription_dependencies(
    carrier: &snapback_types::manifest::GraphQueryCarrierV1,
    expected_instance_hash: &snapback_types::manifest::Sha256V1,
    materialization_hash: &snapback_types::manifest::Sha256V1,
    partition_hash: &snapback_types::manifest::Sha256V1,
    reads: &[CapturedReadDependency],
    attachments: &[GraphCapturedReadAttachmentV1],
) -> Result<
    RegisteredGraphSubscriptionDependenciesV1,
    snapback_types::manifest::GraphDemandTimeRefusalReasonV1,
> {
    attest_graph_subscription_dependencies(
        carrier,
        expected_instance_hash,
        materialization_hash,
        partition_hash,
        reads,
        attachments,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use snapback_types::manifest::GraphQueryCarrierV1;
    use snapback_types::storage::CapturedReadKind;

    fn graph_read(
        node_id: &str,
        node_kind: &str,
        dependency: serde_json::Value,
    ) -> CapturedReadDependency {
        serde_json::from_value(serde_json::json!({
            "kind":"graphNode",
            "graph":{
                "format":"snapback.graph-captured-read.v1",
                "graphPlanHash":"sha256:568efc828e03e4b56d4d09cc3d3dee804fc977d9e6c50f1f2d5b18709f8f1e1e",
                "instanceHash":"sha256:1111111111111111111111111111111111111111111111111111111111111111",
                "nodeId":node_id,
                "nodeKind":node_kind,
                "authorityClass":1,
                "dependency":dependency,
            }
        }))
        .unwrap()
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
        let instance_hash = snapback_types::manifest::Sha256V1::new(
            "sha256:1111111111111111111111111111111111111111111111111111111111111111".to_owned(),
        )
        .unwrap();
        let context_hash = snapback_types::manifest::Sha256V1::new(
            "sha256:2222222222222222222222222222222222222222222222222222222222222222".to_owned(),
        )
        .unwrap();
        let root = graph_read(
            "n0",
            "root-window",
            serde_json::json!({
                "kind":"root-range", "table":"issues", "index":"by_updated",
                "predicate":[], "order":[{"field":"updatedAt","direction":"Desc"}],
                "direction":"forward", "lower":{"kind":"unbounded"},
                "upper":{"kind":"unbounded"},
                "limit":10, "resultCount":0, "boundary":null, "complete":true
            }),
        );
        let query = CapturedReadDependency {
            graph: None,
            kind: CapturedReadKind::Query,
            table: Some("issues".to_owned()),
            id: None,
            version: Some(1),
            predicate: Some(serde_json::json!({
                "table":"issues", "filters":[], "membershipFilters":[],
                "order":[{"field":"updatedAt","direction":"Desc"}],
                "limit":10, "indexedBy":"by_updated"
            })),
            rows: Vec::new(),
            field: None,
            value: None,
            order: None,
            limit: Some(10),
            result_count: Some(0),
            boundary: None,
        };
        let projection = graph_read(
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
        assert_eq!(
            register_graph_subscription_dependencies(
                &carrier,
                &instance_hash,
                &context_hash,
                &context_hash,
                &reads,
                &attachments,
            )
            .unwrap()
            .reads(),
            reads.as_slice(),
            "registration must preserve graph and ordinary dependency ordering byte-for-byte"
        );
        assert!(
            register_graph_subscription_dependencies(
                &carrier,
                &instance_hash,
                &context_hash,
                &context_hash,
                &reads,
                &attachments[..1],
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
                &instance_hash,
                &context_hash,
                &context_hash,
                &reordered_reads,
                &reordered_attachments,
            )
            .is_err(),
            "normalized node order is a registration invariant"
        );

        let stale_instance = snapback_types::manifest::Sha256V1::new(
            "sha256:3333333333333333333333333333333333333333333333333333333333333333".to_owned(),
        )
        .unwrap();
        assert!(
            register_graph_subscription_dependencies(
                &carrier,
                &stale_instance,
                &context_hash,
                &context_hash,
                &reads,
                &attachments,
            )
            .is_err(),
            "a prior evaluation vector cannot register for a new instance"
        );
    }
}
