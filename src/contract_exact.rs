//! Snapback-side Contract/Exact integration helpers.
//!
//! @ref LLP 0021#phase-0-codify-the-current-bridge-and-recipe — wrong
//! browser/native server shapes must fail with structured diagnostics, while
//! core Snapback keeps working without Exact installed.

use crate::diagnostic::{Diagnostic, SnapbackError};
use serde_json::json;

/// True when a request targets the Exact static/native discovery tree emitted
/// by the Contract admin build.
pub fn is_exact_static_artifact_path(path: &str) -> bool {
    path == "__exact/platform-manifest.json" || path.starts_with("__exact/native/")
}

/// A native Exact shell requested static/native artifacts from a server that
/// has no admin dist configured.
pub fn native_artifacts_unavailable(path: &str) -> SnapbackError {
    SnapbackError::new(
        Diagnostic::error(
            "SNAPBACK_CAPABILITY_EXACT_NATIVE_ARTIFACTS_UNAVAILABLE",
            "contract-integration",
            "native Exact artifacts were requested, but this Snapback server has no built admin dist configured",
        )
        .with_details(json!({
            "target_surface": "native Exact",
            "requested_path": path,
            "admin_dist_configured": false,
            "expected_artifacts": [
                "__exact/platform-manifest.json",
                "__exact/native/mac-appkit-hermes/exact-native.json",
                "__exact/native/mac-appkit-hermes/startup.js"
            ],
            "next_checks": [
                "build admin-ui with ./build.sh",
                "serve the built admin-ui/dist snapshot, or let Snapback auto-discover it in a prepared checkout"
            ]
        })),
    )
}

/// A dist was configured, but the requested native/static Exact artifact was
/// absent. This is usually a stale or browser-only admin build.
pub fn native_artifact_missing(path: &str) -> SnapbackError {
    SnapbackError::new(
        Diagnostic::error(
            "SNAPBACK_CAPABILITY_EXACT_NATIVE_ARTIFACT_MISSING",
            "contract-integration",
            "native Exact artifact is missing from the configured admin dist",
        )
        .with_details(json!({
            "target_surface": "native Exact",
            "requested_path": path,
            "admin_dist_configured": true,
            "next_checks": [
                "rebuild admin-ui with the Exact static/native exporter enabled",
                "confirm admin-ui/dist/__exact/platform-manifest.json exists"
            ]
        })),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_exact_static_artifact_paths() {
        assert!(is_exact_static_artifact_path(
            "__exact/platform-manifest.json"
        ));
        assert!(is_exact_static_artifact_path(
            "__exact/native/mac-appkit-hermes/exact-native.json"
        ));
        assert!(!is_exact_static_artifact_path("__exact/other.json"));
        assert!(!is_exact_static_artifact_path("assets/app.js"));
    }

    #[test]
    fn diagnostics_are_capability_family_codes() {
        assert_eq!(
            native_artifacts_unavailable("__exact/platform-manifest.json")
                .diagnostic
                .code,
            "SNAPBACK_CAPABILITY_EXACT_NATIVE_ARTIFACTS_UNAVAILABLE"
        );
        assert_eq!(
            native_artifact_missing("__exact/native/mac-appkit-hermes/exact-native.json")
                .diagnostic
                .code,
            "SNAPBACK_CAPABILITY_EXACT_NATIVE_ARTIFACT_MISSING"
        );
    }
}
