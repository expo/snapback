pub use snapback_types::authoring_suggestion::*;

pub fn unknown_function_error(
    manifest: &crate::manifest::FunctionManifest,
    guessed: &str,
    expected_kinds: &[crate::manifest::FunctionKind],
) -> crate::diagnostic::SnapbackError {
    snapback_types::authoring_suggestion::unknown_function_error(manifest, guessed, expected_kinds)
        .into()
}
