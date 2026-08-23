//! Registered G0 graph captured-read vocabulary.
//!
//! Matcher consumption intentionally waits for LLP 0209 G2; this module is
//! the sync-owned schema/shape boundary only.

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

#[cfg(test)]
mod tests {
    use super::*;
    use snapback_types::storage::CapturedReadKind;

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
}
