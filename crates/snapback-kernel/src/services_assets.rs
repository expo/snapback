//! Opaque asset-continuity carriers shared only with `snapback-services`.
//!
//! This module is deliberately not re-exported through the supported
//! `snapback::storage` façade. The carriers own kernel-loaded records, so a
//! higher adapter cannot combine a valid token with caller-authored fields.

use crate::assets::{AssetAttemptRecordV1, AssetPublicationRecordV1};
use crate::diagnostic::SnapbackResult;
use crate::storage::{AssetAttemptsKernel, AssetPreparedVariant};

/// Kernel-loaded proof of the exact current attempt snapshot.
///
/// The private field is a compile-time boundary: even a caller that can name
/// this unpublished inter-crate type cannot forge the record it carries.
///
/// ```compile_fail
/// use snapback_kernel::services_assets::AssetAttemptCurrentProof;
///
/// let _forged = AssetAttemptCurrentProof { attempt: unreachable!() };
/// ```
pub struct AssetAttemptCurrentProof {
    attempt: AssetAttemptRecordV1,
}

impl AssetAttemptCurrentProof {
    pub(crate) fn new(attempt: AssetAttemptRecordV1) -> Self {
        Self { attempt }
    }

    pub fn attempt(&self) -> &AssetAttemptRecordV1 {
        &self.attempt
    }

    pub fn into_attempt(self) -> AssetAttemptRecordV1 {
        self.attempt
    }
}

/// Proof that the kernel committed and reloaded the exact open publication
/// owned by an upload attempt. Recovery may already have advanced the row from
/// `planned` to `staged`; both states prove the write-ahead handoff.
///
/// ```compile_fail
/// use snapback_kernel::services_assets::AssetPublicationPlannedProof;
///
/// let _forged = AssetPublicationPlannedProof { publication: unreachable!() };
/// ```
pub struct AssetPublicationPlannedProof {
    publication: AssetPublicationRecordV1,
}

impl AssetPublicationPlannedProof {
    pub(crate) fn new(publication: AssetPublicationRecordV1) -> Self {
        Self { publication }
    }

    pub fn into_publication(self) -> AssetPublicationRecordV1 {
        self.publication
    }
}

/// Proof that the kernel committed and reloaded the exact attempt-less width
/// publication accepted by an external PUT. This is deliberately distinct
/// from [`AssetPublicationPlannedProof`], so an attempt-owned required
/// rendition cannot cross into the on-demand width lifecycle.
///
/// ```compile_fail
/// use snapback_kernel::services_assets::AssetWidthPublicationPlannedProof;
///
/// let _forged = AssetWidthPublicationPlannedProof { publication: unreachable!() };
/// ```
pub struct AssetWidthPublicationPlannedProof {
    publication: AssetPublicationRecordV1,
}

impl AssetWidthPublicationPlannedProof {
    pub(crate) fn new(publication: AssetPublicationRecordV1) -> Self {
        Self { publication }
    }

    pub fn publication(&self) -> &AssetPublicationRecordV1 {
        &self.publication
    }

    #[allow(clippy::too_many_arguments)]
    pub fn into_prepared_variant(
        self,
        key: String,
        width: u64,
        digest: String,
        byte_length: u64,
        content_type: String,
        recipe_version: u64,
    ) -> AssetWidthPreparedVariant {
        AssetWidthPreparedVariant {
            prepared: AssetPreparedVariant {
                key,
                width,
                publication: self.publication,
                digest,
                byte_length,
                content_type,
                recipe_version,
            },
        }
    }
}

/// Opaque width-only commit carrier. A services-owned width commit ticket
/// carries this type instead of a raw [`AssetPreparedVariant`], preventing the
/// intended ticket path from being passed to the ordinary attempt/runner
/// staging helper by mistake. This is type-state guidance for that path, not a
/// claim that every caller of the unpublished kernel API is structurally
/// unable to construct an ordinary prepared variant.
pub struct AssetWidthPreparedVariant {
    prepared: AssetPreparedVariant,
}

impl AssetWidthPreparedVariant {
    pub(crate) fn prepared(&self) -> &AssetPreparedVariant {
        &self.prepared
    }

    pub(crate) fn prepared_mut(&mut self) -> &mut AssetPreparedVariant {
        &mut self.prepared
    }
}

/// Unpublished inter-crate seam for minting the opaque continuity proofs used
/// by services-owned asset tickets. The supported façade does not re-export
/// this module or trait.
///
/// @ref LLP 0276#phases — a port may carry admitted facts only through an
/// opaque lower-crate carrier; its raw constructor and commit seam stay off
/// the supported façade.
pub trait AssetAttemptsProofLocalExt {
    fn attempt_require_current_proof(
        &mut self,
        attempt: &AssetAttemptRecordV1,
    ) -> SnapbackResult<AssetAttemptCurrentProof>;

    fn attempt_finalize_commit_plan_proved(
        &mut self,
        app_id: &str,
        attempt_id: &str,
        digest: &str,
        now: u64,
    ) -> SnapbackResult<AssetPublicationPlannedProof>;

    fn attempt_finalize_commit_plan_proved_guarded<G, BeforeCommit>(
        &mut self,
        app_id: &str,
        attempt_id: &str,
        digest: &str,
        now: u64,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<AssetPublicationPlannedProof>
    where
        BeforeCommit: FnOnce() -> SnapbackResult<G>;

    #[allow(clippy::too_many_arguments)]
    fn stage_attempt_variant_plan_proved_guarded<G, BeforeCommit>(
        &mut self,
        app_id: &str,
        attempt_id: &str,
        asset_id: &str,
        variant_key: &str,
        digest: &str,
        now: u64,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<AssetPublicationPlannedProof>
    where
        BeforeCommit: FnOnce() -> SnapbackResult<G>;

    #[allow(clippy::too_many_arguments)]
    fn stage_width_variant_plan_proved_guarded<G, BeforeCommit>(
        &mut self,
        app_id: &str,
        asset_id: &str,
        variant_key: &str,
        digest: &str,
        now: u64,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<AssetWidthPublicationPlannedProof>
    where
        BeforeCommit: FnOnce() -> SnapbackResult<G>;
}

impl AssetAttemptsProofLocalExt for AssetAttemptsKernel<'_> {
    fn attempt_require_current_proof(
        &mut self,
        attempt: &AssetAttemptRecordV1,
    ) -> SnapbackResult<AssetAttemptCurrentProof> {
        self.attempt_require_current_proof(attempt)
    }

    fn attempt_finalize_commit_plan_proved(
        &mut self,
        app_id: &str,
        attempt_id: &str,
        digest: &str,
        now: u64,
    ) -> SnapbackResult<AssetPublicationPlannedProof> {
        self.attempt_finalize_commit_plan_proved(app_id, attempt_id, digest, now)
    }

    fn attempt_finalize_commit_plan_proved_guarded<G, BeforeCommit>(
        &mut self,
        app_id: &str,
        attempt_id: &str,
        digest: &str,
        now: u64,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<AssetPublicationPlannedProof>
    where
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        self.attempt_finalize_commit_plan_proved_guarded(
            app_id,
            attempt_id,
            digest,
            now,
            before_commit,
        )
    }

    fn stage_attempt_variant_plan_proved_guarded<G, BeforeCommit>(
        &mut self,
        app_id: &str,
        attempt_id: &str,
        asset_id: &str,
        variant_key: &str,
        digest: &str,
        now: u64,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<AssetPublicationPlannedProof>
    where
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        self.stage_attempt_variant_plan_proved_guarded(
            app_id,
            attempt_id,
            asset_id,
            variant_key,
            digest,
            now,
            before_commit,
        )
    }

    fn stage_width_variant_plan_proved_guarded<G, BeforeCommit>(
        &mut self,
        app_id: &str,
        asset_id: &str,
        variant_key: &str,
        digest: &str,
        now: u64,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<AssetWidthPublicationPlannedProof>
    where
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        self.stage_width_variant_plan_proved_guarded(
            app_id,
            asset_id,
            variant_key,
            digest,
            now,
            before_commit,
        )
    }
}
