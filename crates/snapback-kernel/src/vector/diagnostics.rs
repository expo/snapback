//! Stable structured diagnostics for the LLP 0132 vector family.

use crate::diagnostic::SnapbackError;

pub const VECTOR_DIAGNOSTIC_SUBSYSTEM: &str = "vector";

/// Append-only public diagnostic identities. Storage and query adapters use
/// these constructors instead of spelling near-miss codes at each boundary.
pub mod code {
    pub const VALUE_INVALID: &str = "SNAPBACK_VECTOR_VALUE_INVALID";
    pub const QUERY_INVALID: &str = "SNAPBACK_VECTOR_QUERY_INVALID";
    pub const CORPUS_BOUND: &str = "SNAPBACK_VECTOR_CORPUS_BOUND";
    pub const WORK_LIMIT: &str = "SNAPBACK_VECTOR_WORK_LIMIT";
    pub const INDEX_UNAVAILABLE: &str = "SNAPBACK_VECTOR_INDEX_UNAVAILABLE";
    pub const INDEX_CORRUPT: &str = "SNAPBACK_VECTOR_INDEX_CORRUPT";
    pub const MAINTENANCE_LIMIT: &str = "SNAPBACK_VECTOR_MAINTENANCE_LIMIT";
    pub const MAINTENANCE_FAILED: &str = "SNAPBACK_VECTOR_MAINTENANCE_FAILED";
}

fn vector_error(code: &'static str, message: &'static str) -> SnapbackError {
    SnapbackError::error(code, VECTOR_DIAGNOSTIC_SUBSYSTEM, message)
}

pub fn value_invalid() -> SnapbackError {
    // diagnostics-registry: emission SNAPBACK_VECTOR_VALUE_INVALID
    vector_error(code::VALUE_INVALID, "vector value is invalid")
}

pub fn query_invalid() -> SnapbackError {
    // diagnostics-registry: emission SNAPBACK_VECTOR_QUERY_INVALID
    vector_error(code::QUERY_INVALID, "vector query is invalid")
}

pub fn corpus_bound() -> SnapbackError {
    // diagnostics-registry: emission SNAPBACK_VECTOR_CORPUS_BOUND
    vector_error(
        code::CORPUS_BOUND,
        "vector destination visibility partition exceeds its declared corpus bound",
    )
}

pub fn work_limit() -> SnapbackError {
    // diagnostics-registry: emission SNAPBACK_VECTOR_WORK_LIMIT
    vector_error(
        code::WORK_LIMIT,
        "vector query exceeds its logical work limit",
    )
}

pub fn index_unavailable() -> SnapbackError {
    // diagnostics-registry: emission SNAPBACK_VECTOR_INDEX_UNAVAILABLE
    vector_error(code::INDEX_UNAVAILABLE, "vector index is unavailable")
}

pub fn index_corrupt() -> SnapbackError {
    // diagnostics-registry: emission SNAPBACK_VECTOR_INDEX_CORRUPT
    vector_error(code::INDEX_CORRUPT, "vector index state is corrupt")
}

pub fn maintenance_limit() -> SnapbackError {
    // diagnostics-registry: emission SNAPBACK_VECTOR_MAINTENANCE_LIMIT
    vector_error(
        code::MAINTENANCE_LIMIT,
        "aggregate vector maintenance exceeds the mutation-global ceiling",
    )
}

pub fn maintenance_failed() -> SnapbackError {
    // diagnostics-registry: emission SNAPBACK_VECTOR_MAINTENANCE_FAILED
    vector_error(code::MAINTENANCE_FAILED, "vector index maintenance failed")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagnostic::DiagnosticSeverity;

    #[test]
    fn constructors_pin_the_public_vector_diagnostic_registry() {
        let diagnostics = [
            (value_invalid(), code::VALUE_INVALID),
            (query_invalid(), code::QUERY_INVALID),
            (corpus_bound(), code::CORPUS_BOUND),
            (work_limit(), code::WORK_LIMIT),
            (index_unavailable(), code::INDEX_UNAVAILABLE),
            (index_corrupt(), code::INDEX_CORRUPT),
            (maintenance_limit(), code::MAINTENANCE_LIMIT),
            (maintenance_failed(), code::MAINTENANCE_FAILED),
        ];
        for (error, expected_code) in diagnostics {
            assert_eq!(error.diagnostic.code, expected_code);
            assert_eq!(error.diagnostic.subsystem, VECTOR_DIAGNOSTIC_SUBSYSTEM);
            assert_eq!(error.diagnostic.severity, DiagnosticSeverity::Error);
            assert_eq!(error.diagnostic.details, serde_json::json!({}));
        }
    }
}
