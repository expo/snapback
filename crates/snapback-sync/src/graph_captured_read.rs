//! Graph captured-read registration at the durable subscription seam.
//!
//! G2-B keeps graph serving disabled, but test/test-support evaluation crosses
//! this exact validator before its dependency vector reaches the shared live
//! matcher. G2-C can therefore attach serving without inventing another
//! registration path.

pub use snapback_types::manifest::{
    GraphCapturedDependencyV1, GraphCapturedReadV1, validate_graph_captured_read_v1,
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
    plan: &snapback_types::manifest::GraphQueryPlanV1,
    reads: &[CapturedReadDependency],
) -> Result<Vec<CapturedReadDependency>, snapback_types::manifest::GraphDemandTimeRefusalReasonV1> {
    use snapback_types::manifest::{GraphCapturedDependencyV1, GraphDemandTimeRefusalReasonV1};

    if reads.iter().any(|read| !read.graph_pairing_is_valid()) {
        return Err(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch);
    }
    let mut last_node_index = 0_usize;
    let mut saw_graph = false;
    let mut saw_root = false;
    let mut saw_projection = false;
    for capture in reads.iter().filter_map(|read| read.graph.as_ref()) {
        validate_graph_captured_read_v1(capture, plan)?;
        let node_index = plan
            .nodes
            .iter()
            .position(|node| node.node_id() == capture.node_id)
            .ok_or(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch)?;
        if saw_graph && node_index < last_node_index {
            return Err(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch);
        }
        saw_graph = true;
        last_node_index = node_index;
        saw_root |= matches!(
            capture.dependency,
            GraphCapturedDependencyV1::RootRange { .. }
        );
        saw_projection |= matches!(
            capture.dependency,
            GraphCapturedDependencyV1::Projection { .. }
        );
    }
    if !saw_graph || !saw_root || !saw_projection {
        return Err(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch);
    }
    Ok(reads.to_vec())
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
    fn registration_retains_exact_shared_vector_and_rejects_incomplete_or_reordered_graphs() {
        let carrier: GraphQueryCarrierV1 = serde_json::from_str(include_str!(
            "../../../tests/conformance/graph/minimal-carrier.v1.json"
        ))
        .unwrap();
        let root = graph_read(
            "n0",
            "root-window",
            serde_json::json!({
                "kind":"root-range", "table":"issues", "index":"by_updated",
                "predicate":[], "order":[{"field":"updatedAt","direction":"Desc"}],
                "limit":10, "resultCount":0, "boundary":null, "complete":true
            }),
        );
        let query = CapturedReadDependency {
            graph: None,
            kind: CapturedReadKind::Query,
            table: Some("issues".to_owned()),
            id: None,
            version: Some(1),
            predicate: None,
            rows: Vec::new(),
            field: None,
            value: None,
            order: None,
            limit: Some(10),
            result_count: Some(0),
            boundary: Some(serde_json::json!({"complete":true})),
        };
        let projection = graph_read(
            "n1",
            "closed-projection",
            serde_json::json!({"kind":"projection", "sourceNodeIds":["n0"]}),
        );
        let reads = vec![root.clone(), query.clone(), projection.clone()];
        assert_eq!(
            register_graph_subscription_dependencies(&carrier.normalized_plan, &reads).unwrap(),
            reads,
            "registration must preserve graph and ordinary dependency ordering byte-for-byte"
        );
        assert!(
            register_graph_subscription_dependencies(
                &carrier.normalized_plan,
                &[root.clone(), query]
            )
            .is_err(),
            "projection is part of the complete graph capture vector"
        );
        assert!(
            register_graph_subscription_dependencies(&carrier.normalized_plan, &[projection, root])
                .is_err(),
            "normalized node order is a registration invariant"
        );
    }
}
