pub use snapback_types::contract_exact::*;

pub fn native_artifacts_unavailable(path: &str) -> crate::diagnostic::SnapbackError {
    snapback_types::contract_exact::native_artifacts_unavailable(path).into()
}

pub fn native_artifact_missing(path: &str) -> crate::diagnostic::SnapbackError {
    snapback_types::contract_exact::native_artifact_missing(path).into()
}
