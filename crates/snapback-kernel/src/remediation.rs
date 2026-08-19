pub use snapback_types::remediation::*;

pub fn apply_remediation(
    surfaces: &ServedSurfacesV1<'_>,
    input: RemediationApplyInputV1,
) -> crate::diagnostic::SnapbackResult<RemediationApplyResultV1> {
    snapback_types::remediation::apply_remediation(surfaces, input).map_err(Into::into)
}
