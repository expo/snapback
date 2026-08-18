//! Compatibility façade for services-owned asset orchestration.

pub use snapback_kernel::assets::*;
pub(crate) use snapback_services::assets::{
    AssetFactsLocalExt, AssetFinalizePreparation, AssetFinalizePrepareError,
    AssetFinalizePrepareFailure, AssetFsStoreLocalExt, AssetPreparedCanonical,
    AssetPreparedCanonicalObject, AssetTusPatchTicketV1, AssetVariantPreparation,
    FinalizeCommitTicketV1, FinalizePhaseAOutcomeV1, FinalizePreflightV1, FinalizePreparationV1,
    FinalizePrepareTicketV1, FinalizePutTicketV1, prepare_asset_variant,
    prepare_required_asset_variants,
};
pub use snapback_services::assets::{AssetFsStore, detect_content_type, schema_registrations};
