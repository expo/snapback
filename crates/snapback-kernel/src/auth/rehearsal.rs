pub use snapback_types::auth::rehearsal::*;

use crate::diagnostic::SnapbackError;

pub fn carrier_required() -> SnapbackError {
    snapback_types::auth::rehearsal::carrier_required().into()
}
pub fn profile_forbidden() -> SnapbackError {
    snapback_types::auth::rehearsal::profile_forbidden().into()
}
pub fn config_forbidden() -> SnapbackError {
    snapback_types::auth::rehearsal::config_forbidden().into()
}

pub fn request_invalid() -> SnapbackError {
    snapback_types::auth::rehearsal::request_invalid().into()
}
pub fn scope_denied() -> SnapbackError {
    snapback_types::auth::rehearsal::scope_denied().into()
}
pub fn selector_denied() -> SnapbackError {
    snapback_types::auth::rehearsal::selector_denied().into()
}
pub fn binding_mismatch() -> SnapbackError {
    snapback_types::auth::rehearsal::binding_mismatch().into()
}
pub fn expired() -> SnapbackError {
    snapback_types::auth::rehearsal::expired().into()
}
pub fn authority_ended() -> SnapbackError {
    snapback_types::auth::rehearsal::authority_ended().into()
}
pub fn budget_exhausted(counter: &str) -> SnapbackError {
    snapback_types::auth::rehearsal::budget_exhausted(counter).into()
}
pub fn idempotency_conflict() -> SnapbackError {
    snapback_types::auth::rehearsal::idempotency_conflict().into()
}
pub fn namespace_unavailable() -> SnapbackError {
    snapback_types::auth::rehearsal::namespace_unavailable().into()
}
pub fn namespace_consumed() -> SnapbackError {
    snapback_types::auth::rehearsal::namespace_consumed().into()
}
pub fn reachability_public() -> SnapbackError {
    snapback_types::auth::rehearsal::reachability_public().into()
}
pub fn reachability_invalid() -> SnapbackError {
    snapback_types::auth::rehearsal::reachability_invalid().into()
}
pub fn producer_parity() -> SnapbackError {
    snapback_types::auth::rehearsal::producer_parity().into()
}
pub fn disposable_required() -> SnapbackError {
    snapback_types::auth::rehearsal::disposable_required().into()
}
pub fn state_present() -> SnapbackError {
    snapback_types::auth::rehearsal::state_present().into()
}
pub fn envelope_invalid() -> SnapbackError {
    snapback_types::auth::rehearsal::envelope_invalid().into()
}
pub fn export_key_unavailable() -> SnapbackError {
    snapback_types::auth::rehearsal::export_key_unavailable().into()
}
pub fn provenance_invalid() -> SnapbackError {
    snapback_types::auth::rehearsal::provenance_invalid().into()
}
pub fn egress_refused() -> SnapbackError {
    snapback_types::auth::rehearsal::egress_refused().into()
}

pub fn window_namespace_digest(namespace: &str) -> crate::diagnostic::SnapbackResult<String> {
    snapback_types::auth::rehearsal::window_namespace_digest(namespace).map_err(Into::into)
}

pub fn digest_serializable<T: serde::Serialize>(
    domain: &[u8],
    value: &T,
) -> crate::diagnostic::SnapbackResult<String> {
    snapback_types::auth::rehearsal::digest_serializable(domain, value).map_err(Into::into)
}

pub fn derive_export_verification_key(
    auth_key: &[u8; 32],
    source_store_id: &str,
    source_key_id: &str,
) -> crate::diagnostic::SnapbackResult<RehearsalExportVerificationKey> {
    snapback_types::auth::rehearsal::derive_export_verification_key(
        auth_key,
        source_store_id,
        source_key_id,
    )
    .map_err(Into::into)
}

pub fn seal_export_envelope(
    payload: &[u8],
    markers: &AuthRehearsalStoreMarkersV1,
    snapshot_witness: AuthRehearsalSnapshotWitnessV1,
    source_key_id: String,
    key: &RehearsalExportVerificationKey,
) -> crate::diagnostic::SnapbackResult<AuthRehearsalExportEnvelopeV1> {
    snapback_types::auth::rehearsal::seal_export_envelope(
        payload,
        markers,
        snapshot_witness,
        source_key_id,
        key,
    )
    .map_err(Into::into)
}

pub fn verify_export_envelope(
    envelope: &AuthRehearsalExportEnvelopeV1,
    payload: &[u8],
    key: &RehearsalExportVerificationKey,
) -> crate::diagnostic::SnapbackResult<AuthRehearsalLogicalExportPayloadV1> {
    snapback_types::auth::rehearsal::verify_export_envelope(envelope, payload, key)
        .map_err(Into::into)
}

pub fn write_export_verification_key_capsule(
    path: &std::path::Path,
    source_store_id: &str,
    source_key_id: &str,
    key: &RehearsalExportVerificationKey,
) -> crate::diagnostic::SnapbackResult<()> {
    snapback_types::auth::rehearsal::write_export_verification_key_capsule(
        path,
        source_store_id,
        source_key_id,
        key,
    )
    .map_err(Into::into)
}

pub fn read_export_verification_key_capsule(
    path: &std::path::Path,
    expected_source_store_id: &str,
    expected_source_key_id: &str,
) -> crate::diagnostic::SnapbackResult<RehearsalExportVerificationKey> {
    snapback_types::auth::rehearsal::read_export_verification_key_capsule(
        path,
        expected_source_store_id,
        expected_source_key_id,
    )
    .map_err(Into::into)
}

pub fn parse_rehearsal_capability_file(
    bytes: zeroize::Zeroizing<Vec<u8>>,
) -> crate::diagnostic::SnapbackResult<crate::auth::crypto::RehearsalBearer> {
    snapback_types::auth::rehearsal::parse_rehearsal_capability_file(bytes).map_err(Into::into)
}
