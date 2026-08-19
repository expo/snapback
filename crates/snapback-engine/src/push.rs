//! Compatibility façade for the services-owned push pipeline.

use crate::diagnostic::SnapbackResult;

pub(crate) use snapback_kernel::push::{
    PUSH_BATCH_MESSAGES_MAX, PUSH_PROVIDER_RESPONSE_MAX_BYTES, PUSH_RECEIPT_BATCH_MAX,
    PUSH_RECEIPT_FIRST_POLL_MS, PUSH_RECEIPT_WINDOW_MS, PushBatchClaimV1, PushBatchSettlementV1,
    PushDeferredGrantRequestV1, PushLedgerRowV1, PushReceiptOutcomeV1, PushReceiptPollClaimV1,
    PushRecoveredBatchV1, PushSendRequestV1, PushSendReservationResponseV1, PushStorageAuthority,
    PushTicketOutcomeV1, PushTokenRegistrationResponse, PushTokenUnregisterResponse,
    PushTriggerModeV1, REGISTRY_TABLE_SQL, ReservedPushAttemptV1, capture_deferred_grant,
    expo_receipt_payload, expo_send_payload_from_parts, parse_expo_receipt_response,
    resolve_audience_in, validate_audience_args, validate_config_uses,
    validate_declaration_against_schema, validate_exact_ledger_schema, validate_provider_id,
    validate_receipt_error_code, validate_ticket_error_code, validate_token,
};
pub(crate) use snapback_services::push::{
    ExpoHttpResponseV1, ExpoHttpUncertaintyV1, RegisterPushTokenRequest,
    UnregisterPushTokenRequest, classify_expo_send_response, expo_send_payload, post_expo_json,
};
pub use snapback_services::push::{
    PushAudienceReferenceV1, PushDeferredGrantV1, PushRegistryInspectionV1,
};
pub use snapback_types::push::*;

/// The sole adapter from admitted invocation authority to the kernel's
/// storage-only push fact. The kernel fact is intentionally not re-exported
/// through the public façade, so callers cannot assert `System` themselves.
///
/// @ref LLP 0276#phases — port inversion must preserve compiler-enforced
/// admission rather than accept a caller assertion.
pub(crate) fn admitted_push_storage_authority(
    authority: &crate::auth::invocation::PreparedAuthority,
) -> PushStorageAuthority {
    if matches!(
        authority.resolved(),
        crate::auth::invocation::ResolvedAppAuthority::System
    ) {
        PushStorageAuthority::System
    } else if let Some(user_id) = authority.projection().user_id() {
        PushStorageAuthority::User(user_id.to_owned())
    } else {
        PushStorageAuthority::Other
    }
}

/// Crate-private commit adapter: every call must supply the unforgeable
/// prepared invocation carrier, and only this adapter projects the kernel
/// authority fact consumed by the transaction.
pub(crate) trait PreparedPushRegistryExt {
    #[allow(clippy::too_many_arguments)]
    fn reserve_send(
        &mut self,
        declaration: &PushSeamDeclarationV1,
        schema: &crate::manifest::SchemaManifest,
        authority: impl FnOnce() -> crate::auth::invocation::PreparedAuthority,
        trigger_mode: PushTriggerModeV1,
        deferred_grant: Option<&PushDeferredGrantV1>,
        request: &PushSendRequestV1,
        now_ms: u64,
    ) -> SnapbackResult<ReservedPushAttemptV1>;
}

impl PreparedPushRegistryExt for crate::storage::PushRegistryKernel<'_> {
    fn reserve_send(
        &mut self,
        declaration: &PushSeamDeclarationV1,
        schema: &crate::manifest::SchemaManifest,
        authority: impl FnOnce() -> crate::auth::invocation::PreparedAuthority,
        trigger_mode: PushTriggerModeV1,
        deferred_grant: Option<&PushDeferredGrantV1>,
        request: &PushSendRequestV1,
        now_ms: u64,
    ) -> SnapbackResult<ReservedPushAttemptV1> {
        let authority = authority();
        authority.validate_admission("push durable reservation")?;
        self.reserve_send_admitted_storage(
            declaration,
            schema,
            admitted_push_storage_authority(&authority),
            trigger_mode,
            deferred_grant,
            request,
            now_ms,
        )
    }
}

pub(crate) fn read_ledger_projection_for_prepared(
    db: &crate::storage::DbRead<'_>,
    declaration: &PushSeamDeclarationV1,
    schema: &crate::manifest::SchemaManifest,
    authority: &crate::auth::invocation::PreparedAuthority,
    intent_id: &str,
) -> SnapbackResult<(
    Vec<PushLedgerRowV1>,
    Option<crate::storage::CapturedReadDependency>,
)> {
    authority.validate_admission("push ledger projection")?;
    snapback_kernel::push::read_ledger_projection(
        db,
        declaration,
        schema,
        &admitted_push_storage_authority(authority),
        intent_id,
    )
}

// The one engine-level provisioning test remains in the rank-7 remainder.
#[cfg(test)]
#[path = "push_remainder_tests.rs"]
mod tests;

// PreparedAuthority is still owned by the rank-7 remainder. Include only the
// authority-dependent slice of the moved suite under the old crate root.
#[cfg(test)]
#[path = "../../snapback-services/src/push.rs"]
mod remainder_authority_tests;
