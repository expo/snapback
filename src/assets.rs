//! Asset subsystem groundwork: the Snapback-owned system tables, the local
//! filesystem byte store, and the Rust-owned wire DTOs.
//!
//! @ref LLP 0044#internal-model — four records with distinct jobs (asset,
//!   upload attempt, blob, rendition) plus the reverse-reference edge,
//!   publication record, and asset-work ledger.
//! @ref LLP 0037#dated-alignment-asset-subsystem-artifacts-2026-07-31 —
//!   these serde types are the single source of truth for the asset wire
//!   shapes; committed schemas are generated and drift-gated.

use std::path::{Path, PathBuf};

use rusqlite::{Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

pub use crate::contract_types::MediaKindV1;
use crate::diagnostic::{SnapbackError, SnapbackResult};

/// The v1 canonical digest algorithm (author decision, 2026-07-31): native
/// S3-compatible checksum interop and universal tooling. The algorithm is a
/// versioned manifest fact; a successor is admitted behind versioned blob
/// identity, never by silently reinterpreting stored digests.
pub const ASSET_DIGEST_ALGORITHM_SHA256: &str = "sha256";

/// `artifactKind` for the generated upload-intent reference.
pub const ASSET_UPLOAD_REFERENCE_KIND: &str = "assetUploadReference";

// ---------------------------------------------------------------------------
// v1 limit facts (LLP 0044 §Deduplication/quotas, §Capability facts). These
// are the local target's enforced bounds; L1-12 reports them through the
// capability manifest. Every one is `Enforced` here — refusal, not advisory.
// ---------------------------------------------------------------------------

pub const ASSET_ATTEMPT_TTL_MS: u64 = 6 * 60 * 60 * 1000;
pub const ASSET_MAX_OPEN_ATTEMPTS_PER_APP: u64 = 64;
pub const ASSET_MAX_OPEN_ATTEMPTS_PER_PRINCIPAL: u64 = 8;
/// Durable recipient grants are charged to their asset owner's app. Pending
/// and active rows both count; revoke releases the slot transactionally.
pub const ASSET_MAX_GRANTS_PER_APP: u64 = 1024;

fn default_asset_max_grants_per_app() -> u64 {
    ASSET_MAX_GRANTS_PER_APP
}
pub const ASSET_APP_LOGICAL_QUOTA_BYTES: u64 = 4 * 1024 * 1024 * 1024;
/// Every asset consumes at least this much logical quota, so zero-byte
/// assets are not free (LLP 0044 §Deduplication/quotas).
pub const ASSET_MIN_ACCOUNTING_UNIT_BYTES: u64 = 4096;
pub const ASSET_MAX_CHUNK_BYTES: u64 = 8 * 1024 * 1024;
/// Whole-object media helpers still accept byte slices. Until those decode
/// and container APIs become streaming, no image/video attempt may admit a
/// source larger than this process-wide bound.
// @ref LLP 0044#deduplication-keys-and-quotas — buffered finalization is an
//   enforced resource bound, never an author-selected path to unbounded RSS.
pub const ASSET_BUFFERED_FINALIZE_MAX_BYTES: u64 = 256 * 1024 * 1024;
// @ref LLP 0044#ceremony-floor-and-bounded-on-demand-widths-dated-amendment-2026-08-01 —
//   `?width=N` normalizes UP this fixed ladder, bounding the on-demand
//   variant space per asset; renditions materialize once and serve
//   immutably. The ceiling is a declared capability fact.
pub const ASSET_ON_DEMAND_WIDTH_LADDER: [u64; 13] = [
    16, 32, 64, 96, 128, 192, 256, 384, 512, 768, 1024, 1536, 2048,
];
pub const ASSET_ON_DEMAND_MAX_WIDTH_PX: u64 = 2048;

/// Ladder-normalize a requested on-demand width: the first ladder member
/// >= the request, or None above the ceiling.
pub fn normalize_on_demand_width(requested: u64) -> Option<u64> {
    if requested == 0 || requested > ASSET_ON_DEMAND_MAX_WIDTH_PX {
        return None;
    }
    ASSET_ON_DEMAND_WIDTH_LADDER
        .iter()
        .copied()
        .find(|step| *step >= requested)
}

pub const ASSET_TUS_VERSION: &str = "1.0.0";
/// The checksum algorithms the TUS lane accepts on `Upload-Checksum`.
pub const ASSET_TUS_CHECKSUM_ALGORITHMS: [&str; 1] = ["sha256"];
/// v1 performs no canonical rewriting: canonical bytes are the received
/// bytes. The policy tag participates in blob identity so a future rewriting
/// policy can never alias digests across policies.
pub const ASSET_CANONICALIZATION_NONE: &str = "none";

/// The image strip rewrite (LLP 0044 §Restricted staging: privacy rewriting
/// before digesting): decode → corrective orientation → re-encode. Dedup
/// operates on the rewritten bytes, so strip and retain uploads of one
/// source can never share a blob.
pub const ASSET_CANONICALIZATION_STRIP_IMAGE_V1: &str = "strip-image.v1";
/// Video strip canonicalization: in-place location blanking over the ISO
/// BMFF box tree (LLP 0044 W2d) — part of blob identity, so strip and
/// retain video can never alias.
pub const ASSET_CANONICALIZATION_STRIP_VIDEO_V1: &str = "strip-video.v1";

/// Suffix for the canonical rewrite staged beside its source under the
/// same staging key; the store treats the pair as one custody unit.
pub const ASSET_CANONICAL_SUFFIX: &str = ".c14n";

/// Grace period before an unreferenced pending/rejected asset is reclaimed
/// (LLP 0044 §Deletion: pending-asset GC is mandatory, referenced failures
/// stay visible for repair).
pub const ASSET_PENDING_GRACE_MS: u64 = 24 * 60 * 60 * 1000;
/// Retention fence before a zero-referenced blob may be condemned.
pub const ASSET_BLOB_RETENTION_MS: u64 = 60 * 60 * 1000;
/// How long a deleted-asset tombstone (and its receipts) stays queryable
/// before the sweep purges the rows.
pub const ASSET_TOMBSTONE_RETENTION_MS: u64 = 7 * 24 * 60 * 60 * 1000;
/// Per-request delivery admissions are operational evidence, not lifecycle
/// history. The GC sweep removes only this high-rate receipt class after the
/// window; lifecycle receipts retain their existing semantics.
pub const ASSET_DELIVERY_RECEIPT_RETENTION_MS: u64 = 7 * 24 * 60 * 60 * 1000;
/// Streaming chunk size for strict delivery.
pub const ASSET_DELIVERY_CHUNK_BYTES: usize = 64 * 1024;
/// Committed publication records retire after this window — the blob row is
/// the durable evidence from then on — so the record ceiling can never silt
/// up into a permanent upload limit (LLP 0044 §Publication and crash
/// recovery).
pub const ASSET_PUBLICATION_RETENTION_MS: u64 = 7 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Finalization prepare/commit seam (LLP 0199 owner #4).
//
// `prepare_asset_finalize` owns the repeatable byte-store reads, whole-object
// hashing/buffering, media decode/canonicalization, ThumbHash/fact derivation,
// and required-variant renders. It deliberately has no database handle: a
// caller may run it outside the global Local/SQLite writer and later carry the
// immutable result through the write-ahead publication commits in `local.rs`.
// The local transport runs this half between finalize preflight and commit,
// while the retained in-process finalize path may deliberately run it beneath
// an outer Local guard for callers that cannot release that guard.
//
// @ref LLP 0225#1-ownership-map — background services prepare CPU/network
//   work outside the global writer and enter the kernel through narrow commits.
// @ref LLP 0044#publication-and-crash-recovery — preparation is re-drivable;
//   planned/staged/committed publication records remain the durable authority.
// ---------------------------------------------------------------------------

pub(crate) struct AssetFinalizePrepareInput<'a> {
    pub staging_key: &'a str,
    pub declared_length: u64,
    pub declared_digest: Option<&'a str>,
    pub declared_content_type: Option<&'a str>,
    pub accepted_media_types: &'a [String],
    pub max_canonical_bytes: u64,
    pub image_location: Option<crate::manifest::AssetLocationPolicy>,
    pub video_location: Option<crate::manifest::AssetLocationPolicy>,
    pub image_finalization_enabled: bool,
    pub video_finalization_enabled: bool,
    pub declared_variants: &'a [crate::manifest::AssetImageVariant],
}

pub(crate) struct AssetFinalizePrepareFailure {
    pub asset_outcome: AssetAvailability,
    pub refusal: SnapbackError,
}

pub(crate) enum AssetFinalizePrepareError {
    /// Store access failed before a deterministic byte/policy refusal. The
    /// attempt remains current and retryable exactly as it did before the
    /// prepare boundary was extracted.
    Transient(SnapbackError),
    /// The received bytes deterministically violate the stated policy.
    Refusal(AssetFinalizePrepareFailure),
}

/// The restricted-custody object containing the canonical bytes after
/// preparation. It is not a deliverable blob and carries no database state.
pub(crate) enum AssetPreparedCanonicalObject {
    Staging(String),
    Canonical(String),
}

impl AssetPreparedCanonicalObject {
    pub(crate) fn as_ref(&self) -> crate::assets_store::AssetObjectRef<'_> {
        match self {
            Self::Staging(key) => crate::assets_store::AssetObjectRef::Staging(key),
            Self::Canonical(key) => crate::assets_store::AssetObjectRef::Canonical(key),
        }
    }
}

pub(crate) struct AssetPreparedCanonical {
    pub object: AssetPreparedCanonicalObject,
    pub digest: String,
    pub byte_length: u64,
    pub policy: &'static str,
}

#[derive(Clone)]
pub(crate) struct AssetVariantPreparation {
    pub key: String,
    pub width: u64,
    pub rendered: Vec<u8>,
    pub digest: String,
    pub byte_length: u64,
    pub content_type: String,
    pub recipe_version: u64,
}

pub(crate) struct AssetFinalizePreparation {
    pub staged_digest: String,
    pub detected_content_type: &'static str,
    pub canonical: AssetPreparedCanonical,
    pub media_facts: serde_json::Map<String, serde_json::Value>,
    pub required_variants: Vec<AssetVariantPreparation>,
}

fn asset_finalize_refusal(
    asset_outcome: AssetAvailability,
    refusal: SnapbackError,
) -> AssetFinalizePrepareError {
    AssetFinalizePrepareError::Refusal(AssetFinalizePrepareFailure {
        asset_outcome,
        refusal,
    })
}

fn media_type_admitted(accepted: &[String], declared: &str) -> bool {
    let declared = declared
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    accepted.iter().any(|entry| {
        let entry = entry.to_ascii_lowercase();
        entry == declared
            || entry
                .strip_suffix("/*")
                .is_some_and(|prefix| declared.starts_with(&format!("{prefix}/")))
    })
}

fn insert_derived_image_facts(
    facts: &mut serde_json::Map<String, serde_json::Value>,
    derived: &crate::assets_image::AssetImageDerivedFacts,
) {
    facts.insert(
        "placeholder".into(),
        serde_json::json!({
            "algo": crate::assets_image::ASSET_PLACEHOLDER_ALGO_THUMBHASH_V1,
            "value": derived.placeholder,
        }),
    );
    facts.insert(
        "dominantColor".into(),
        derived.dominant_color.clone().into(),
    );
}

fn insert_video_facts(
    facts: &mut serde_json::Map<String, serde_json::Value>,
    video: &crate::assets_video::AssetVideoFacts,
) {
    if let Some(duration_ms) = video.duration_ms {
        facts.insert("durationMs".into(), duration_ms.into());
    }
    if let Some(width) = video.width {
        facts.insert("width".into(), width.into());
    }
    if let Some(height) = video.height {
        facts.insert("height".into(), height.into());
    }
}

fn hash_bytes(bytes: &[u8]) -> String {
    use sha2::Digest as _;
    let mut hasher = sha2::Sha256::new();
    hasher.update(bytes);
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

pub(crate) fn prepare_asset_variant(
    canonical_bytes: &[u8],
    content_type: &str,
    variant: &crate::manifest::AssetImageVariant,
    recipe_version: u64,
) -> SnapbackResult<AssetVariantPreparation> {
    let rendered = crate::assets_image::render_variant(
        canonical_bytes,
        content_type,
        variant.width,
        &crate::assets_image::ASSET_IMAGE_CEILINGS_LOCAL_V1,
    )?;
    let digest = hash_bytes(&rendered);
    Ok(AssetVariantPreparation {
        key: variant.key.clone(),
        width: variant.width,
        byte_length: rendered.len() as u64,
        rendered,
        digest,
        content_type: content_type.to_owned(),
        recipe_version,
    })
}

/// Repeatable variant-render half of the prepare/commit seam. The returned
/// bytes have no durable meaning until `local.rs` records their publication
/// plans after the primary publication reaches `staged`, then transactionally
/// commits them with asset readiness.
pub(crate) fn prepare_required_asset_variants(
    store: &dyn crate::assets_store::AssetStore,
    canonical: crate::assets_store::AssetObjectRef<'_>,
    content_type: &str,
    variants: &[crate::manifest::AssetImageVariant],
) -> Result<Vec<AssetVariantPreparation>, AssetFinalizePrepareError> {
    let canonical_bytes = store
        .read(canonical)
        .map_err(AssetFinalizePrepareError::Transient)?;
    variants
        .iter()
        .filter(|variant| variant.required)
        .map(|variant| {
            prepare_asset_variant(&canonical_bytes, content_type, variant, 1)
                .map_err(|error| asset_finalize_refusal(AssetAvailability::Rejected, error))
        })
        .collect()
}

/// Repeatable, database-free half of asset finalization. All output remains
/// in restricted staging custody until the caller records and commits the
/// LLP 0044 publication protocol.
pub(crate) fn prepare_asset_finalize(
    store: &dyn crate::assets_store::AssetStore,
    input: AssetFinalizePrepareInput<'_>,
) -> Result<AssetFinalizePreparation, AssetFinalizePrepareError> {
    let staged = store
        .hash(crate::assets_store::AssetObjectRef::Staging(
            input.staging_key,
        ))
        .map_err(AssetFinalizePrepareError::Transient)?;
    if staged.byte_length != input.declared_length {
        return Err(asset_finalize_refusal(
            AssetAvailability::Pending,
            SnapbackError::error(
                "SNAPBACK_ASSET_LENGTH_MISMATCH",
                "assets",
                format!(
                    "staging holds {} bytes but the attempt declared {}",
                    staged.byte_length, input.declared_length
                ),
            ),
        ));
    }
    if let Some(declared_digest) = input.declared_digest
        && declared_digest != staged.digest
    {
        return Err(asset_finalize_refusal(
            AssetAvailability::Pending,
            SnapbackError::error(
                "SNAPBACK_ASSET_DIGEST_MISMATCH",
                "assets",
                "the declared whole-upload digest does not match the received bytes",
            ),
        ));
    }

    let detected = detect_content_type(&staged.head);
    if !media_type_admitted(input.accepted_media_types, detected) {
        return Err(asset_finalize_refusal(
            AssetAvailability::Pending,
            SnapbackError::error(
                "SNAPBACK_ASSET_MEDIA_TYPE_UNSUPPORTED",
                "assets",
                format!("detected content type {detected} is outside the intent's accept list"),
            )
            .with_details(serde_json::json!({
                "declared": input.declared_content_type,
                "detected": detected,
            })),
        ));
    }

    let mut media_facts = serde_json::Map::new();
    let detected_video_container = matches!(detected, "video/mp4" | "video/quicktime");
    let location_policy = if detected_video_container {
        input.video_location
    } else {
        input.image_location
    };
    if location_policy.is_some() && staged.byte_length > ASSET_BUFFERED_FINALIZE_MAX_BYTES {
        return Err(asset_finalize_refusal(
            AssetAvailability::Pending,
            SnapbackError::error(
                "SNAPBACK_ASSET_MEDIA_BOUNDS_EXCEEDED",
                "assets",
                format!(
                    "staged media length {} exceeds the buffered finalizer ceiling {}",
                    staged.byte_length, ASSET_BUFFERED_FINALIZE_MAX_BYTES
                ),
            )
            .with_details(serde_json::json!({
                "limit": ASSET_BUFFERED_FINALIZE_MAX_BYTES,
                "observed": staged.byte_length,
                "path": "buffered-finalizer",
            })),
        ));
    }
    if location_policy.is_none() && (detected_video_container || detected.starts_with("image/")) {
        return Err(asset_finalize_refusal(
            AssetAvailability::Rejected,
            SnapbackError::error(
                "SNAPBACK_ASSET_LOCATION_POLICY_UNSUPPORTED",
                "assets",
                format!(
                    "detected {detected} requires the deployed intent's {}.location policy; the image and video blocks do not alias",
                    if detected_video_container {
                        "video"
                    } else {
                        "image"
                    },
                ),
            ),
        ));
    }

    let strip_declared = location_policy == Some(crate::manifest::AssetLocationPolicy::Strip);
    let strip_capability_missing = if detected_video_container {
        !input.video_finalization_enabled
    } else {
        !input.image_finalization_enabled
    };
    if strip_declared && strip_capability_missing {
        return Err(asset_finalize_refusal(
            AssetAvailability::Rejected,
            SnapbackError::error(
                "SNAPBACK_ASSET_LOCATION_POLICY_UNSUPPORTED",
                "assets",
                "location stripping is not available on this target; no strip-declared media can publish",
            ),
        ));
    }

    let canonical = if strip_declared && detected_video_container {
        let source = store
            .read(crate::assets_store::AssetObjectRef::Staging(
                input.staging_key,
            ))
            .map_err(AssetFinalizePrepareError::Transient)?;
        let outcome = crate::assets_video::canonicalize_strip_video(
            &source,
            &crate::assets_video::ASSET_VIDEO_CEILINGS_LOCAL_V1,
        )
        .map_err(|error| asset_finalize_refusal(AssetAvailability::Rejected, error))?;
        store
            .write_canonical(input.staging_key, &outcome.canonical)
            .map_err(AssetFinalizePrepareError::Transient)?;
        let hashed = store
            .hash(crate::assets_store::AssetObjectRef::Canonical(
                input.staging_key,
            ))
            .map_err(AssetFinalizePrepareError::Transient)?;
        insert_video_facts(&mut media_facts, &outcome.facts);
        AssetPreparedCanonical {
            object: AssetPreparedCanonicalObject::Canonical(input.staging_key.to_owned()),
            digest: hashed.digest,
            byte_length: hashed.byte_length,
            policy: ASSET_CANONICALIZATION_STRIP_VIDEO_V1,
        }
    } else if strip_declared {
        let source = store
            .read(crate::assets_store::AssetObjectRef::Staging(
                input.staging_key,
            ))
            .map_err(AssetFinalizePrepareError::Transient)?;
        let outcome = crate::assets_image::canonicalize_strip(
            &source,
            detected,
            &crate::assets_image::ASSET_IMAGE_CEILINGS_LOCAL_V1,
        )
        .map_err(|error| asset_finalize_refusal(AssetAvailability::Rejected, error))?;
        store
            .write_canonical(input.staging_key, &outcome.canonical)
            .map_err(AssetFinalizePrepareError::Transient)?;
        let hashed = store
            .hash(crate::assets_store::AssetObjectRef::Canonical(
                input.staging_key,
            ))
            .map_err(AssetFinalizePrepareError::Transient)?;
        if let Some(orientation) = outcome.safe_exif.orientation {
            media_facts.insert("orientationApplied".into(), orientation.into());
        }
        if let Some(captured_at) = outcome.safe_exif.captured_at {
            media_facts.insert("capturedAt".into(), captured_at.into());
        }
        media_facts.insert("width".into(), outcome.width.into());
        media_facts.insert("height".into(), outcome.height.into());
        insert_derived_image_facts(&mut media_facts, &outcome.derived);
        AssetPreparedCanonical {
            object: AssetPreparedCanonicalObject::Canonical(input.staging_key.to_owned()),
            digest: hashed.digest,
            byte_length: hashed.byte_length,
            policy: ASSET_CANONICALIZATION_STRIP_IMAGE_V1,
        }
    } else {
        if input.image_location.is_some()
            && input.image_finalization_enabled
            && matches!(detected, "image/jpeg" | "image/png")
        {
            let source = store
                .read(crate::assets_store::AssetObjectRef::Staging(
                    input.staging_key,
                ))
                .map_err(AssetFinalizePrepareError::Transient)?;
            let inspection = crate::assets_image::inspect_image(
                &source,
                detected,
                &crate::assets_image::ASSET_IMAGE_CEILINGS_LOCAL_V1,
            )
            .map_err(|error| asset_finalize_refusal(AssetAvailability::Rejected, error))?;
            if let Some(orientation) = inspection.safe_exif.orientation {
                media_facts.insert("orientationApplied".into(), orientation.into());
            }
            if let Some(captured_at) = inspection.safe_exif.captured_at {
                media_facts.insert("capturedAt".into(), captured_at.into());
            }
            media_facts.insert("width".into(), inspection.width.into());
            media_facts.insert("height".into(), inspection.height.into());
            insert_derived_image_facts(&mut media_facts, &inspection.derived);
        } else if input.video_location.is_some()
            && input.video_finalization_enabled
            && detected_video_container
        {
            let source = store
                .read(crate::assets_store::AssetObjectRef::Staging(
                    input.staging_key,
                ))
                .map_err(AssetFinalizePrepareError::Transient)?;
            let facts = crate::assets_video::inspect_video(
                &source,
                &crate::assets_video::ASSET_VIDEO_CEILINGS_LOCAL_V1,
            )
            .map_err(|error| asset_finalize_refusal(AssetAvailability::Rejected, error))?;
            insert_video_facts(&mut media_facts, &facts);
        }
        AssetPreparedCanonical {
            object: AssetPreparedCanonicalObject::Staging(input.staging_key.to_owned()),
            digest: staged.digest.clone(),
            byte_length: staged.byte_length,
            policy: ASSET_CANONICALIZATION_NONE,
        }
    };

    if location_policy.is_some() {
        media_facts.insert(
            "locationPolicy".into(),
            if strip_declared { "strip" } else { "retain" }.into(),
        );
    }
    if canonical.byte_length > input.max_canonical_bytes {
        return Err(asset_finalize_refusal(
            AssetAvailability::Pending,
            SnapbackError::error(
                "SNAPBACK_ASSET_MEDIA_BOUNDS_EXCEEDED",
                "assets",
                "canonical bytes exceed the intent's byte bound",
            ),
        ));
    }

    let required_variants = if input.image_finalization_enabled
        && !input.declared_variants.is_empty()
        && matches!(detected, "image/jpeg" | "image/png")
    {
        prepare_required_asset_variants(
            store,
            canonical.object.as_ref(),
            detected,
            input.declared_variants,
        )?
    } else {
        Vec::new()
    };

    Ok(AssetFinalizePreparation {
        staged_digest: staged.digest,
        detected_content_type: detected,
        canonical,
        media_facts,
        required_variants,
    })
}

/// Lock-held finalize preflight either proves the attempt already completed or
/// freezes every fact the repeatable, database-free prepare and later commit
/// need to carry across the unlocked window.
#[allow(clippy::large_enum_variant)] // Preserve the established allocation-free finalize handoff.
pub(crate) enum FinalizePreflightV1 {
    AlreadyComplete(AssetFinalizeResponseV1),
    Proceed(FinalizePrepareTicketV1),
}

/// Immutable continuity ticket between TUS PATCH validation and its durable
/// offset acknowledgement. The byte-store handle owns no `LocalSnapback`
/// borrow, so the potentially slow append and sync can run off the global
/// writer before the commit half compares the exact state observed here.
pub(crate) struct AssetTusPatchTicketV1 {
    pub(crate) attempt_id: String,
    pub(crate) staging_key: String,
    pub(crate) expected_offset: u64,
    pub(crate) expected_all_chunks_checksummed: bool,
    pub(crate) new_offset: u64,
    pub(crate) all_chunks_checksummed: bool,
    pub(crate) store: std::sync::Arc<dyn crate::assets_store::AssetStore>,
}

impl AssetTusPatchTicketV1 {
    /// Write-then-record half of the TUS crash protocol. A successful return
    /// proves the chunk is durable, but deliberately does not claim that its
    /// offset has been acknowledged yet.
    pub(crate) fn append(&self, chunk: &[u8]) -> SnapbackResult<()> {
        self.store
            .append_staging(&self.staging_key, self.expected_offset, chunk)
    }
}

/// Immutable continuity ticket between asset-finalize preflight and commit.
/// The byte-store handle is config-derived while Local is available, then
/// clone-shareable without retaining any LocalSnapback or database borrow.
pub(crate) struct FinalizePrepareTicketV1 {
    pub(crate) attempt: AssetAttemptRecordV1,
    pub(crate) request: AssetFinalizeRequestV1,
    pub(crate) frozen_intent: crate::manifest::AssetUploadIntentDefinition,
    pub(crate) on_ready: Option<String>,
    pub(crate) store: std::sync::Arc<dyn crate::assets_store::AssetStore>,
    pub(crate) image_finalization_enabled: bool,
    pub(crate) video_finalization_enabled: bool,
    pub(crate) app_id: String,
    pub(crate) app_quota: u64,
    pub(crate) schema: crate::manifest::SchemaManifest,
}

/// A deterministic byte/policy refusal still returns through the lock-held
/// commit half so the attempt failure and receipts are recorded exactly once.
/// Transient store errors remain ordinary `SnapbackResult` errors and leave the
/// attempt current and retryable.
pub(crate) enum FinalizePreparationV1 {
    Prepared(AssetFinalizePreparation),
    Refused(AssetFinalizePrepareFailure),
}

/// Phase A either observes an already-complete concurrent finalization or
/// hands the database-free canonical object put to the caller. The `Proceed`
/// ticket is created only after its `planned` publication record commits.
pub(crate) enum FinalizePhaseAOutcomeV1 {
    AlreadyComplete(AssetFinalizeResponseV1),
    Proceed(Box<FinalizePutTicketV1>),
}

/// Type-state handoff from lock-held Phase A to lock-free Phase B. It owns the
/// immutable prepare result, exact publication key, and clone-shared store;
/// it carries no `LocalSnapback` or database borrow.
pub(crate) struct FinalizePutTicketV1 {
    pub(crate) ticket: FinalizePrepareTicketV1,
    pub(crate) prepared: AssetFinalizePreparation,
    pub(crate) publication: AssetPublicationRecordV1,
    pub(crate) grade: AssetIntegrityGrade,
}

/// Proof that Phase B's object put returned and the recorded key verified.
/// Only this ticket is accepted by lock-held Phase C/D.
pub(crate) struct FinalizeCommitTicketV1 {
    pub(crate) put: FinalizePutTicketV1,
}

impl FinalizePutTicketV1 {
    /// Phase B of the write-ahead publication protocol. This method is
    /// deliberately database-free so transports can run remote/object-store
    /// latency without retaining the global Local writer.
    pub(crate) fn put(self) -> SnapbackResult<FinalizeCommitTicketV1> {
        let planned_key = &self.publication.planned_key;
        self.ticket
            .store
            .copy_from_staging(self.prepared.canonical.object.as_ref(), planned_key)?;
        let copied = self
            .ticket
            .store
            .hash(crate::assets_store::AssetObjectRef::Blob(planned_key))?;
        if copied.digest != self.prepared.canonical.digest
            || copied.byte_length != self.prepared.canonical.byte_length
        {
            let _ = self.ticket.store.delete_blob(planned_key);
            return Err(SnapbackError::error(
                "SNAPBACK_ASSET_STORE_UNAVAILABLE",
                "assets",
                "the published object did not verify against the canonical digest",
            ));
        }
        Ok(FinalizeCommitTicketV1 { put: self })
    }
}

impl FinalizePrepareTicketV1 {
    pub(crate) fn prepare(&self) -> SnapbackResult<FinalizePreparationV1> {
        let image_location = self
            .frozen_intent
            .image
            .as_ref()
            .map(|image| image.location);
        let video_location = self
            .frozen_intent
            .video
            .as_ref()
            .map(|video| video.location);
        let declared_variants = self
            .frozen_intent
            .image
            .as_ref()
            .map(|image| image.variants.as_slice())
            .unwrap_or_default();
        match prepare_asset_finalize(
            self.store.as_ref(),
            AssetFinalizePrepareInput {
                staging_key: &self.attempt.staging_key,
                declared_length: self.attempt.declared_length,
                declared_digest: self.request.declared_digest.as_deref(),
                declared_content_type: self.attempt.declared_content_type.as_deref(),
                accepted_media_types: &self.frozen_intent.accept.media_types,
                max_canonical_bytes: self.frozen_intent.accept.max_bytes,
                image_location,
                video_location,
                image_finalization_enabled: self.image_finalization_enabled,
                video_finalization_enabled: self.video_finalization_enabled,
                declared_variants,
            },
        ) {
            Ok(prepared) => Ok(FinalizePreparationV1::Prepared(prepared)),
            Err(AssetFinalizePrepareError::Transient(error)) => Err(error),
            Err(AssetFinalizePrepareError::Refusal(failure)) => {
                Ok(FinalizePreparationV1::Refused(failure))
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Closed state vocabularies (LLP 0044 §Lifecycle transitions). Name-keyed per
// the LLP 0037 dated constraint; an unlisted transition is refused by the
// state machines built on these, not by this module.
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum AssetAvailability {
    Pending,
    Ready,
    Rejected,
    Deleted,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum AssetAttemptState {
    Open,
    Transferring,
    Finalizing,
    Complete,
    Expired,
    Cancelled,
    Failed,
}

impl AssetAttemptState {
    /// The states the single-current-attempt invariant counts as current.
    /// Kept in exact agreement with the partial unique index in
    /// [`create_infra`].
    pub fn is_current(self) -> bool {
        matches!(self, Self::Open | Self::Transferring | Self::Finalizing)
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Transferring => "transferring",
            Self::Finalizing => "finalizing",
            Self::Complete => "complete",
            Self::Expired => "expired",
            Self::Cancelled => "cancelled",
            Self::Failed => "failed",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum AssetRenditionState {
    Pending,
    Ready,
    Failed,
    Superseded,
    Retired,
}

/// @ref LLP 0044#publication-and-crash-recovery — closed publication-record
///   states: `planned → staged | condemned`, `staged → committed | condemned`.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum AssetPublicationState {
    Planned,
    Staged,
    Committed,
    Condemned,
}

/// @ref LLP 0044#processing-runner-and-idempotency — closed ledger states;
///   `claimed → enqueued` on lease expiry is an explicit transition.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum AssetWorkState {
    Enqueued,
    Claimed,
    Done,
    Retrying,
    Exhausted,
    Ambiguous,
    Cancelled,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum AssetDeliveryProfile {
    PublicImmutable,
    PrivateSigned,
    PrivateStrict,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum AssetReadAccessPolicy {
    OwnerOnly,
    ViaReferences,
}

/// @ref LLP 0044#byte-stores-and-resumable-transfer — integrity is a graded
///   fact: a freshly computed digest names received bytes, it does not verify
///   them against client intent.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum AssetIntegrityGrade {
    EndToEndVerified,
    ReceivedBytesCanonical,
}

// ---------------------------------------------------------------------------
// Record shapes (LLP 0044 §Internal model). Stored as `record_json` beside
// the indexed columns; both sides are written from these structs only.
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AssetRecordV1 {
    pub asset_id: String,
    pub app_id: String,
    pub intent_id: String,
    /// The intent's exported binding name — what a `v.assetRef` field
    /// restriction names, so commit-boundary admission can compare without
    /// resolving the function manifest inside the storage layer.
    #[serde(default)]
    pub intent_name: String,
    /// Hash of the declared accept/delivery/access/processing facts the asset
    /// was admitted under; pairs with `policy_generation`.
    pub intent_policy_hash: String,
    pub policy_generation: u64,
    pub owner_principal: String,
    pub delivery_profile: AssetDeliveryProfile,
    pub read_access: AssetReadAccessPolicy,
    /// Frozen admission-time eligibility for first-class recipient grants.
    /// A later deploy cannot retrofit authority onto already-admitted bytes.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub grants_enabled: bool,
    pub availability: AssetAvailability,
    /// Primary bytes are represented exclusively by the `primary` rendition
    /// record — there is no second asset-to-blob edge, so blob references and
    /// quota charges count the primary exactly once.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub primary_rendition_id: Option<String>,
    /// Trusted, immutable coarse kind installed with the ready transition.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub media_kind: Option<MediaKindV1>,
    pub lifecycle_generation: u64,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deleted_at_ms: Option<u64>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum AssetGrantState {
    Pending,
    Active,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AssetGrantProvenanceV1 {
    pub minted_by: String,
    pub mutation: String,
    pub at: u64,
}

/// @ref LLP 0210#d5--recipient-scoped-authority-recipe-now-grant-ops-as-the-paved-spelling —
/// durable, recipient-scoped authority is a system-owned edge, not an app row.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AssetGrantRecordV1 {
    pub grant_id: String,
    pub asset_id: String,
    pub principal: String,
    pub state: AssetGrantState,
    pub provenance: AssetGrantProvenanceV1,
}

/// Handler effects staged until the mutation's final SQLite transaction.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum BufferedAssetGrantOp {
    Grant {
        grant_id: String,
        asset_id: String,
        principal: String,
        state: AssetGrantState,
        mutation: String,
        at_ms: u64,
    },
    Activate {
        grant_id: String,
        at_ms: u64,
    },
    Revoke {
        grant_id: String,
        at_ms: u64,
    },
}

/// The admission facts captured when the authorizer admitted the attempt:
/// the LLP 0007 complete read-set witness, the LLP 0053 authorization pair,
/// and the frozen policy plus implementation identities finalization
/// re-validates under.
///
/// @ref LLP 0044#internal-model — witness validation is re-validate, then
///   refuse only on denial; the witness is the substrate.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AssetAdmissionV1 {
    pub intent_policy_hash: String,
    /// Executable authorizer identity. Legacy pre-carrier attempts decode
    /// with this absent and are refused at finalization rather than silently
    /// adopting whichever authorizer is currently deployed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub implementation_hash: Option<String>,
    pub policy_generation: u64,
    pub owner_principal: String,
    /// The sealed caller identity facts the decision ran under.
    pub auth: Value,
    /// The captured read dependencies (row, missing-row, query range, index
    /// cursor, table predicate, auth/permission), serialized verbatim.
    pub witness: Value,
    /// Canonical intent arguments the authorizer admitted.
    pub args: Value,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AssetAttemptRecordV1 {
    pub attempt_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub predecessor_attempt_id: Option<String>,
    pub asset_id: String,
    pub app_id: String,
    pub intent_id: String,
    pub lifecycle_generation: u64,
    pub state: AssetAttemptState,
    /// Opaque restricted-staging key; never derived from app data.
    pub staging_key: String,
    pub declared_filename: Option<String>,
    /// Every v1 lane requires a known total length at attempt creation.
    pub declared_length: u64,
    pub declared_content_type: Option<String>,
    pub acknowledged_offset: u64,
    pub integrity_grade: AssetIntegrityGrade,
    /// True until a chunk arrives without a verifiable checksum; the
    /// finalizer grades end-to-end verified only while this holds (or an
    /// authenticated whole-upload digest matches).
    pub all_chunks_checksummed: bool,
    pub admission: AssetAdmissionV1,
    pub expires_at_ms: u64,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failure: Option<Value>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AssetBlobRecordV1 {
    pub blob_id: String,
    pub app_id: String,
    /// The byte-store parameter this blob lives in (`local-fs` in v1).
    pub store: String,
    /// Deliberately opaque; the canonical digest is blob metadata, not the
    /// physical key (LLP 0044 §Internal model).
    pub physical_key: String,
    pub byte_length: u64,
    pub detected_content_type: String,
    pub digest_algorithm: String,
    pub digest: String,
    pub canonicalization_policy: String,
    pub created_at_ms: u64,
}

/// A blob's mutable state — reference count and condemnation — lives only in
/// the table columns; `AssetBlobRecordV1` carries immutable metadata, so the
/// JSON copy can never go stale. Readers that need the live state use this.
#[derive(Clone, Debug)]
pub struct AssetBlobLive {
    pub record: AssetBlobRecordV1,
    pub reference_count: u64,
    pub condemned: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AssetRenditionRecordV1 {
    pub rendition_id: String,
    pub asset_id: String,
    pub variant_key: String,
    pub blob_id: String,
    pub state: AssetRenditionState,
    pub recipe: String,
    pub recipe_version: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub media_facts: Option<Value>,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failure: Option<Value>,
}

/// One rendition, as a client may see it: variant identity, readiness, and
/// safe dimensions — never blob identity or recipe internals.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AssetRenditionSummaryV1 {
    pub variant: String,
    pub ready: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<u64>,
}

/// The authorized client view of one asset record — the shape both
/// `GET /assets/records/{id}` and the reserved `_snapback.assetRecord` live
/// projection serve. Safe metadata only: never blob keys, staging
/// identifiers, physical paths, or admission material (LLP 0044
/// §Receipts, diagnostics, and inspection).
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AssetRecordClientViewV1 {
    pub asset_id: String,
    pub availability: AssetAvailability,
    pub delivery_profile: AssetDeliveryProfile,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub primary_rendition_id: Option<String>,
    pub lifecycle_generation: u64,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
    pub renditions: Vec<AssetRenditionSummaryV1>,
    /// The primary rendition's typed media facts (placeholder, dominant
    /// color, dimensions, detected media type, …) as stored — already safe
    /// by construction, since finalization writes only typed facts here.
    pub media: Value,
    /// The canonical content digest of the primary blob, exposed as an
    /// app-queryable fact once ready (LLP 0139 bakeoff steal: Convex's
    /// `_storage.sha256`). The digest is blob metadata, never the physical
    /// key — LLP 0044's key/digest separation is unaffected.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub digest: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub digest_algorithm: Option<String>,
    /// The published transfer's honest integrity grade
    /// (end-to-end-verified vs received-bytes-canonical).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub integrity_grade: Option<AssetIntegrityGrade>,
}

/// Build the client view inside an asset transaction. The caller has already
/// passed `asset_read_authorized`; this only shapes what an authorized
/// reader may see.
pub fn asset_record_client_view(
    tx: &Transaction<'_>,
    asset: &AssetRecordV1,
) -> SnapbackResult<AssetRecordClientViewV1> {
    let renditions = renditions_for_asset(tx, &asset.asset_id)?;
    let mut summaries = Vec::new();
    let mut media = serde_json::Map::new();
    let mut digest = None;
    let mut digest_algorithm = None;
    for rendition in &renditions {
        if rendition.state == AssetRenditionState::Retired
            || rendition.state == AssetRenditionState::Superseded
        {
            continue;
        }
        let dimension = |key: &str| {
            rendition
                .media_facts
                .as_ref()
                .and_then(|facts| facts.get(key))
                .and_then(Value::as_u64)
        };
        summaries.push(AssetRenditionSummaryV1 {
            variant: rendition.variant_key.clone(),
            ready: rendition.state == AssetRenditionState::Ready,
            width: dimension("width"),
            height: dimension("height"),
        });
        if asset.primary_rendition_id.as_deref() == Some(rendition.rendition_id.as_str()) {
            if let Some(facts) = rendition.media_facts.as_ref().and_then(Value::as_object) {
                media.extend(facts.iter().map(|(k, v)| (k.clone(), v.clone())));
            }
            if rendition.state == AssetRenditionState::Ready
                && let Some(blob) = load_blob(tx, &rendition.blob_id)?
            {
                media.insert(
                    "mediaType".to_owned(),
                    blob.detected_content_type.clone().into(),
                );
                digest = Some(blob.digest.clone());
                digest_algorithm = Some(blob.digest_algorithm.clone());
            }
        }
    }
    Ok(AssetRecordClientViewV1 {
        asset_id: asset.asset_id.clone(),
        availability: asset.availability,
        delivery_profile: asset.delivery_profile,
        primary_rendition_id: asset.primary_rendition_id.clone(),
        lifecycle_generation: asset.lifecycle_generation,
        created_at_ms: asset.created_at_ms,
        updated_at_ms: asset.updated_at_ms,
        renditions: summaries,
        media: Value::Object(media),
        integrity_grade: if digest.is_some() {
            completed_attempt(tx, &asset.asset_id)?.map(|attempt| attempt.integrity_grade)
        } else {
            None
        },
        digest,
        digest_algorithm,
    })
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AssetReferenceEdgeV1 {
    pub edge_id: String,
    pub asset_id: String,
    pub app_id: String,
    pub table_name: String,
    pub row_id: String,
    pub field_path: String,
    pub created_at_ms: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AssetPublicationRecordV1 {
    pub publication_id: String,
    pub app_id: String,
    pub attempt_id: Option<String>,
    /// The planned opaque object key, recorded before any object write so
    /// orphans are discoverable from records, never only store listings.
    pub planned_key: String,
    pub digest_algorithm: String,
    pub digest: String,
    pub canonicalization_policy: String,
    pub state: AssetPublicationState,
    pub generation: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blob_id: Option<String>,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AssetWorkRowV1 {
    pub work_id: String,
    /// Closed work kinds grow with the runner ticket; the column is indexed,
    /// the vocabulary is validated by the runner.
    pub kind: String,
    pub asset_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attempt_id: Option<String>,
    pub lifecycle_generation: u64,
    pub state: AssetWorkState,
    pub attempt_count: u64,
    pub retry_ceiling: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lease_owner: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lease_expires_at_ms: Option<u64>,
    pub next_eligible_at_ms: u64,
    pub deadline_at_ms: u64,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failure: Option<Value>,
    /// Kind-specific inputs (an image variant's key/width/recipe version);
    /// additive and optional so pre-existing rows decode unchanged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

// ---------------------------------------------------------------------------
// Wire DTOs (LLP 0037 dated alignment, 2026-07-31).
// ---------------------------------------------------------------------------

/// The generated upload-intent reference, in the shipped `functionReference`
/// whole-artifact idiom. Deliberately carries no `ExpectedOperationV1`
/// member — that carrier stays removed (LLP 0108 §B).
///
/// @ref LLP 0044#asset-intent-implementation-identity-the-helper-closure-joins-the-carrier-dated-decision-2026-08-03 —
///   the generated reference carries both policy and executable identity;
///   admission binds them to the per-intent generation an attempt finalizes
///   under.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AssetUploadReference {
    pub artifact_kind: String,
    pub schema_version: String,
    pub app_id: String,
    pub id: String,
    pub name: String,
    pub implementation_hash: String,
    pub args_contract_hash: String,
    pub argument_schema: Value,
    pub intent_policy_hash: String,
    pub policy_generation: u64,
    #[serde(default)]
    pub required_capabilities: Vec<String>,
}

/// The closed client-task snapshot (LLP 0044 §Client upload surface),
/// language-neutral: every generated SDK observes this one state machine.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AssetTaskStateV1 {
    pub asset_id: String,
    pub attempt_id: String,
    pub attempt_state: AssetAttemptState,
    pub availability: AssetAvailability,
    pub acknowledged_offset: u64,
    pub total_bytes: u64,
    pub expires_at_ms: u64,
    pub integrity_grade: AssetIntegrityGrade,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub primary_rendition_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub diagnostic: Option<Value>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AssetAttemptCreateRequestV1 {
    pub intent_id: String,
    pub intent_policy_hash: String,
    /// Additive for wire decoding, but semantically required by admission:
    /// an old client/reference that omits it refuses stale before staging.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub implementation_hash: Option<String>,
    pub args: Value,
    pub declared_filename: Option<String>,
    /// Deferred-length creation is refused on every v1 lane with a
    /// structured diagnostic — the field is optional exactly so the refusal
    /// is `SNAPBACK_ASSET_DEFERRED_LENGTH_UNSUPPORTED`, not a parse error.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub declared_length: Option<u64>,
    pub declared_content_type: Option<String>,
    /// Present on retry: the same-asset successor path. Absent reserves a
    /// fresh asset id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retry_of_asset_id: Option<String>,
}

/// Target-specific transfer instructions for the local/proxied lane.
/// TUS 1.0.0 core plus creation, expiration, checksum, and termination; no
/// `creation-defer-length`.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AssetTusInstructionV1 {
    pub upload_url: String,
    pub tus_resumable: String,
    pub upload_length: u64,
    pub expires_at_ms: u64,
    /// Generated clients checksum every PATCH (a conformance requirement);
    /// checksum-less foreign clients finalize at the weaker grade.
    pub checksum_algorithms: Vec<String>,
    pub max_chunk_bytes: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AssetAttemptCreateResponseV1 {
    pub task: AssetTaskStateV1,
    pub transfer: AssetTusInstructionV1,
}

/// Target-specific transfer instructions for the S3-compatible lane: the
/// same headless task mapped to native multipart with presigned part URLs
/// (LLP 0044 §Byte stores). Bytes go direct to the store; completion always
/// returns through Snapback admission — no client ever completes a
/// multipart upload itself. Frozen ahead of the S3 attempt routes; no v1
/// target claims the lane until a live qualification runs.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AssetS3TransferInstructionV1 {
    pub lane: String,
    pub upload_id: String,
    pub part_size_bytes: u64,
    pub parts: Vec<AssetS3TransferPartV1>,
    /// The Snapback route that verifies and completes the upload under the
    /// attempt's admission; never a store URL.
    pub complete_url: String,
    pub expires_at_ms: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AssetS3TransferPartV1 {
    pub part_number: u32,
    /// Presigned PUT for direct client transfer of exactly this part.
    pub url: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AssetAttemptCancelRequestV1 {
    pub attempt_id: String,
    pub lifecycle_generation: u64,
    /// Cancel-and-discard also deletes the pending asset (LLP 0044
    /// §Deletion: explicit pending delete without waiting out the grace
    /// period).
    #[serde(default)]
    pub discard_asset: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AssetFinalizeRequestV1 {
    pub attempt_id: String,
    pub lifecycle_generation: u64,
    /// An authenticated whole-upload digest upgrades a checksum-less
    /// transfer to end-to-end verified when it matches.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub declared_digest: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AssetFinalizeResponseV1 {
    pub task: AssetTaskStateV1,
}

/// `private-signed` issuance (LLP 0044 §Delivery profiles). When supplied,
/// the variant is a concrete key — the declarative `best` selector resolves
/// at request time and is deliberately not signable, since the signature
/// binds one alias.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AssetSignedUrlIssueRequestV1 {
    /// @ref LLP 0210#d2--issuance-defaults-and-typed-refusals — omission
    /// selects `primary`; `widthPx` continues to supersede this selector.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub variant: Option<String>,
    /// Bounded by the declared maximum; the declared default applies when
    /// absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ttl_ms: Option<u64>,
    /// On-demand ladder width (LLP 0044 §Ceremony floor): when present the
    /// issuance resolves and materializes the ladder rendition, then signs
    /// that concrete variant — `variant` is superseded.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width_px: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AssetSignedUrlIssueResponseV1 {
    /// Origin-relative bearer URL; the token rides the `token` query
    /// parameter and is the only credential the URL carries.
    pub url: String,
    pub variant: String,
    pub expires_at_ms: u64,
}

/// Live lifecycle messages: durable system-row changes observed over the
/// existing live-query channel. Transfer progress stays ephemeral and is
/// never one of these.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase", tag = "kind")]
pub enum AssetLifecycleMessageV1 {
    #[serde(rename = "attempt")]
    Attempt {
        asset_id: String,
        attempt_id: String,
        state: AssetAttemptState,
    },
    #[serde(rename = "availability")]
    Availability {
        asset_id: String,
        availability: AssetAvailability,
        lifecycle_generation: u64,
    },
    #[serde(rename = "rendition")]
    Rendition {
        asset_id: String,
        rendition_id: String,
        variant_key: String,
        state: AssetRenditionState,
    },
}

/// Semantic receipt events (LLP 0044 §Receipts) — never per-chunk noise.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum AssetReceiptEventV1 {
    AssetReserved,
    AttemptCreated,
    AttemptCompleted,
    AttemptCancelled,
    AttemptExpired,
    AttemptFailed,
    BytesVerified,
    BytesRejected,
    StagingCleaned,
    BlobReused,
    BlobCreated,
    AssetReady,
    AssetRejected,
    AssetDeleted,
    RenditionProduced,
    RenditionFailed,
    RenditionSuperseded,
    DeliveryAdmitted,
    /// A `private-signed` bearer URL was issued after per-request
    /// authorization; the receipt carries variant and expiry, never the
    /// token or key id.
    SignedUrlIssued,
    /// Instance signing-key rotation (operator action; instance-scoped, no
    /// `asset_id`, and no key ids — the Spec bars them from evidence).
    SigningKeyRotated,
    AttachmentDenied,
    AttachmentCommitted,
    ReferenceRemoved,
    GrantMinted,
    GrantActivated,
    GrantRevoked,
    PublicationRepaired,
    MigrationVerified,
    GcReclaimed,
    WorkClaimed,
    WorkCompleted,
    WorkRetrying,
    WorkExhausted,
    WorkCancelled,
    WorkLeaseReclaimed,
    /// A superseded intent generation's retained authorizer artifact was
    /// reclaimed after its last open attempt terminated (intent-scoped;
    /// no `asset_id`).
    IntentArtifactReclaimed,
    WorkAmbiguous,
    /// A consistent cut was exported (app-scoped bookkeeping; no
    /// `asset_id`). Details carry the cut summary, never paths outside the
    /// operator-chosen directory.
    CutExported,
    /// An export directory validated (manifest digest + every blob object).
    CutImportValidated,
    /// A validated cut was applied onto an empty asset state under the
    /// experimental acknowledgement (app-scoped; no `asset_id`).
    CutImported,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AssetReceiptV1 {
    pub receipt_id: String,
    /// Shared lineage so inspection renders one lifecycle, not unrelated
    /// top-level artifacts.
    pub operation_lineage: String,
    pub event: AssetReceiptEventV1,
    /// Present on every asset-scoped event; `None` only for non-asset-scoped
    /// bookkeeping events (`IntentArtifactReclaimed`, `SigningKeyRotated`),
    /// whose subject lives in `details`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asset_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attempt_id: Option<String>,
    pub at_ms: u64,
    /// Safe structured facts only: identity, generation, policy, capability,
    /// diagnostics — no secrets, byte samples, staging keys, or bearer URLs.
    pub details: Value,
}

/// Typed detail body for `SNAPBACK_ASSET_*` diagnostics that refuse a
/// request; the closed code set is registered in LLP 0012.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AssetRefusalDetailV1 {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asset_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attempt_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub intent_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lifecycle_generation: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub observed: Option<u64>,
}

// ---------------------------------------------------------------------------
// System tables.
// ---------------------------------------------------------------------------

/// The Snapback-owned asset tables. The `_snapback` prefix keeps them
/// outside the app namespace: `validate_user_identifier` already refuses any
/// app-declared identifier with this prefix, so collision refusal is the
/// existing `SNAPBACK_INVALID_IDENTIFIER` diagnostic. Receipts and intent
/// generations joined the original seven with the session ticket (L1-04);
/// retained intent artifacts joined with the W2a retention work, and the
/// seed-fixture mapping with the LLP 0109 §17 amendment (W2f).
pub const ASSET_RECORDS_TABLE: &str = "_snapback_asset_records_v1";

pub const ASSET_SYSTEM_TABLES: [&str; 13] = [
    ASSET_RECORDS_TABLE,
    "_snapback_asset_attempts_v1",
    "_snapback_asset_blobs_v1",
    "_snapback_asset_renditions_v1",
    "_snapback_asset_reference_edges_v1",
    "_snapback_asset_grants_v1",
    "_snapback_asset_publications_v1",
    "_snapback_asset_work_ledger_v1",
    "_snapback_asset_receipts_v1",
    "_snapback_asset_intent_generations_v1",
    "_snapback_asset_intent_artifacts_v1",
    "_snapback_asset_signing_keys_v1",
    "_snapback_asset_seed_fixtures_v1",
];

pub fn create_infra(tx: &Transaction<'_>) -> SnapbackResult<()> {
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS _snapback_asset_records_v1 (
             asset_id TEXT PRIMARY KEY NOT NULL,
             app_id TEXT NOT NULL,
             intent_id TEXT NOT NULL,
             owner_principal TEXT NOT NULL,
             availability TEXT NOT NULL,
             media_kind TEXT,
             lifecycle_generation INTEGER NOT NULL,
             record_json TEXT NOT NULL,
             updated_at_ms INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS _snapback_asset_records_by_app_v1
             ON _snapback_asset_records_v1(app_id, availability);
         CREATE TABLE IF NOT EXISTS _snapback_asset_attempts_v1 (
             attempt_id TEXT PRIMARY KEY NOT NULL,
             asset_id TEXT NOT NULL,
             state TEXT NOT NULL,
             staging_key TEXT NOT NULL UNIQUE,
             expires_at_ms INTEGER NOT NULL,
             record_json TEXT NOT NULL,
             updated_at_ms INTEGER NOT NULL
         );
         -- The single-current-attempt invariant is structural: at most one
         -- non-terminal attempt row can exist per asset (LLP 0044 §Internal
         -- model). Supersession updates the predecessor to a terminal state
         -- in the same transaction that inserts the successor.
         CREATE UNIQUE INDEX IF NOT EXISTS _snapback_asset_attempts_current_v1
             ON _snapback_asset_attempts_v1(asset_id)
             WHERE state IN ('open', 'transferring', 'finalizing');
         CREATE TABLE IF NOT EXISTS _snapback_asset_blobs_v1 (
             blob_id TEXT PRIMARY KEY NOT NULL,
             app_id TEXT NOT NULL,
             store TEXT NOT NULL,
             physical_key TEXT NOT NULL UNIQUE,
             digest_algorithm TEXT NOT NULL,
             digest TEXT NOT NULL,
             canonicalization_policy TEXT NOT NULL,
             byte_length INTEGER NOT NULL,
             reference_count INTEGER NOT NULL,
             condemned INTEGER NOT NULL DEFAULT 0,
             record_json TEXT NOT NULL,
             updated_at_ms INTEGER NOT NULL,
             UNIQUE(app_id, digest_algorithm, digest, canonicalization_policy)
         );
         CREATE TABLE IF NOT EXISTS _snapback_asset_renditions_v1 (
             rendition_id TEXT PRIMARY KEY NOT NULL,
             asset_id TEXT NOT NULL,
             variant_key TEXT NOT NULL,
             blob_id TEXT NOT NULL,
             state TEXT NOT NULL,
             record_json TEXT NOT NULL,
             updated_at_ms INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS _snapback_asset_renditions_by_asset_v1
             ON _snapback_asset_renditions_v1(asset_id, variant_key);
         CREATE TABLE IF NOT EXISTS _snapback_asset_reference_edges_v1 (
             edge_id TEXT PRIMARY KEY NOT NULL,
             asset_id TEXT NOT NULL,
             app_id TEXT NOT NULL,
             table_name TEXT NOT NULL,
             row_id TEXT NOT NULL,
             field_path TEXT NOT NULL,
             created_at_ms INTEGER NOT NULL,
             UNIQUE(asset_id, table_name, row_id, field_path)
         );
         -- The reverse-reference index: reads capture empty results over
         -- this range so a first attachment wakes an owner-only subscriber
         -- (LLP 0053 §Asset read-authorization inputs).
         CREATE INDEX IF NOT EXISTS _snapback_asset_edges_by_asset_v1
             ON _snapback_asset_reference_edges_v1(asset_id);
         CREATE INDEX IF NOT EXISTS _snapback_asset_edges_by_row_v1
             ON _snapback_asset_reference_edges_v1(table_name, row_id);
         CREATE TABLE IF NOT EXISTS _snapback_asset_grants_v1 (
             grant_id TEXT PRIMARY KEY NOT NULL,
             asset_id TEXT NOT NULL,
             app_id TEXT NOT NULL,
             principal TEXT NOT NULL,
             state TEXT NOT NULL,
             minted_by TEXT NOT NULL,
             record_json TEXT NOT NULL
         );
         CREATE INDEX IF NOT EXISTS _snapback_asset_grants_by_asset_principal_v1
             ON _snapback_asset_grants_v1(asset_id, principal, state);
         CREATE INDEX IF NOT EXISTS _snapback_asset_grants_by_app_v1
             ON _snapback_asset_grants_v1(app_id);
         CREATE TABLE IF NOT EXISTS _snapback_asset_publications_v1 (
             publication_id TEXT PRIMARY KEY NOT NULL,
             app_id TEXT NOT NULL,
             planned_key TEXT NOT NULL UNIQUE,
             state TEXT NOT NULL,
             record_json TEXT NOT NULL,
             updated_at_ms INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS _snapback_asset_publications_by_state_v1
             ON _snapback_asset_publications_v1(state, updated_at_ms);
         CREATE TABLE IF NOT EXISTS _snapback_asset_work_ledger_v1 (
             work_id TEXT PRIMARY KEY NOT NULL,
             kind TEXT NOT NULL,
             asset_id TEXT NOT NULL,
             state TEXT NOT NULL,
             next_eligible_at_ms INTEGER NOT NULL,
             record_json TEXT NOT NULL,
             updated_at_ms INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS _snapback_asset_work_by_state_v1
             ON _snapback_asset_work_ledger_v1(state, next_eligible_at_ms);
         CREATE TABLE IF NOT EXISTS _snapback_asset_receipts_v1 (
             receipt_id TEXT PRIMARY KEY NOT NULL,
             operation_lineage TEXT NOT NULL,
             event TEXT NOT NULL,
             asset_id TEXT NOT NULL,
             attempt_id TEXT,
             at_ms INTEGER NOT NULL,
             record_json TEXT NOT NULL
         );
         CREATE INDEX IF NOT EXISTS _snapback_asset_receipts_by_asset_v1
             ON _snapback_asset_receipts_v1(asset_id, at_ms);
         CREATE INDEX IF NOT EXISTS _snapback_asset_receipts_by_event_v1
             ON _snapback_asset_receipts_v1(event, at_ms);
         CREATE TABLE IF NOT EXISTS _snapback_asset_intent_generations_v1 (
             intent_id TEXT PRIMARY KEY NOT NULL,
             intent_policy_hash TEXT NOT NULL,
             implementation_hash TEXT,
             generation INTEGER NOT NULL,
             revoked INTEGER NOT NULL DEFAULT 0,
             updated_at_ms INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS _snapback_asset_intent_artifacts_v1 (
             intent_id TEXT NOT NULL,
             generation INTEGER NOT NULL,
             intent_json TEXT NOT NULL,
             updated_at_ms INTEGER NOT NULL,
             PRIMARY KEY (intent_id, generation)
         );
         CREATE TABLE IF NOT EXISTS _snapback_asset_signing_keys_v1 (
             key_id TEXT PRIMARY KEY,
             material TEXT NOT NULL,
             created_at_ms INTEGER NOT NULL,
             retired_at_ms INTEGER
         );
         CREATE TABLE IF NOT EXISTS _snapback_asset_seed_fixtures_v1 (
             fixture_id TEXT PRIMARY KEY NOT NULL,
             source_digest TEXT NOT NULL,
             asset_id TEXT NOT NULL,
             intent_id TEXT NOT NULL,
             updated_at_ms INTEGER NOT NULL
         );",
    )?;
    // Blob record_json once carried referenceCount/condemned copies of the
    // mutable columns; the columns are the only representation now, and
    // `deny_unknown_fields` would refuse the legacy members. Idempotent strip
    // at open keeps pre-existing rows decodable.
    tx.execute(
        "UPDATE _snapback_asset_blobs_v1
         SET record_json = json_remove(record_json, '$.referenceCount', '$.condemned')
         WHERE json_extract(record_json, '$.referenceCount') IS NOT NULL
            OR json_extract(record_json, '$.condemned') IS NOT NULL",
        [],
    )?;
    // Reference-GC grace clock (W2c): `unreferenced_since_ms` is set when a
    // ready asset loses its last typed edge (or publishes with none) and
    // cleared by any edge insert. Column-only mutable state, like the blob
    // counters above. Idempotent add for pre-existing databases.
    let has_column = {
        let mut stmt = tx.prepare("SELECT 1 FROM pragma_table_info('_snapback_asset_records_v1') WHERE name = 'unreferenced_since_ms'")?;
        stmt.exists([])?
    };
    if !has_column {
        tx.execute(
            "ALTER TABLE _snapback_asset_records_v1
             ADD COLUMN unreferenced_since_ms INTEGER",
            [],
        )?;
    }
    let has_media_kind = {
        let mut stmt = tx.prepare(
            "SELECT 1 FROM pragma_table_info('_snapback_asset_records_v1')
             WHERE name = 'media_kind'",
        )?;
        stmt.exists([])?
    };
    if !has_media_kind {
        tx.execute(
            "ALTER TABLE _snapback_asset_records_v1 ADD COLUMN media_kind TEXT",
            [],
        )?;
    }
    backfill_ready_media_kinds(tx)?;
    // The implementation carrier landed additively. Existing rows remain
    // NULL so the first admission under a carrier-aware deployment observes
    // an identity change and bumps instead of silently blessing the legacy
    // policy-only generation.
    let has_implementation_hash = {
        let mut stmt = tx.prepare(
            "SELECT 1 FROM pragma_table_info('_snapback_asset_intent_generations_v1')
             WHERE name = 'implementation_hash'",
        )?;
        stmt.exists([])?
    };
    if !has_implementation_hash {
        tx.execute(
            "ALTER TABLE _snapback_asset_intent_generations_v1
             ADD COLUMN implementation_hash TEXT",
            [],
        )?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Per-intent policy generations (LLP 0044 §Internal model). Generations are
// minted lazily inside the attempt-create transaction: the loaded manifest's
// policy + implementation hashes are the activation identity, so the first
// admission after either changes bumps the generation — an O(1) per-intent
// event, never per-asset fanout. Revocation has exactly three explicit
// triggers (intent removal, a revoking-flagged deployment, the operator
// action); the flag lives here and refuses finalization-side work.
// ---------------------------------------------------------------------------

pub struct IntentGeneration {
    pub generation: u64,
    pub revoked: bool,
}

pub fn ensure_intent_generation(
    tx: &Transaction<'_>,
    intent_id: &str,
    intent_policy_hash: &str,
    implementation_hash: &str,
    intent_json: &str,
    now_ms: u64,
) -> SnapbackResult<IntentGeneration> {
    let existing: Option<(String, Option<String>, u64, bool)> = tx
        .query_row(
            "SELECT intent_policy_hash, implementation_hash, generation, revoked
             FROM _snapback_asset_intent_generations_v1 WHERE intent_id = ?1",
            [intent_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get::<_, i64>(3)? != 0,
                ))
            },
        )
        .optional()?;
    let result = match existing {
        None => {
            tx.execute(
                "INSERT INTO _snapback_asset_intent_generations_v1 (
                     intent_id, intent_policy_hash, implementation_hash,
                     generation, revoked, updated_at_ms
                 ) VALUES (?1, ?2, ?3, 1, 0, ?4)",
                rusqlite::params![intent_id, intent_policy_hash, implementation_hash, now_ms],
            )?;
            IntentGeneration {
                generation: 1,
                revoked: false,
            }
        }
        Some((stored_policy_hash, Some(stored_implementation_hash), generation, revoked))
            if stored_policy_hash == intent_policy_hash
                && stored_implementation_hash == implementation_hash =>
        {
            IntentGeneration {
                generation,
                revoked,
            }
        }
        Some((_, _, generation, _)) => {
            // A changed intent activated: bump, and clear any revocation —
            // the new policy and implementation are the author's current
            // word.
            tx.execute(
                "UPDATE _snapback_asset_intent_generations_v1
                 SET intent_policy_hash = ?2, implementation_hash = ?3,
                     generation = ?4, revoked = 0, updated_at_ms = ?5
                 WHERE intent_id = ?1",
                rusqlite::params![
                    intent_id,
                    intent_policy_hash,
                    implementation_hash,
                    generation + 1,
                    now_ms
                ],
            )?;
            IntentGeneration {
                generation: generation + 1,
                revoked: false,
            }
        }
    };
    // Retention (LLP 0044 v6.1 reading (a)): the artifact that can re-run
    // this generation's authorizer is retained keyed by (intent, generation)
    // until the last open attempt admitted under it terminates. Idempotent
    // upsert self-heals a missing artifact for the current generation.
    tx.execute(
        "INSERT INTO _snapback_asset_intent_artifacts_v1 (
             intent_id, generation, intent_json, updated_at_ms
         ) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(intent_id, generation)
         DO UPDATE SET intent_json = ?3, updated_at_ms = ?4",
        rusqlite::params![intent_id, result.generation, intent_json, now_ms],
    )?;
    Ok(result)
}

pub fn load_intent_artifact(
    tx: &Transaction<'_>,
    intent_id: &str,
    generation: u64,
) -> SnapbackResult<Option<String>> {
    Ok(tx
        .query_row(
            "SELECT intent_json FROM _snapback_asset_intent_artifacts_v1
             WHERE intent_id = ?1 AND generation = ?2",
            rusqlite::params![intent_id, generation],
            |row| row.get(0),
        )
        .optional()?)
}

/// Reclaims retained artifacts of superseded generations once no non-terminal
/// attempt was admitted under them. The current generation's artifact is
/// always kept. Returns the reclaimed (intent, generation) pairs so the
/// sweep can receipt each one.
pub fn reclaim_intent_artifacts(tx: &Transaction<'_>) -> SnapbackResult<Vec<(String, u64)>> {
    let mut statement = tx.prepare(
        "DELETE FROM _snapback_asset_intent_artifacts_v1 AS a
         WHERE NOT EXISTS (
                 SELECT 1 FROM _snapback_asset_intent_generations_v1 g
                 WHERE g.intent_id = a.intent_id AND g.generation = a.generation
               )
           AND NOT EXISTS (
                 SELECT 1 FROM _snapback_asset_attempts_v1 t
                 WHERE t.state IN ('open', 'transferring', 'finalizing')
                   AND json_extract(t.record_json, '$.intentId') = a.intent_id
                   AND json_extract(t.record_json, '$.admission.policyGeneration')
                       = a.generation
               )
         RETURNING intent_id, generation",
    )?;
    let reclaimed = statement
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(reclaimed)
}

// ---------------------------------------------------------------------------
// Receipts (LLP 0044 §Receipts): semantic events with shared lineage.
// ---------------------------------------------------------------------------

pub fn write_receipt(tx: &Transaction<'_>, receipt: &AssetReceiptV1) -> SnapbackResult<()> {
    let record_json = serde_json::to_string(receipt).map_err(|error| {
        SnapbackError::error(
            "SNAPBACK_ASSET_RECORD_INVALID",
            "assets",
            format!("receipt does not serialize: {error}"),
        )
    })?;
    let event = serde_json::to_value(receipt.event)
        .ok()
        .and_then(|value| value.as_str().map(str::to_owned))
        .unwrap_or_default();
    tx.execute(
        "INSERT INTO _snapback_asset_receipts_v1 (
             receipt_id, operation_lineage, event, asset_id, attempt_id, at_ms,
             record_json
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
            receipt.receipt_id,
            receipt.operation_lineage,
            event,
            receipt.asset_id.clone().unwrap_or_default(),
            receipt.attempt_id,
            receipt.at_ms,
            record_json,
        ],
    )?;
    Ok(())
}

/// Receipts for one asset, oldest first — the operator inspection
/// projection. Receipts carry only safe structured facts by construction.
pub fn receipts_for_asset(
    tx: &Transaction<'_>,
    asset_id: &str,
    limit: usize,
) -> SnapbackResult<Vec<AssetReceiptV1>> {
    let mut statement = tx.prepare(
        "SELECT record_json FROM _snapback_asset_receipts_v1
         WHERE asset_id = ?1 ORDER BY at_ms ASC, receipt_id ASC LIMIT ?2",
    )?;
    let rows = statement.query_map(rusqlite::params![asset_id, limit as i64], |row| {
        row.get::<_, String>(0)
    })?;
    let mut parsed = Vec::new();
    for json in rows {
        parsed.push(decode_record(&json?)?);
    }
    Ok(parsed)
}

/// Bound the read-rate receipt class without changing lifecycle evidence.
pub fn purge_delivery_receipts(tx: &Transaction<'_>, cutoff_ms: u64) -> SnapbackResult<u64> {
    let removed = tx.execute(
        "DELETE FROM _snapback_asset_receipts_v1
         WHERE event = 'delivery-admitted' AND at_ms <= ?1",
        [cutoff_ms],
    )?;
    Ok(removed as u64)
}

/// Ledger rows for one asset, any state — operator inspection of runner
/// claims and pending work.
pub fn work_rows_for_asset(
    tx: &Transaction<'_>,
    asset_id: &str,
) -> SnapbackResult<Vec<AssetWorkRowV1>> {
    let mut statement = tx.prepare(
        "SELECT record_json FROM _snapback_asset_work_ledger_v1
         WHERE asset_id = ?1 ORDER BY updated_at_ms ASC, work_id ASC",
    )?;
    let rows = statement.query_map([asset_id], |row| row.get::<_, String>(0))?;
    let mut parsed = Vec::new();
    for json in rows {
        parsed.push(decode_record(&json?)?);
    }
    Ok(parsed)
}

/// Assets filtered by availability (or all), newest first — the operator
/// listing.
pub fn assets_in_state(
    tx: &Transaction<'_>,
    state: Option<AssetAvailability>,
    limit: usize,
) -> SnapbackResult<Vec<AssetRecordV1>> {
    let mut parsed = Vec::new();
    match state {
        Some(state) => {
            let mut statement = tx.prepare(
                "SELECT record_json FROM _snapback_asset_records_v1
                 WHERE availability = ?1
                 ORDER BY updated_at_ms DESC, asset_id ASC LIMIT ?2",
            )?;
            let rows = statement
                .query_map(rusqlite::params![state_str(state)?, limit as i64], |row| {
                    row.get::<_, String>(0)
                })?;
            for json in rows {
                parsed.push(decode_record(&json?)?);
            }
        }
        None => {
            let mut statement = tx.prepare(
                "SELECT record_json FROM _snapback_asset_records_v1
                 ORDER BY updated_at_ms DESC, asset_id ASC LIMIT ?1",
            )?;
            let rows = statement.query_map(rusqlite::params![limit as i64], |row| {
                row.get::<_, String>(0)
            })?;
            for json in rows {
                parsed.push(decode_record(&json?)?);
            }
        }
    }
    Ok(parsed)
}

// ---------------------------------------------------------------------------
// Asset and attempt persistence. Every write goes through these helpers so
// the closed transition tables are enforced in exactly one place.
// ---------------------------------------------------------------------------

fn record_json<T: Serialize>(record: &T) -> SnapbackResult<String> {
    serde_json::to_string(record).map_err(|error| {
        SnapbackError::error(
            "SNAPBACK_ASSET_RECORD_INVALID",
            "assets",
            format!("asset record does not serialize: {error}"),
        )
    })
}

fn decode_record<T: for<'de> Deserialize<'de>>(json: &str) -> SnapbackResult<T> {
    serde_json::from_str(json).map_err(|error| {
        SnapbackError::error(
            "SNAPBACK_ASSET_RECORD_INVALID",
            "assets",
            format!("stored asset record does not decode: {error}"),
        )
    })
}

/// The closed asset-availability transition table (LLP 0044 §Lifecycle
/// transitions). Anything not listed is refused.
pub fn asset_transition_allowed(from: AssetAvailability, to: AssetAvailability) -> bool {
    use AssetAvailability as A;
    matches!(
        (from, to),
        (A::Pending, A::Ready)
            | (A::Pending, A::Rejected)
            | (A::Pending, A::Deleted)
            | (A::Ready, A::Deleted)
            | (A::Rejected, A::Deleted)
    )
}

/// The closed attempt transition table. Terminal states admit nothing.
pub fn attempt_transition_allowed(from: AssetAttemptState, to: AssetAttemptState) -> bool {
    use AssetAttemptState as S;
    matches!(
        (from, to),
        (S::Open, S::Transferring)
            | (S::Open | S::Transferring, S::Finalizing)
            | (S::Finalizing, S::Complete)
            | (S::Open | S::Transferring | S::Finalizing, S::Expired)
            | (S::Open | S::Transferring | S::Finalizing, S::Cancelled)
            | (S::Open | S::Transferring | S::Finalizing, S::Failed)
    )
}

pub fn insert_asset(tx: &Transaction<'_>, record: &AssetRecordV1) -> SnapbackResult<()> {
    tx.execute(
        "INSERT INTO _snapback_asset_records_v1 (
             asset_id, app_id, intent_id, owner_principal, availability,
             media_kind, lifecycle_generation, record_json, updated_at_ms
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![
            record.asset_id,
            record.app_id,
            record.intent_id,
            record.owner_principal,
            serde_json::to_value(record.availability)
                .ok()
                .and_then(|v| v.as_str().map(str::to_owned))
                .unwrap_or_default(),
            record
                .media_kind
                .and_then(|kind| serde_json::to_value(kind).ok())
                .and_then(|value| value.as_str().map(str::to_owned)),
            record.lifecycle_generation,
            record_json(record)?,
            record.updated_at_ms,
        ],
    )?;
    Ok(())
}

pub fn load_asset(tx: &Transaction<'_>, asset_id: &str) -> SnapbackResult<Option<AssetRecordV1>> {
    let json: Option<String> = tx
        .query_row(
            "SELECT record_json FROM _snapback_asset_records_v1 WHERE asset_id = ?1",
            [asset_id],
            |row| row.get(0),
        )
        .optional()?;
    json.map(|json| decode_record(&json)).transpose()
}

// ---------------------------------------------------------------------------
// L1-07: commit-boundary typed references (LLP 0044 §Typed references and
// atomic attachment; LLP 0007 dated amendment 2026-07-31).
// ---------------------------------------------------------------------------

/// A transaction-scoped attachment admission. `ctx.assets.attach` records one
/// during handler execution; it never serializes, persists, or crosses a
/// transaction boundary, so app code cannot construct, store, or replay one.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AssetAttachmentAdmission {
    pub asset_id: String,
    /// The upload-intent binding the handler named, when it named one.
    pub upload: Option<String>,
}

/// Which write path is committing. Handler paths admit through recorded
/// admissions; paths without handler execution derive the admission from the
/// field's schema-declared intent restriction at the commit boundary.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AssetWritePath {
    Handler,
    HostPlan,
    Seed,
}

pub struct AssetCommitAuthority<'a> {
    pub path: AssetWritePath,
    /// The effective caller principal; `None` only for system authority
    /// (seed), which skips the owner comparison but nothing else.
    pub principal: Option<&'a str>,
    pub admissions: &'a [AssetAttachmentAdmission],
}

pub fn load_edge_for_field(
    tx: &Transaction<'_>,
    table: &str,
    row_id: &str,
    field: &str,
) -> SnapbackResult<Option<AssetReferenceEdgeV1>> {
    let json: Option<String> = tx
        .query_row(
            "SELECT edge_id, asset_id, app_id, table_name, row_id, field_path, created_at_ms
             FROM _snapback_asset_reference_edges_v1
             WHERE table_name = ?1 AND row_id = ?2 AND field_path = ?3",
            rusqlite::params![table, row_id, field],
            |row| {
                Ok(serde_json::to_string(&AssetReferenceEdgeV1 {
                    edge_id: row.get(0)?,
                    asset_id: row.get(1)?,
                    app_id: row.get(2)?,
                    table_name: row.get(3)?,
                    row_id: row.get(4)?,
                    field_path: row.get(5)?,
                    created_at_ms: row.get::<_, i64>(6)? as u64,
                })
                .unwrap_or_default())
            },
        )
        .optional()?;
    json.map(|json| decode_record(&json)).transpose()
}

pub fn load_edges_for_row(
    tx: &Transaction<'_>,
    table: &str,
    row_id: &str,
) -> SnapbackResult<Vec<AssetReferenceEdgeV1>> {
    let mut statement = tx.prepare(
        "SELECT edge_id, asset_id, app_id, table_name, row_id, field_path, created_at_ms
         FROM _snapback_asset_reference_edges_v1
         WHERE table_name = ?1 AND row_id = ?2 ORDER BY field_path",
    )?;
    let rows = statement.query_map(rusqlite::params![table, row_id], |row| {
        Ok(AssetReferenceEdgeV1 {
            edge_id: row.get(0)?,
            asset_id: row.get(1)?,
            app_id: row.get(2)?,
            table_name: row.get(3)?,
            row_id: row.get(4)?,
            field_path: row.get(5)?,
            created_at_ms: row.get::<_, i64>(6)? as u64,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn load_edges_for_asset(
    tx: &Transaction<'_>,
    asset_id: &str,
) -> SnapbackResult<Vec<AssetReferenceEdgeV1>> {
    let mut statement = tx.prepare(
        "SELECT edge_id, asset_id, app_id, table_name, row_id, field_path, created_at_ms
         FROM _snapback_asset_reference_edges_v1
         WHERE asset_id = ?1 ORDER BY table_name, row_id, field_path",
    )?;
    let rows = statement.query_map([asset_id], |row| {
        Ok(AssetReferenceEdgeV1 {
            edge_id: row.get(0)?,
            asset_id: row.get(1)?,
            app_id: row.get(2)?,
            table_name: row.get(3)?,
            row_id: row.get(4)?,
            field_path: row.get(5)?,
            created_at_ms: row.get::<_, i64>(6)? as u64,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn insert_reference_edge(
    tx: &Transaction<'_>,
    app_id: &str,
    asset_id: &str,
    table: &str,
    row_id: &str,
    field: &str,
    now_ms: u64,
) -> SnapbackResult<AssetReferenceEdgeV1> {
    let edge = AssetReferenceEdgeV1 {
        edge_id: Uuid::now_v7().to_string(),
        asset_id: asset_id.to_owned(),
        app_id: app_id.to_owned(),
        table_name: table.to_owned(),
        row_id: row_id.to_owned(),
        field_path: field.to_owned(),
        created_at_ms: now_ms,
    };
    tx.execute(
        "INSERT INTO _snapback_asset_reference_edges_v1
             (edge_id, asset_id, app_id, table_name, row_id, field_path, created_at_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
            edge.edge_id,
            edge.asset_id,
            edge.app_id,
            edge.table_name,
            edge.row_id,
            edge.field_path,
            edge.created_at_ms as i64,
        ],
    )?;
    // Any typed reference stops the reference-GC grace clock.
    tx.execute(
        "UPDATE _snapback_asset_records_v1
         SET unreferenced_since_ms = NULL WHERE asset_id = ?1",
        [&edge.asset_id],
    )?;
    Ok(edge)
}

/// Removes one typed edge and, when it was the asset's last, starts the
/// reference-GC grace clock (LLP 0044 §Deletion: grace is measured from the
/// moment the asset became unreferenced, durable across restarts).
pub fn delete_reference_edge(
    tx: &Transaction<'_>,
    edge: &AssetReferenceEdgeV1,
    now_ms: u64,
) -> SnapbackResult<()> {
    tx.execute(
        "DELETE FROM _snapback_asset_reference_edges_v1 WHERE edge_id = ?1",
        [&edge.edge_id],
    )?;
    tx.execute(
        "UPDATE _snapback_asset_records_v1
         SET unreferenced_since_ms = ?2
         WHERE asset_id = ?1
           AND availability = 'ready'
           AND NOT EXISTS (
               SELECT 1 FROM _snapback_asset_reference_edges_v1
               WHERE asset_id = ?1
           )
           AND NOT EXISTS (
               SELECT 1 FROM _snapback_asset_grants_v1
               WHERE asset_id = ?1 AND state = 'active'
           )",
        rusqlite::params![edge.asset_id, now_ms as i64],
    )?;
    Ok(())
}

/// Starts the grace clock for an asset that publishes `ready` with no typed
/// edges (the never-attached upload); a later attachment clears it.
pub fn mark_unreferenced_if_edgeless(
    tx: &Transaction<'_>,
    asset_id: &str,
    now_ms: u64,
) -> SnapbackResult<()> {
    tx.execute(
        "UPDATE _snapback_asset_records_v1
         SET unreferenced_since_ms = ?2
         WHERE asset_id = ?1
           AND availability = 'ready'
           AND unreferenced_since_ms IS NULL
           AND NOT EXISTS (
               SELECT 1 FROM _snapback_asset_reference_edges_v1
               WHERE asset_id = ?1
           )
           AND NOT EXISTS (
               SELECT 1 FROM _snapback_asset_grants_v1
               WHERE asset_id = ?1 AND state = 'active'
           )",
        rusqlite::params![asset_id, now_ms as i64],
    )?;
    Ok(())
}

/// Ready assets whose grace clock started at or before `cutoff` — the
/// reference-GC candidates. The sweep re-verifies edgelessness inside the
/// reclamation transaction; this query is the index-friendly prefilter.
pub fn reclaimable_reference_gc_assets(
    tx: &Transaction<'_>,
    cutoff_ms: u64,
) -> SnapbackResult<Vec<AssetRecordV1>> {
    let mut stmt = tx.prepare(
        "SELECT record_json FROM _snapback_asset_records_v1
         WHERE availability = 'ready'
           AND unreferenced_since_ms IS NOT NULL
           AND unreferenced_since_ms <= ?1
           AND NOT EXISTS (
               SELECT 1 FROM _snapback_asset_grants_v1 g
               WHERE g.asset_id = _snapback_asset_records_v1.asset_id
                 AND g.state = 'active')
         ORDER BY unreferenced_since_ms ASC",
    )?;
    let rows = stmt.query_map([cutoff_ms as i64], |row| row.get::<_, String>(0))?;
    let mut assets = Vec::new();
    for row in rows {
        assets.push(decode_record::<AssetRecordV1>(&row?)?);
    }
    Ok(assets)
}

fn attach_refusal(code: &str, message: String, asset_id: &str) -> SnapbackError {
    SnapbackError::error(code, "assets", message).with_details(
        serde_json::to_value(AssetRefusalDetailV1 {
            asset_id: Some(asset_id.to_owned()),
            attempt_id: None,
            intent_id: None,
            lifecycle_generation: None,
            limit: None,
            observed: None,
        })
        .unwrap_or(Value::Null),
    )
}

/// The commit-boundary attachment check (LLP 0044 v6.1). Runs inside the
/// committing transaction — the final write lock — so deletion, ownership
/// change, or revocation racing an earlier `attach` refuses here instead of
/// committing a stale admission.
pub fn verify_attachment(
    tx: &Transaction<'_>,
    app_id: &str,
    asset_id: &str,
    field_restriction: Option<&str>,
    admission_upload: Option<&str>,
    authority: &AssetCommitAuthority<'_>,
) -> SnapbackResult<AssetRecordV1> {
    if let (Some(field), Some(named)) = (field_restriction, admission_upload)
        && field != named
    {
        return Err(attach_refusal(
            "SNAPBACK_ASSET_ATTACH_INTENT_MISMATCH",
            format!("attach named upload intent {named:?} but the field restricts to {field:?}"),
            asset_id,
        ));
    }
    let asset = load_asset(tx, asset_id)?.ok_or_else(|| {
        attach_refusal(
            "SNAPBACK_ASSET_ATTACH_DENIED",
            "attachment names an unknown asset".to_owned(),
            asset_id,
        )
    })?;
    if asset.app_id != app_id {
        return Err(attach_refusal(
            "SNAPBACK_ASSET_ATTACH_DENIED",
            "attachment crosses an app boundary".to_owned(),
            asset_id,
        ));
    }
    if let Some(restriction) = field_restriction.or(admission_upload)
        && asset.intent_name != restriction
        && asset.intent_id != restriction
    {
        return Err(attach_refusal(
            "SNAPBACK_ASSET_ATTACH_INTENT_MISMATCH",
            format!(
                "asset was admitted by intent {:?}, not {restriction:?}",
                asset.intent_name
            ),
            asset_id,
        ));
    }
    match asset.availability {
        AssetAvailability::Pending | AssetAvailability::Ready => {}
        other => {
            return Err(attach_refusal(
                "SNAPBACK_ASSET_ATTACH_UNAVAILABLE",
                format!("a {other:?} asset admits no attachment"),
                asset_id,
            ));
        }
    }
    match authority.principal {
        Some(principal) => {
            if principal != asset.owner_principal {
                return Err(attach_refusal(
                    "SNAPBACK_ASSET_FORBIDDEN",
                    "attachment caller is not the asset owner".to_owned(),
                    asset_id,
                ));
            }
        }
        None => {
            if authority.path != AssetWritePath::Seed {
                return Err(attach_refusal(
                    "SNAPBACK_ASSET_FORBIDDEN",
                    "attachment requires a caller principal".to_owned(),
                    asset_id,
                ));
            }
        }
    }
    Ok(asset)
}

/// Persist an availability transition, enforcing the closed table and
/// bumping the lifecycle generation.
pub fn transition_asset(
    tx: &Transaction<'_>,
    record: &mut AssetRecordV1,
    to: AssetAvailability,
    now_ms: u64,
) -> SnapbackResult<()> {
    if !asset_transition_allowed(record.availability, to) {
        return Err(SnapbackError::error(
            "SNAPBACK_ASSET_TRANSITION_INVALID",
            "assets",
            format!(
                "asset availability cannot move {:?} → {to:?}",
                record.availability
            ),
        ));
    }
    record.availability = to;
    record.lifecycle_generation += 1;
    record.updated_at_ms = now_ms;
    if to == AssetAvailability::Deleted {
        record.deleted_at_ms = Some(now_ms);
    }
    store_asset(tx, record)
}

pub fn store_asset(tx: &Transaction<'_>, record: &AssetRecordV1) -> SnapbackResult<()> {
    let changed = tx.execute(
        "UPDATE _snapback_asset_records_v1
         SET availability = ?2, media_kind = ?3, lifecycle_generation = ?4,
             record_json = ?5, updated_at_ms = ?6
         WHERE asset_id = ?1",
        rusqlite::params![
            record.asset_id,
            serde_json::to_value(record.availability)
                .ok()
                .and_then(|v| v.as_str().map(str::to_owned))
                .unwrap_or_default(),
            record
                .media_kind
                .and_then(|kind| serde_json::to_value(kind).ok())
                .and_then(|value| value.as_str().map(str::to_owned)),
            record.lifecycle_generation,
            record_json(record)?,
            record.updated_at_ms,
        ],
    )?;
    if changed != 1 {
        return Err(SnapbackError::error(
            "SNAPBACK_ASSET_RECORD_INVALID",
            "assets",
            format!("asset {} does not exist to update", record.asset_id),
        ));
    }
    Ok(())
}

/// Closed `detected-content-type.v1` classification profile.
pub fn media_kind_for_detected_content_type(content_type: &str) -> MediaKindV1 {
    let normalized = content_type.trim().to_ascii_lowercase();
    if normalized.starts_with("image/") {
        MediaKindV1::Image
    } else if normalized.starts_with("video/") {
        MediaKindV1::Video
    } else if normalized.starts_with("audio/") {
        MediaKindV1::Audio
    } else {
        MediaKindV1::File
    }
}

fn backfill_ready_media_kinds(tx: &Transaction<'_>) -> SnapbackResult<()> {
    let mut stmt = tx.prepare(
        "SELECT asset_id FROM _snapback_asset_records_v1
         WHERE availability = 'ready' ORDER BY asset_id",
    )?;
    let ids = stmt
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    drop(stmt);
    for asset_id in ids {
        let mut asset = load_asset(tx, &asset_id)?.ok_or_else(media_projection_integrity)?;
        let rendition_id = asset
            .primary_rendition_id
            .as_deref()
            .ok_or_else(media_projection_integrity)?;
        let rendition = load_rendition(tx, rendition_id)?.ok_or_else(media_projection_integrity)?;
        let detected = rendition
            .media_facts
            .as_ref()
            .and_then(|facts| facts.get("contentType"))
            .and_then(Value::as_str)
            .ok_or_else(media_projection_integrity)?;
        let expected = media_kind_for_detected_content_type(detected);
        if asset.media_kind.is_some_and(|kind| kind != expected) {
            return Err(media_projection_integrity());
        }
        if asset.media_kind.is_none() {
            asset.media_kind = Some(expected);
            store_asset(tx, &asset)?;
        }
    }
    Ok(())
}

pub(crate) fn media_projection_integrity() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_MEDIA_PROJECTION_INTEGRITY",
        "assets",
        "media projection storage invariants are not satisfied",
    )
}

pub fn insert_attempt(tx: &Transaction<'_>, record: &AssetAttemptRecordV1) -> SnapbackResult<()> {
    tx.execute(
        "INSERT INTO _snapback_asset_attempts_v1 (
             attempt_id, asset_id, state, staging_key, expires_at_ms,
             record_json, updated_at_ms
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
            record.attempt_id,
            record.asset_id,
            record.state.as_str(),
            record.staging_key,
            record.expires_at_ms,
            record_json(record)?,
            record.updated_at_ms,
        ],
    )?;
    Ok(())
}

pub fn load_attempt(
    tx: &Transaction<'_>,
    attempt_id: &str,
) -> SnapbackResult<Option<AssetAttemptRecordV1>> {
    let json: Option<String> = tx
        .query_row(
            "SELECT record_json FROM _snapback_asset_attempts_v1 WHERE attempt_id = ?1",
            [attempt_id],
            |row| row.get(0),
        )
        .optional()?;
    json.map(|json| decode_record(&json)).transpose()
}

pub fn store_attempt(tx: &Transaction<'_>, record: &AssetAttemptRecordV1) -> SnapbackResult<()> {
    let changed = tx.execute(
        "UPDATE _snapback_asset_attempts_v1
         SET state = ?2, record_json = ?3, updated_at_ms = ?4, expires_at_ms = ?5
         WHERE attempt_id = ?1",
        rusqlite::params![
            record.attempt_id,
            record.state.as_str(),
            record_json(record)?,
            record.updated_at_ms,
            record.expires_at_ms,
        ],
    )?;
    if changed != 1 {
        return Err(SnapbackError::error(
            "SNAPBACK_ASSET_RECORD_INVALID",
            "assets",
            format!("attempt {} does not exist to update", record.attempt_id),
        ));
    }
    Ok(())
}

/// Move an attempt through the closed transition table.
pub fn transition_attempt(
    tx: &Transaction<'_>,
    record: &mut AssetAttemptRecordV1,
    to: AssetAttemptState,
    now_ms: u64,
) -> SnapbackResult<()> {
    if !attempt_transition_allowed(record.state, to) {
        return Err(SnapbackError::error(
            "SNAPBACK_ASSET_TRANSITION_INVALID",
            "assets",
            format!("attempt cannot move {:?} → {to:?}", record.state),
        ));
    }
    record.state = to;
    record.updated_at_ms = now_ms;
    store_attempt(tx, record)
}

/// The current (non-terminal) attempt for an asset, if any.
pub fn current_attempt(
    tx: &Transaction<'_>,
    asset_id: &str,
) -> SnapbackResult<Option<AssetAttemptRecordV1>> {
    let json: Option<String> = tx
        .query_row(
            "SELECT record_json FROM _snapback_asset_attempts_v1
             WHERE asset_id = ?1 AND state IN ('open', 'transferring', 'finalizing')",
            [asset_id],
            |row| row.get(0),
        )
        .optional()?;
    json.map(|json| decode_record(&json)).transpose()
}

/// The attempt that published a ready asset. Append-only attempts plus the
/// single-current invariant leave at most one `complete` attempt per asset
/// (replacement is a new asset; retry supersedes its predecessor).
pub fn completed_attempt(
    tx: &Transaction<'_>,
    asset_id: &str,
) -> SnapbackResult<Option<AssetAttemptRecordV1>> {
    let json: Option<String> = tx
        .query_row(
            "SELECT record_json FROM _snapback_asset_attempts_v1
             WHERE asset_id = ?1 AND state = 'complete'",
            [asset_id],
            |row| row.get(0),
        )
        .optional()?;
    json.map(|json| decode_record(&json)).transpose()
}

// ---------------------------------------------------------------------------
// Quota and ceiling accounting (LLP 0044 §Deduplication/quotas). Logical
// usage charges each rendition record's blob once (the primary included
// exactly once — there is no second asset-to-blob edge) with the minimum
// accounting unit as a floor per asset; reservations are the open attempts'
// declared lengths, floored the same way.
// ---------------------------------------------------------------------------

pub struct AssetAccounting {
    pub reserved_bytes: u64,
    pub settled_bytes: u64,
    pub open_attempts_app: u64,
}

pub fn asset_accounting(tx: &Transaction<'_>, app_id: &str) -> SnapbackResult<AssetAccounting> {
    let (reserved_bytes, open_attempts_app): (u64, u64) = tx.query_row(
        "SELECT COALESCE(SUM(MAX(json_extract(record_json, '$.declaredLength'), ?2)), 0),
                COUNT(*)
         FROM _snapback_asset_attempts_v1
         WHERE state IN ('open', 'transferring', 'finalizing')
           AND json_extract(record_json, '$.appId') = ?1",
        rusqlite::params![app_id, ASSET_MIN_ACCOUNTING_UNIT_BYTES],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let settled_bytes: u64 = tx.query_row(
        "SELECT COALESCE(SUM(MAX(b.byte_length, ?2)), 0)
         FROM _snapback_asset_renditions_v1 r
         JOIN _snapback_asset_blobs_v1 b ON b.blob_id = r.blob_id
         JOIN _snapback_asset_records_v1 a ON a.asset_id = r.asset_id
         WHERE a.app_id = ?1 AND r.state IN ('pending', 'ready')",
        rusqlite::params![app_id, ASSET_MIN_ACCOUNTING_UNIT_BYTES],
        |row| row.get(0),
    )?;
    Ok(AssetAccounting {
        reserved_bytes,
        settled_bytes,
        open_attempts_app,
    })
}

pub fn open_attempts_for_principal(
    tx: &Transaction<'_>,
    app_id: &str,
    principal: &str,
) -> SnapbackResult<u64> {
    Ok(tx.query_row(
        "SELECT COUNT(*) FROM _snapback_asset_attempts_v1
         WHERE state IN ('open', 'transferring', 'finalizing')
           AND json_extract(record_json, '$.appId') = ?1
           AND json_extract(record_json, '$.admission.ownerPrincipal') = ?2",
        rusqlite::params![app_id, principal],
        |row| row.get(0),
    )?)
}

// ---------------------------------------------------------------------------
// Local filesystem byte store.
// ---------------------------------------------------------------------------

/// The `local-fs` store parameter: restricted staging and immutable blobs
/// under the instance directory, opaque keys only.
///
/// @ref LLP 0044#restricted-staging-and-trusted-finalization — staging is
///   never addressable through delivery and is deleted after finalization or
///   mandatory GC.
pub struct AssetFsStore {
    staging_dir: PathBuf,
    blobs_dir: PathBuf,
}

pub const ASSET_STORE_LOCAL_FS: &str = "local-fs";

impl AssetFsStore {
    pub(crate) fn staging_directory(instance_dir: &Path) -> PathBuf {
        instance_dir.join("assets").join("staging")
    }

    pub(crate) fn blobs_directory(instance_dir: &Path) -> PathBuf {
        instance_dir.join("assets").join("blobs")
    }

    pub fn open(instance_dir: &Path) -> SnapbackResult<Self> {
        let staging_dir = Self::staging_directory(instance_dir);
        let blobs_dir = Self::blobs_directory(instance_dir);
        for dir in [&staging_dir, &blobs_dir] {
            std::fs::create_dir_all(dir).map_err(|error| {
                SnapbackError::error(
                    "SNAPBACK_ASSET_STORE_UNAVAILABLE",
                    "assets",
                    format!(
                        "cannot create asset store directory {}: {error}",
                        dir.display()
                    ),
                )
            })?;
        }
        Ok(Self {
            staging_dir,
            blobs_dir,
        })
    }

    /// Opaque keys are UUIDv7 (LLP 0004's ratified id algorithm) — never
    /// derived from app data, filenames, or digests.
    pub fn new_opaque_key() -> String {
        Uuid::now_v7().to_string()
    }

    pub fn staging_path(&self, staging_key: &str) -> SnapbackResult<PathBuf> {
        Ok(self.staging_dir.join(validated_key(staging_key)?))
    }

    /// The canonical rewrite staged beside its source; same restricted
    /// custody, same lifetime (`delete_staging` removes both).
    pub fn canonical_staging_path(&self, staging_key: &str) -> SnapbackResult<PathBuf> {
        let mut name = validated_key(staging_key)?.to_owned();
        name.push_str(ASSET_CANONICAL_SUFFIX);
        Ok(self.staging_dir.join(name))
    }

    pub fn blob_path(&self, physical_key: &str) -> SnapbackResult<PathBuf> {
        Ok(self.blobs_dir.join(validated_key(physical_key)?))
    }

    #[cfg(test)]
    pub fn blobs_dir_for_test(&self) -> &Path {
        &self.blobs_dir
    }

    /// Destructive-reset companion (LLP 0109 §17): after the reset
    /// transaction clears every asset system table, the store's files are
    /// unreferenced by construction, so both namespaces empty wholesale.
    pub fn wipe_all(&self) -> SnapbackResult<()> {
        for dir in [&self.staging_dir, &self.blobs_dir] {
            let entries = std::fs::read_dir(dir).map_err(|error| {
                SnapbackError::error(
                    "SNAPBACK_ASSET_STORE_UNAVAILABLE",
                    "assets",
                    format!(
                        "cannot list asset store directory {}: {error}",
                        dir.display()
                    ),
                )
            })?;
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    let _ = std::fs::remove_file(&path);
                }
            }
        }
        Ok(())
    }

    /// Every file currently in the staging namespace, by opaque key. The GC
    /// sweep diffs this against live attempts to find crash orphans.
    pub fn list_staging_keys(&self) -> SnapbackResult<Vec<String>> {
        let mut keys = Vec::new();
        let entries = match std::fs::read_dir(&self.staging_dir) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(keys),
            Err(error) => {
                return Err(SnapbackError::error(
                    "SNAPBACK_ASSET_STORE_UNAVAILABLE",
                    "assets",
                    format!("cannot list staging: {error}"),
                ));
            }
        };
        for entry in entries {
            let entry = entry.map_err(|error| {
                SnapbackError::error(
                    "SNAPBACK_ASSET_STORE_UNAVAILABLE",
                    "assets",
                    format!("cannot list staging: {error}"),
                )
            })?;
            if let Some(name) = entry.file_name().to_str() {
                // A canonical rewrite belongs to its source key: the orphan
                // sweep must see one custody unit, or it would reap a live
                // attempt's rewrite mid-finalization.
                let key = name.strip_suffix(ASSET_CANONICAL_SUFFIX).unwrap_or(name);
                if !keys.iter().any(|existing| existing == key) {
                    keys.push(key.to_owned());
                }
            }
        }
        Ok(keys)
    }

    pub fn delete_staging(&self, staging_key: &str) -> SnapbackResult<()> {
        for path in [
            self.staging_path(staging_key)?,
            self.canonical_staging_path(staging_key)?,
        ] {
            match std::fs::remove_file(&path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => {
                    return Err(SnapbackError::error(
                        "SNAPBACK_ASSET_STORE_UNAVAILABLE",
                        "assets",
                        format!("cannot delete staging object: {error}"),
                    ));
                }
            }
        }
        Ok(())
    }
}

fn validated_key(key: &str) -> SnapbackResult<&str> {
    let valid = !key.is_empty() && key.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    if !valid {
        return Err(SnapbackError::error(
            "SNAPBACK_ASSET_STORE_KEY_INVALID",
            "assets",
            "asset store keys are opaque identifiers, never paths or names",
        ));
    }
    Ok(key)
}

// ---------------------------------------------------------------------------
// Blob reference transactions (LLP 0044 §Publication and crash recovery).
// ---------------------------------------------------------------------------

pub enum BlobAcquisition {
    /// A live blob with this identity existed; its reference count was
    /// incremented in this transaction.
    Adopted { blob_id: String },
    /// No live blob with this identity exists (absent, or condemned — a
    /// condemned blob is never reusable).
    Absent,
}

/// Dedup reuse acquires its reference in the same transaction that checks GC
/// eligibility: the condemned fence and the increment are one statement, so
/// reuse can never race deletion.
pub fn acquire_blob_reference(
    tx: &Transaction<'_>,
    app_id: &str,
    digest_algorithm: &str,
    digest: &str,
    canonicalization_policy: &str,
    now_ms: u64,
) -> SnapbackResult<BlobAcquisition> {
    let blob_id: Option<String> = tx
        .query_row(
            "UPDATE _snapback_asset_blobs_v1
             SET reference_count = reference_count + 1, updated_at_ms = ?5
             WHERE app_id = ?1 AND digest_algorithm = ?2 AND digest = ?3
               AND canonicalization_policy = ?4 AND condemned = 0
             RETURNING blob_id",
            rusqlite::params![
                app_id,
                digest_algorithm,
                digest,
                canonicalization_policy,
                now_ms
            ],
            |row| row.get(0),
        )
        .optional()?;
    Ok(match blob_id {
        Some(blob_id) => BlobAcquisition::Adopted { blob_id },
        None => BlobAcquisition::Absent,
    })
}

pub enum BlobInsertOutcome {
    /// This transaction created the blob row with an initial reference.
    Created,
    /// A concurrent finalizer won the uniqueness race with a live blob; the
    /// caller adopted the winner (reference acquired here) and must condemn
    /// its own publication record and staged object.
    ConvergedOnWinner { blob_id: String },
}

pub fn insert_blob(
    tx: &Transaction<'_>,
    record: &AssetBlobRecordV1,
    now_ms: u64,
) -> SnapbackResult<BlobInsertOutcome> {
    let record_json = serde_json::to_string(record).map_err(|error| {
        SnapbackError::error(
            "SNAPBACK_ASSET_RECORD_INVALID",
            "assets",
            format!("blob record does not serialize: {error}"),
        )
    })?;
    let inserted = tx.execute(
        "INSERT OR IGNORE INTO _snapback_asset_blobs_v1 (
             blob_id, app_id, store, physical_key, digest_algorithm, digest,
             canonicalization_policy, byte_length, reference_count, condemned,
             record_json, updated_at_ms
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, 0, ?9, ?10)",
        rusqlite::params![
            record.blob_id,
            record.app_id,
            record.store,
            record.physical_key,
            record.digest_algorithm,
            record.digest,
            record.canonicalization_policy,
            record.byte_length,
            record_json,
            now_ms,
        ],
    )?;
    if inserted == 1 {
        return Ok(BlobInsertOutcome::Created);
    }
    match acquire_blob_reference(
        tx,
        &record.app_id,
        &record.digest_algorithm,
        &record.digest,
        &record.canonicalization_policy,
        now_ms,
    )? {
        BlobAcquisition::Adopted { blob_id } => {
            Ok(BlobInsertOutcome::ConvergedOnWinner { blob_id })
        }
        // The identity row exists but is condemned: the caller keeps its own
        // publication as a fresh blob under a new physical key. Surfaced as a
        // structured refusal for now; the finalizer ticket owns the retry.
        BlobAcquisition::Absent => Err(SnapbackError::error(
            "SNAPBACK_ASSET_BLOB_CONDEMNED_RACE",
            "assets",
            "blob identity exists but is condemned; retry publication under a fresh key",
        )),
    }
}

/// Returns the post-release reference count.
pub fn release_blob_reference(
    tx: &Transaction<'_>,
    blob_id: &str,
    now_ms: u64,
) -> SnapbackResult<u64> {
    let count: Option<u64> = tx
        .query_row(
            "UPDATE _snapback_asset_blobs_v1
             SET reference_count = reference_count - 1, updated_at_ms = ?2
             WHERE blob_id = ?1 AND reference_count > 0
             RETURNING reference_count",
            rusqlite::params![blob_id, now_ms],
            |row| row.get(0),
        )
        .optional()?;
    count.ok_or_else(|| {
        SnapbackError::error(
            "SNAPBACK_ASSET_REFCOUNT_INVALID",
            "assets",
            format!("blob {blob_id} has no reference to release"),
        )
    })
}

/// Blob GC marks a blob condemned transactionally before deleting bytes;
/// only an unreferenced, un-condemned blob is eligible. Returns whether this
/// transaction condemned it.
pub fn condemn_blob_if_unreferenced(
    tx: &Transaction<'_>,
    blob_id: &str,
    now_ms: u64,
) -> SnapbackResult<bool> {
    let changed = tx.execute(
        "UPDATE _snapback_asset_blobs_v1
         SET condemned = 1, updated_at_ms = ?2
         WHERE blob_id = ?1 AND reference_count = 0 AND condemned = 0",
        rusqlite::params![blob_id, now_ms],
    )?;
    Ok(changed == 1)
}

/// The condemned-race resolution: a condemned blob row still occupies its
/// identity slot in the uniqueness constraint, so a finalizer that raced GC
/// deletes the row (in the same transaction as its own fresh insert) and
/// returns the orphaned physical key for tracked cleanup. The caller must
/// record a condemned publication for that key so a crash before file
/// deletion leaves a discoverable orphan, never a silent one.
pub fn resolve_condemned_identity(
    tx: &Transaction<'_>,
    app_id: &str,
    digest_algorithm: &str,
    digest: &str,
    canonicalization_policy: &str,
) -> SnapbackResult<Option<String>> {
    let physical_key: Option<String> = tx
        .query_row(
            "DELETE FROM _snapback_asset_blobs_v1
             WHERE app_id = ?1 AND digest_algorithm = ?2 AND digest = ?3
               AND canonicalization_policy = ?4 AND condemned = 1
               AND reference_count = 0
             RETURNING physical_key",
            rusqlite::params![app_id, digest_algorithm, digest, canonicalization_policy],
            |row| row.get(0),
        )
        .optional()?;
    Ok(physical_key)
}

pub fn load_blob(tx: &Transaction<'_>, blob_id: &str) -> SnapbackResult<Option<AssetBlobRecordV1>> {
    let json: Option<String> = tx
        .query_row(
            "SELECT record_json FROM _snapback_asset_blobs_v1 WHERE blob_id = ?1",
            [blob_id],
            |row| row.get(0),
        )
        .optional()?;
    json.map(|json| decode_record(&json)).transpose()
}

pub fn load_blob_live(
    tx: &Transaction<'_>,
    blob_id: &str,
) -> SnapbackResult<Option<AssetBlobLive>> {
    let row: Option<(String, u64, bool)> = tx
        .query_row(
            "SELECT record_json, reference_count, condemned
             FROM _snapback_asset_blobs_v1 WHERE blob_id = ?1",
            [blob_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;
    row.map(|(json, reference_count, condemned)| {
        Ok(AssetBlobLive {
            record: decode_record(&json)?,
            reference_count,
            condemned,
        })
    })
    .transpose()
}

// ---------------------------------------------------------------------------
// Renditions. Primary bytes are represented exclusively by the `primary`
// rendition record; one blob reference and one quota charge per rendition
// row, never more.
// ---------------------------------------------------------------------------

pub const ASSET_RENDITION_PRIMARY: &str = "primary";

pub fn insert_rendition(
    tx: &Transaction<'_>,
    record: &AssetRenditionRecordV1,
) -> SnapbackResult<()> {
    tx.execute(
        "INSERT INTO _snapback_asset_renditions_v1 (
             rendition_id, asset_id, variant_key, blob_id, state, record_json,
             updated_at_ms
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
            record.rendition_id,
            record.asset_id,
            record.variant_key,
            record.blob_id,
            state_str(record.state)?,
            record_json(record)?,
            record.updated_at_ms,
        ],
    )?;
    Ok(())
}

pub fn load_rendition(
    tx: &Connection,
    rendition_id: &str,
) -> SnapbackResult<Option<AssetRenditionRecordV1>> {
    let json: Option<String> = tx
        .query_row(
            "SELECT record_json FROM _snapback_asset_renditions_v1 WHERE rendition_id = ?1",
            [rendition_id],
            |row| row.get(0),
        )
        .optional()?;
    json.map(|json| decode_record(&json)).transpose()
}

/// The closed rendition transition table. `retired` is the deletion
/// cascade's terminal state; every live state reaches it.
pub fn rendition_transition_allowed(from: AssetRenditionState, to: AssetRenditionState) -> bool {
    use AssetRenditionState as R;
    matches!(
        (from, to),
        (R::Pending, R::Ready)
            | (R::Pending, R::Failed)
            | (R::Ready, R::Superseded)
            | (
                R::Pending | R::Ready | R::Failed | R::Superseded,
                R::Retired
            )
    )
}

pub fn store_rendition(
    tx: &Transaction<'_>,
    record: &AssetRenditionRecordV1,
) -> SnapbackResult<()> {
    let changed = tx.execute(
        "UPDATE _snapback_asset_renditions_v1
         SET state = ?2, record_json = ?3, updated_at_ms = ?4
         WHERE rendition_id = ?1",
        rusqlite::params![
            record.rendition_id,
            state_str(record.state)?,
            record_json(record)?,
            record.updated_at_ms,
        ],
    )?;
    if changed != 1 {
        return Err(SnapbackError::error(
            "SNAPBACK_ASSET_RECORD_INVALID",
            "assets",
            format!("rendition {} does not exist to update", record.rendition_id),
        ));
    }
    Ok(())
}

pub fn transition_rendition(
    tx: &Transaction<'_>,
    record: &mut AssetRenditionRecordV1,
    to: AssetRenditionState,
    now_ms: u64,
) -> SnapbackResult<()> {
    if !rendition_transition_allowed(record.state, to) {
        return Err(SnapbackError::error(
            "SNAPBACK_ASSET_TRANSITION_INVALID",
            "assets",
            format!("rendition state cannot move {:?} → {to:?}", record.state),
        ));
    }
    record.state = to;
    record.updated_at_ms = now_ms;
    store_rendition(tx, record)
}

pub fn renditions_for_asset(
    tx: &Transaction<'_>,
    asset_id: &str,
) -> SnapbackResult<Vec<AssetRenditionRecordV1>> {
    let mut stmt = tx.prepare(
        "SELECT record_json FROM _snapback_asset_renditions_v1
         WHERE asset_id = ?1 ORDER BY rendition_id",
    )?;
    let rows = stmt.query_map([asset_id], |row| row.get::<_, String>(0))?;
    rows.map(|json| decode_record(&json?))
        .collect::<SnapbackResult<Vec<_>>>()
}

/// Delivery resolves `(asset, variant)` aliases only; blob identity never
/// appears in a URL (LLP 0044 §Delivery profiles, URL identity).
/// How a produced rendition lands against the variant's current pointer.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AssetVariantSwitchOutcome {
    /// No current row (or a superseded lineage): the new rendition installed.
    Installed,
    /// A Ready row of the same recipe lineage/version already exists — the
    /// producing run is an idempotent re-drive; nothing switched.
    AlreadyCurrent,
    /// A newer recipe version holds the pointer; the stale run loses and
    /// must clean up its own publication.
    StaleLoses,
}

/// The atomic, generation-checked variant pointer switch (LLP 0044: a recipe
/// run creates an immutable rendition row, then switches the pointer; a
/// stale run may clean up its unreferenced blob but cannot replace a newer
/// rendition; regeneration supersedes only same-lineage outputs).
pub fn switch_variant_pointer(
    tx: &Transaction<'_>,
    candidate: &AssetRenditionRecordV1,
    now_ms: u64,
) -> SnapbackResult<AssetVariantSwitchOutcome> {
    let current = load_rendition_by_variant(tx, &candidate.asset_id, &candidate.variant_key)?;
    match current {
        None => {
            insert_rendition(tx, candidate)?;
            Ok(AssetVariantSwitchOutcome::Installed)
        }
        Some(existing) if existing.recipe_version > candidate.recipe_version => {
            Ok(AssetVariantSwitchOutcome::StaleLoses)
        }
        Some(existing)
            if existing.state == AssetRenditionState::Ready
                && existing.recipe == candidate.recipe
                && existing.recipe_version == candidate.recipe_version =>
        {
            Ok(AssetVariantSwitchOutcome::AlreadyCurrent)
        }
        Some(mut existing) => {
            // A Ready lower-version row supersedes; a Pending row here is a
            // crash artifact of an interrupted producer — it fails (its
            // closed set has no Pending → Superseded) and the fresh row
            // installs.
            let out = if existing.state == AssetRenditionState::Ready {
                AssetRenditionState::Superseded
            } else {
                AssetRenditionState::Failed
            };
            transition_rendition(tx, &mut existing, out, now_ms)?;
            insert_rendition(tx, candidate)?;
            Ok(AssetVariantSwitchOutcome::Installed)
        }
    }
}

/// Every Ready rendition for an asset — the best-variant selection input.
pub fn load_ready_renditions(
    tx: &Transaction<'_>,
    asset_id: &str,
) -> SnapbackResult<Vec<AssetRenditionRecordV1>> {
    let mut statement = tx.prepare(
        "SELECT record_json FROM _snapback_asset_renditions_v1
         WHERE asset_id = ?1 AND state = 'ready'
         ORDER BY variant_key, rendition_id",
    )?;
    let rows = statement
        .query_map([asset_id], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    rows.iter().map(|json| decode_record(json)).collect()
}

pub fn load_rendition_by_variant(
    tx: &Transaction<'_>,
    asset_id: &str,
    variant_key: &str,
) -> SnapbackResult<Option<AssetRenditionRecordV1>> {
    let json: Option<String> = tx
        .query_row(
            "SELECT record_json FROM _snapback_asset_renditions_v1
             WHERE asset_id = ?1 AND variant_key = ?2
               AND state IN ('pending', 'ready')",
            rusqlite::params![asset_id, variant_key],
            |row| row.get(0),
        )
        .optional()?;
    json.map(|json| decode_record(&json)).transpose()
}

// ---------------------------------------------------------------------------
// Strict delivery header rules (LLP 0044 §Delivery profiles).
// ---------------------------------------------------------------------------

/// Content types with active-content risk are never served inline under any
/// profile in v1 — a stored SVG must not become a same-origin script lane.
/// Unrecognized bytes (`application/octet-stream`) also force attachment:
/// trusted detection could not name them, so no browser should be invited
/// to sniff and render them either (delivery adds `nosniff` besides).
pub fn forces_attachment_disposition(content_type: &str) -> bool {
    let essence = content_type
        .split(';')
        .next()
        .unwrap_or(content_type)
        .trim()
        .to_ascii_lowercase();
    matches!(
        essence.as_str(),
        "image/svg+xml"
            | "text/html"
            | "application/xhtml+xml"
            | "text/xml"
            | "application/xml"
            | "text/javascript"
            | "application/javascript"
            | "application/octet-stream"
    )
}

// ---------------------------------------------------------------------------
// Signed-URL custody and token format (LLP 0044 §Delivery profiles,
// `private-signed`). The signing key is instance-owned system material in
// the instance's system store; rotation retires every prior key, and a
// retired key validates nothing, so rotation invalidates outstanding URLs
// by construction. Key ids and material never appear in receipts,
// diagnostics, or host-ops output.
// ---------------------------------------------------------------------------

pub const ASSET_SIGNED_URL_DEFAULT_TTL_MS: u64 = 15 * 60 * 1000;
pub const ASSET_SIGNED_URL_MAX_TTL_MS: u64 = 24 * 60 * 60 * 1000;
const ASSET_SIGNED_URL_INPUT_FORMAT: &str = "snapback.asset-signed-url.v1";
const ASSET_SIGNING_KEY_BYTES: usize = 32;

pub struct AssetSigningKey {
    pub key_id: String,
    material: Vec<u8>,
}

fn decode_signing_material(encoded: &str) -> SnapbackResult<Vec<u8>> {
    use base64::Engine as _;
    base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(encoded)
        .map_err(|_| {
            SnapbackError::error(
                "SNAPBACK_ASSET_STORE_UNAVAILABLE",
                "assets",
                "signing-key material is unreadable",
            )
        })
}

/// Newest non-retired key, minting the first one on demand.
pub fn active_signing_key(tx: &Transaction<'_>, now_ms: u64) -> SnapbackResult<AssetSigningKey> {
    let existing: Option<(String, String)> = tx
        .query_row(
            "SELECT key_id, material FROM _snapback_asset_signing_keys_v1
             WHERE retired_at_ms IS NULL ORDER BY created_at_ms DESC LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    if let Some((key_id, material)) = existing {
        return Ok(AssetSigningKey {
            key_id,
            material: decode_signing_material(&material)?,
        });
    }
    mint_signing_key(tx, now_ms)
}

fn mint_signing_key(tx: &Transaction<'_>, now_ms: u64) -> SnapbackResult<AssetSigningKey> {
    use base64::Engine as _;
    let mut material = vec![0u8; ASSET_SIGNING_KEY_BYTES];
    getrandom::fill(&mut material).map_err(|_| {
        SnapbackError::error(
            "SNAPBACK_ASSET_STORE_UNAVAILABLE",
            "assets",
            "no randomness source for signing-key material",
        )
    })?;
    let key_id = Uuid::now_v7().to_string();
    tx.execute(
        "INSERT INTO _snapback_asset_signing_keys_v1 (key_id, material, created_at_ms, retired_at_ms)
         VALUES (?1, ?2, ?3, NULL)",
        rusqlite::params![
            key_id,
            base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(&material),
            now_ms
        ],
    )?;
    Ok(AssetSigningKey { key_id, material })
}

/// Rotation: retire every active key and mint a fresh one. An operator
/// action, not per-principal revocation (LLP 0044).
pub fn rotate_signing_key(tx: &Transaction<'_>, now_ms: u64) -> SnapbackResult<AssetSigningKey> {
    tx.execute(
        "UPDATE _snapback_asset_signing_keys_v1 SET retired_at_ms = ?1 WHERE retired_at_ms IS NULL",
        [now_ms],
    )?;
    mint_signing_key(tx, now_ms)
}

fn load_live_signing_key(tx: &Transaction<'_>, key_id: &str) -> SnapbackResult<Option<Vec<u8>>> {
    let material: Option<String> = tx
        .query_row(
            "SELECT material FROM _snapback_asset_signing_keys_v1
             WHERE key_id = ?1 AND retired_at_ms IS NULL",
            [key_id],
            |row| row.get(0),
        )
        .optional()?;
    material.map(|m| decode_signing_material(&m)).transpose()
}

fn signed_url_input(
    asset_id: &str,
    variant: &str,
    grantee: &str,
    lifecycle_generation: u64,
    expires_at_ms: u64,
) -> String {
    format!(
        "{ASSET_SIGNED_URL_INPUT_FORMAT}\n{asset_id}\n{variant}\n{grantee}\n{lifecycle_generation}\n{expires_at_ms}"
    )
}

fn signed_url_hmac(material: &[u8], input: &str) -> String {
    use base64::Engine as _;
    use hmac::Mac as _;
    let mut mac =
        hmac::Hmac::<sha2::Sha256>::new_from_slice(material).expect("hmac accepts any key length");
    mac.update(input.as_bytes());
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes())
}

/// The frozen bearer-token format:
/// `v1.<keyId>.<expiresAtMs>.<granteeB64url>.<sigB64url>`, where the
/// signature is HMAC-SHA256 over the alias, grantee authorization basis,
/// lifecycle generation, and expiry — never a blob path. The generation is
/// deliberately not carried: validation recomputes against the asset's
/// *current* lifecycle generation, so deletion or replacement invalidates
/// at the origin (the target-specific stronger mechanism 0044 permits).
pub fn mint_signed_url_token(
    key: &AssetSigningKey,
    asset_id: &str,
    variant: &str,
    grantee: &str,
    lifecycle_generation: u64,
    expires_at_ms: u64,
) -> String {
    use base64::Engine as _;
    let sig = signed_url_hmac(
        &key.material,
        &signed_url_input(
            asset_id,
            variant,
            grantee,
            lifecycle_generation,
            expires_at_ms,
        ),
    );
    let grantee_b64 = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(grantee.as_bytes());
    format!("v1.{}.{expires_at_ms}.{grantee_b64}.{sig}", key.key_id)
}

pub enum SignedTokenOutcome {
    Valid,
    Expired,
    /// Bad shape, unknown/rotated key, or signature mismatch (including a
    /// lifecycle-generation move since issuance). One refusal class: a
    /// bearer probe learns nothing about which part failed.
    Invalid,
}

pub fn validate_signed_url_token(
    tx: &Transaction<'_>,
    token: &str,
    asset_id: &str,
    variant: &str,
    lifecycle_generation: u64,
    now_ms: u64,
) -> SnapbackResult<SignedTokenOutcome> {
    use base64::Engine as _;
    let mut parts = token.splitn(5, '.');
    let (Some("v1"), Some(key_id), Some(expires), Some(grantee_b64), Some(sig)) = (
        parts.next(),
        parts.next(),
        parts.next(),
        parts.next(),
        parts.next(),
    ) else {
        return Ok(SignedTokenOutcome::Invalid);
    };
    let Ok(expires_at_ms) = expires.parse::<u64>() else {
        return Ok(SignedTokenOutcome::Invalid);
    };
    let Ok(grantee_bytes) = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(grantee_b64)
    else {
        return Ok(SignedTokenOutcome::Invalid);
    };
    let Ok(grantee) = String::from_utf8(grantee_bytes) else {
        return Ok(SignedTokenOutcome::Invalid);
    };
    let Some(material) = load_live_signing_key(tx, key_id)? else {
        return Ok(SignedTokenOutcome::Invalid);
    };
    let expected = signed_url_hmac(
        &material,
        &signed_url_input(
            asset_id,
            variant,
            &grantee,
            lifecycle_generation,
            expires_at_ms,
        ),
    );
    // Constant-time comparison of equal-length base64 strings.
    let matches = expected.len() == sig.len()
        && expected
            .bytes()
            .zip(sig.bytes())
            .fold(0u8, |acc, (a, b)| acc | (a ^ b))
            == 0;
    if !matches {
        return Ok(SignedTokenOutcome::Invalid);
    }
    if now_ms >= expires_at_ms {
        return Ok(SignedTokenOutcome::Expired);
    }
    Ok(SignedTokenOutcome::Valid)
}

/// The original filename is metadata only, sanitized before it can appear in
/// a `Content-Disposition` parameter; it is never a physical key.
pub fn sanitize_filename(declared: Option<&str>) -> String {
    let cleaned: String = declared
        .unwrap_or("")
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | ' ') {
                c
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches([' ', '.']).to_owned();
    if trimmed.is_empty() {
        return "download".to_owned();
    }
    trimmed.chars().take(128).collect()
}

/// One parsed `Range` outcome. Multi-range and non-byte units are ignored
/// (RFC 9110 permits serving the full representation); a syntactically valid
/// but unsatisfiable range is 416. `If-Range` is not implemented in v1 —
/// renditions are immutable, so a stale validator cannot observe torn bytes.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ByteRangeOutcome {
    Full,
    /// Inclusive byte window.
    Partial {
        start: u64,
        end: u64,
    },
    Unsatisfiable,
}

pub fn parse_byte_range(header: Option<&str>, total_length: u64) -> ByteRangeOutcome {
    let Some(header) = header else {
        return ByteRangeOutcome::Full;
    };
    let Some(spec) = header.trim().strip_prefix("bytes=") else {
        return ByteRangeOutcome::Full;
    };
    if spec.contains(',') {
        return ByteRangeOutcome::Full;
    }
    let Some((raw_start, raw_end)) = spec.split_once('-') else {
        return ByteRangeOutcome::Full;
    };
    let (raw_start, raw_end) = (raw_start.trim(), raw_end.trim());
    if raw_start.is_empty() {
        // Suffix range: the final N bytes.
        let Ok(suffix) = raw_end.parse::<u64>() else {
            return ByteRangeOutcome::Full;
        };
        if suffix == 0 || total_length == 0 {
            return ByteRangeOutcome::Unsatisfiable;
        }
        let start = total_length.saturating_sub(suffix);
        return ByteRangeOutcome::Partial {
            start,
            end: total_length - 1,
        };
    }
    let Ok(start) = raw_start.parse::<u64>() else {
        return ByteRangeOutcome::Full;
    };
    if start >= total_length {
        return ByteRangeOutcome::Unsatisfiable;
    }
    if raw_end.is_empty() {
        return ByteRangeOutcome::Partial {
            start,
            end: total_length - 1,
        };
    }
    let Ok(end) = raw_end.parse::<u64>() else {
        return ByteRangeOutcome::Full;
    };
    if end < start {
        return ByteRangeOutcome::Unsatisfiable;
    }
    ByteRangeOutcome::Partial {
        start,
        end: end.min(total_length - 1),
    }
}

// ---------------------------------------------------------------------------
// GC query helpers (LLP 0044 §Deletion, retention, and garbage collection).
// The sweeps themselves live on `LocalSnapback`; these keep the SQL beside
// the tables.
// ---------------------------------------------------------------------------

pub fn expired_current_attempts(
    tx: &Transaction<'_>,
    now_ms: u64,
) -> SnapbackResult<Vec<AssetAttemptRecordV1>> {
    let mut stmt = tx.prepare(
        "SELECT record_json FROM _snapback_asset_attempts_v1
         WHERE state IN ('open', 'transferring', 'finalizing')
           AND expires_at_ms < ?1",
    )?;
    let rows = stmt.query_map([now_ms], |row| row.get::<_, String>(0))?;
    rows.map(|json| decode_record(&json?))
        .collect::<SnapbackResult<Vec<_>>>()
}

/// Staging keys still owned by a live (current) attempt — every other file
/// in the staging namespace is an orphan the sweep may remove.
pub fn live_staging_keys(tx: &Transaction<'_>) -> SnapbackResult<Vec<String>> {
    let mut stmt = tx.prepare(
        "SELECT staging_key FROM _snapback_asset_attempts_v1
         WHERE state IN ('open', 'transferring', 'finalizing')",
    )?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// Unreferenced pending/rejected assets whose grace period has passed and
/// that have no live attempt. Referenced failures stay visible for repair.
pub fn reclaimable_pending_assets(
    tx: &Transaction<'_>,
    cutoff_ms: u64,
) -> SnapbackResult<Vec<AssetRecordV1>> {
    let mut stmt = tx.prepare(
        "SELECT a.record_json FROM _snapback_asset_records_v1 a
         WHERE a.availability IN ('pending', 'rejected')
           AND a.updated_at_ms < ?1
           AND NOT EXISTS (
               SELECT 1 FROM _snapback_asset_reference_edges_v1 e
               WHERE e.asset_id = a.asset_id)
           AND NOT EXISTS (
               SELECT 1 FROM _snapback_asset_attempts_v1 t
               WHERE t.asset_id = a.asset_id
                 AND t.state IN ('open', 'transferring', 'finalizing'))
           AND NOT EXISTS (
               SELECT 1 FROM _snapback_asset_grants_v1 g
               WHERE g.asset_id = a.asset_id AND g.state = 'active')",
    )?;
    let rows = stmt.query_map([cutoff_ms], |row| row.get::<_, String>(0))?;
    rows.map(|json| decode_record(&json?))
        .collect::<SnapbackResult<Vec<_>>>()
}

/// Deleted-asset tombstones past retention with no remaining edges; the
/// sweep purges these rows (and their retired renditions) outright.
pub fn purgeable_tombstones(tx: &Transaction<'_>, cutoff_ms: u64) -> SnapbackResult<Vec<String>> {
    let mut stmt = tx.prepare(
        "SELECT a.asset_id FROM _snapback_asset_records_v1 a
         WHERE a.availability = 'deleted'
           AND a.updated_at_ms < ?1
           AND NOT EXISTS (
               SELECT 1 FROM _snapback_asset_reference_edges_v1 e
               WHERE e.asset_id = a.asset_id)",
    )?;
    let rows = stmt.query_map([cutoff_ms], |row| row.get::<_, String>(0))?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn condemnable_blobs(
    tx: &Transaction<'_>,
    cutoff_ms: u64,
) -> SnapbackResult<Vec<AssetBlobRecordV1>> {
    let mut stmt = tx.prepare(
        "SELECT record_json FROM _snapback_asset_blobs_v1
         WHERE reference_count = 0 AND condemned = 0 AND updated_at_ms < ?1",
    )?;
    let rows = stmt.query_map([cutoff_ms], |row| row.get::<_, String>(0))?;
    rows.map(|json| decode_record(&json?))
        .collect::<SnapbackResult<Vec<_>>>()
}

pub fn condemned_blobs(tx: &Transaction<'_>) -> SnapbackResult<Vec<AssetBlobRecordV1>> {
    let mut stmt =
        tx.prepare("SELECT record_json FROM _snapback_asset_blobs_v1 WHERE condemned = 1")?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    rows.map(|json| decode_record(&json?))
        .collect::<SnapbackResult<Vec<_>>>()
}

pub fn delete_blob_row(tx: &Transaction<'_>, blob_id: &str) -> SnapbackResult<()> {
    tx.execute(
        "DELETE FROM _snapback_asset_blobs_v1 WHERE blob_id = ?1 AND condemned = 1",
        [blob_id],
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Publication records (LLP 0044 §Publication and crash recovery).
// ---------------------------------------------------------------------------

/// The closed publication transition table:
/// `planned → staged | condemned`, `staged → committed | condemned`.
pub fn publication_transition_allowed(
    from: AssetPublicationState,
    to: AssetPublicationState,
) -> bool {
    use AssetPublicationState as P;
    matches!(
        (from, to),
        (P::Planned, P::Staged)
            | (P::Planned, P::Condemned)
            | (P::Staged, P::Committed)
            | (P::Staged, P::Condemned)
    )
}

pub fn insert_publication(
    tx: &Transaction<'_>,
    record: &AssetPublicationRecordV1,
) -> SnapbackResult<()> {
    tx.execute(
        "INSERT INTO _snapback_asset_publications_v1 (
             publication_id, app_id, planned_key, state, record_json,
             updated_at_ms
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            record.publication_id,
            record.app_id,
            record.planned_key,
            state_str(record.state)?,
            record_json(record)?,
            record.updated_at_ms,
        ],
    )?;
    Ok(())
}

/// The re-drivable publication for an attempt, if any (`planned`/`staged`).
/// Re-driven finalization resumes from this record instead of minting a
/// second key for the same work.
pub fn open_publication_for_attempt(
    tx: &Transaction<'_>,
    attempt_id: &str,
) -> SnapbackResult<Option<AssetPublicationRecordV1>> {
    let json: Option<String> = tx
        .query_row(
            "SELECT record_json FROM _snapback_asset_publications_v1
             WHERE state IN ('planned', 'staged')
               AND json_extract(record_json, '$.attemptId') = ?1",
            [attempt_id],
            |row| row.get(0),
        )
        .optional()?;
    json.map(|json| decode_record(&json)).transpose()
}

pub fn publications_in_state(
    tx: &Transaction<'_>,
    state: AssetPublicationState,
) -> SnapbackResult<Vec<AssetPublicationRecordV1>> {
    let mut statement = tx.prepare(
        "SELECT record_json FROM _snapback_asset_publications_v1
         WHERE state = ?1 ORDER BY updated_at_ms",
    )?;
    let rows = statement
        .query_map([state_str(state)?], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    rows.iter().map(|json| decode_record(json)).collect()
}

pub fn transition_publication(
    tx: &Transaction<'_>,
    record: &mut AssetPublicationRecordV1,
    to: AssetPublicationState,
    now_ms: u64,
) -> SnapbackResult<()> {
    if !publication_transition_allowed(record.state, to) {
        return Err(SnapbackError::error(
            "SNAPBACK_ASSET_TRANSITION_INVALID",
            "assets",
            format!("publication cannot move {:?} → {to:?}", record.state),
        ));
    }
    record.state = to;
    record.updated_at_ms = now_ms;
    let changed = tx.execute(
        "UPDATE _snapback_asset_publications_v1
         SET state = ?2, record_json = ?3, updated_at_ms = ?4
         WHERE publication_id = ?1",
        rusqlite::params![
            record.publication_id,
            state_str(record.state)?,
            record_json(record)?,
            record.updated_at_ms,
        ],
    )?;
    if changed != 1 {
        return Err(SnapbackError::error(
            "SNAPBACK_ASSET_RECORD_INVALID",
            "assets",
            format!(
                "publication {} does not exist to update",
                record.publication_id
            ),
        ));
    }
    Ok(())
}

/// Retirement deletes the row — the blob row (committed) or the deletion
/// receipt (condemned) is the durable evidence from then on. Receipted by
/// the caller.
pub fn retire_publication(tx: &Transaction<'_>, publication_id: &str) -> SnapbackResult<()> {
    tx.execute(
        "DELETE FROM _snapback_asset_publications_v1 WHERE publication_id = ?1",
        [publication_id],
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Asset-work ledger enqueue (LLP 0044 §Processing runner). Rows enqueue in
// the same transaction as the state transition that requires the work, so
// work is never lost between a transition and its enqueue. Claiming and
// driving belong to the runner ticket; this is the transactional seam.
// ---------------------------------------------------------------------------

pub const ASSET_WORK_RETRY_CEILING: u64 = 5;
pub const ASSET_WORK_DEADLINE_MS: u64 = 24 * 60 * 60 * 1000;

pub fn enqueue_work(
    tx: &Transaction<'_>,
    kind: &str,
    asset_id: &str,
    attempt_id: Option<&str>,
    lifecycle_generation: u64,
    now_ms: u64,
) -> SnapbackResult<String> {
    enqueue_work_with_params(
        tx,
        kind,
        asset_id,
        attempt_id,
        lifecycle_generation,
        now_ms,
        None,
    )
}

pub fn enqueue_work_with_params(
    tx: &Transaction<'_>,
    kind: &str,
    asset_id: &str,
    attempt_id: Option<&str>,
    lifecycle_generation: u64,
    now_ms: u64,
    params: Option<Value>,
) -> SnapbackResult<String> {
    let row = AssetWorkRowV1 {
        work_id: AssetFsStore::new_opaque_key(),
        kind: kind.to_owned(),
        asset_id: asset_id.to_owned(),
        attempt_id: attempt_id.map(str::to_owned),
        lifecycle_generation,
        state: AssetWorkState::Enqueued,
        attempt_count: 0,
        retry_ceiling: ASSET_WORK_RETRY_CEILING,
        lease_owner: None,
        lease_expires_at_ms: None,
        next_eligible_at_ms: now_ms,
        deadline_at_ms: now_ms + ASSET_WORK_DEADLINE_MS,
        created_at_ms: now_ms,
        updated_at_ms: now_ms,
        failure: None,
        params,
    };
    tx.execute(
        "INSERT INTO _snapback_asset_work_ledger_v1 (
             work_id, kind, asset_id, state, next_eligible_at_ms, record_json,
             updated_at_ms
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
            row.work_id,
            row.kind,
            row.asset_id,
            state_str(row.state)?,
            row.next_eligible_at_ms,
            record_json(&row)?,
            row.updated_at_ms,
        ],
    )?;
    Ok(row.work_id)
}

/// The declared image-processing facts (LLP 0044 §Declarative processing;
/// the `asset-image-finalization` fact carried by the pipeline composite).
/// Every ceiling here is `Enforced` on the declaring target — the values are
/// single-sourced from `assets_image::ASSET_IMAGE_CEILINGS_LOCAL_V1`.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetImageFactsV1 {
    pub capability_ids: Vec<String>,
    pub placeholder_algorithm: String,
    pub formats: Vec<String>,
    pub max_pixels: u64,
    pub max_dimension: u32,
    pub max_decompression_ratio: u64,
    pub ratio_floor_bytes: u64,
    pub max_metadata_bytes: u64,
    pub step_time_budget_ms: u64,
    pub max_output_bytes: u64,
    /// The bounded on-demand width ladder (LLP 0044 §Ceremony floor,
    /// 2026-08-01): `?width=N` normalizes up this ladder and materializes
    /// once through the ordinary rendition machinery.
    pub on_demand_width_ladder: Vec<u64>,
    pub on_demand_max_width_px: u64,
}

impl AssetImageFactsV1 {
    pub fn local_v1() -> Self {
        let ceilings = crate::assets_image::ASSET_IMAGE_CEILINGS_LOCAL_V1;
        Self {
            capability_ids: vec![
                "asset_image_finalization_v1".to_owned(),
                "asset_image_pipeline_v1".to_owned(),
            ],
            placeholder_algorithm: crate::assets_image::ASSET_PLACEHOLDER_ALGO_THUMBHASH_V1
                .to_owned(),
            formats: vec!["image/jpeg".to_owned(), "image/png".to_owned()],
            max_pixels: ceilings.max_pixels,
            max_dimension: ceilings.max_dimension,
            max_decompression_ratio: ceilings.max_decompression_ratio,
            ratio_floor_bytes: ceilings.ratio_floor_bytes,
            max_metadata_bytes: ceilings.max_metadata_bytes,
            step_time_budget_ms: ceilings.step_time_budget_ms,
            max_output_bytes: ceilings.max_output_bytes,
            on_demand_width_ladder: ASSET_ON_DEMAND_WIDTH_LADDER.to_vec(),
            on_demand_max_width_px: ASSET_ON_DEMAND_MAX_WIDTH_PX,
        }
    }
}

/// The declared video-processing facts (LLP 0044 §Generated upload intents:
/// the `asset-video-finalization` fact). Strip is box-structure surgery,
/// never transcoding; every ceiling is `Enforced`, single-sourced from
/// `assets_video::ASSET_VIDEO_CEILINGS_LOCAL_V1`.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetVideoFactsV1 {
    pub capability_ids: Vec<String>,
    pub formats: Vec<String>,
    /// Container brands the strip rewrite classifies; other brands refuse
    /// under strip rather than passing unclassified metadata through.
    pub container_brands: Vec<String>,
    pub max_box_depth: u32,
    pub max_box_count: u64,
    pub max_metadata_bytes: u64,
    pub step_time_budget_ms: u64,
    pub max_parse_bytes: u64,
}

impl AssetVideoFactsV1 {
    pub fn local_v1() -> Self {
        let ceilings = crate::assets_video::ASSET_VIDEO_CEILINGS_LOCAL_V1;
        Self {
            capability_ids: vec!["asset_video_finalization_v1".to_owned()],
            formats: vec!["video/mp4".to_owned(), "video/quicktime".to_owned()],
            container_brands: vec![
                "isom".to_owned(),
                "iso2".to_owned(),
                "mp41".to_owned(),
                "mp42".to_owned(),
                "avc1".to_owned(),
                "qt".to_owned(),
            ],
            max_box_depth: ceilings.max_box_depth,
            max_box_count: ceilings.max_box_count,
            max_metadata_bytes: ceilings.max_metadata_bytes,
            step_time_budget_ms: ceilings.step_time_budget_ms,
            max_parse_bytes: ceilings.max_parse_bytes,
        }
    }
}

/// The declared asset target facts (LLP 0044 §Capability facts; LLP 0012
/// dated registration 2026-07-31). The lifecycle claim is store-parameterized
/// — `lifecycle_stores` is part of the claim, and the v1 nonclaims are
/// reported Missing here, never omitted.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetTargetFactsV1 {
    pub capability_id: String,
    pub lifecycle_stores: Vec<String>,
    pub delivery_profiles: Vec<String>,
    pub integrity_grades: Vec<String>,
    pub resumable_lane: String,
    pub digest_algorithm: String,
    /// Per-file byte bounds are intent-declared facts, not a target
    /// ceiling; the transfer chunk bound is the target's.
    pub max_chunk_bytes: u64,
    pub app_logical_quota_bytes: u64,
    pub min_accounting_unit_bytes: u64,
    pub attempt_ttl_ms: u64,
    pub max_open_attempts_per_app: u64,
    pub max_open_attempts_per_principal: u64,
    /// Defaults for backward parsing of pre-grant capability manifests; new
    /// local manifests always emit the enforced ceiling explicitly.
    #[serde(default = "default_asset_max_grants_per_app")]
    pub max_grants_per_app: u64,
    pub pending_grace_ms: u64,
    pub tombstone_retention_ms: u64,
    pub publication_retention_ms: u64,
    pub work_retry_ceiling: u64,
    pub work_lease_ms: u64,
    /// `private-signed` issuance TTLs: the default applied when a request
    /// names none, and the declared maximum a request may not exceed.
    pub signed_url_default_ttl_ms: u64,
    pub signed_url_max_ttl_ms: u64,
    /// The image-processing facts block; `None` is the honest Missing
    /// report for a target without `asset-image-finalization`.
    pub image: Option<AssetImageFactsV1>,
    /// The video-processing facts block; `None` is the honest Missing
    /// report for a target without `asset-video-finalization`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub video: Option<AssetVideoFactsV1>,
    /// Reference-tracked asset GC support (LLP 0044 §Deletion, opt-in):
    /// `None` is the honest Missing report; the bounds are Enforced —
    /// a schema-declared grace outside them refuses at generation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reference_gc: Option<AssetReferenceGcFactsV1>,
    /// Lifecycle-callback events the target can deliver (dev-lane only in
    /// v1; a sessions-mode schema refuses callback declarations at
    /// generation).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub lifecycle_callbacks: Vec<String>,
    /// Seed binary fixtures (LLP 0109 §17): idempotent
    /// `asset.ensureSeedFixture` ingestion plus placeholder resolution in
    /// the install transaction. `false` is the honest Missing report.
    #[serde(default)]
    pub seed_asset_fixtures: bool,
    /// Consistent-cut export/import (LLP 0044, dated design addition
    /// 2026-07-31): what this target proves. `None` is the honest Missing
    /// report.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub export: Option<AssetExportFactsV1>,
    /// Every listed limit above is `Enforced` on this target; a limit a
    /// target cannot enforce must move to this graded list instead of
    /// silently keeping the field.
    pub advisory_limits: Vec<String>,
    /// LLP 0044's explicit v1 nonclaims, reported Missing rather than
    /// omitted: the manifest never implies them.
    pub missing: Vec<String>,
}

impl AssetTargetFactsV1 {
    pub fn local_v1() -> Self {
        Self {
            capability_id: "asset_lifecycle_v1".to_owned(),
            // @ref LLP 0044#byte-stores-and-resumable-transfer — the
            //   s3-compatible dev-lane store earned its parameter through the
            //   live MinIO qualification drill (2026-08-03,
            //   `s3_store_live_endpoint_qualification`); each hosted provider
            //   (R2, Tigris, ...) still earns its own qualification fact.
            lifecycle_stores: vec![
                ASSET_STORE_LOCAL_FS.to_owned(),
                crate::assets_s3::ASSET_STORE_S3_COMPATIBLE.to_owned(),
            ],
            delivery_profiles: vec![
                "private-strict".to_owned(),
                "private-signed".to_owned(),
                "public-immutable".to_owned(),
            ],
            integrity_grades: vec![
                "end-to-end-verified".to_owned(),
                "received-bytes-canonical".to_owned(),
            ],
            resumable_lane: format!("tus-{ASSET_TUS_VERSION}"),
            digest_algorithm: ASSET_DIGEST_ALGORITHM_SHA256.to_owned(),
            max_chunk_bytes: ASSET_MAX_CHUNK_BYTES,
            app_logical_quota_bytes: ASSET_APP_LOGICAL_QUOTA_BYTES,
            min_accounting_unit_bytes: ASSET_MIN_ACCOUNTING_UNIT_BYTES,
            attempt_ttl_ms: ASSET_ATTEMPT_TTL_MS,
            max_open_attempts_per_app: ASSET_MAX_OPEN_ATTEMPTS_PER_APP,
            max_open_attempts_per_principal: ASSET_MAX_OPEN_ATTEMPTS_PER_PRINCIPAL,
            max_grants_per_app: ASSET_MAX_GRANTS_PER_APP,
            pending_grace_ms: ASSET_PENDING_GRACE_MS,
            tombstone_retention_ms: ASSET_TOMBSTONE_RETENTION_MS,
            publication_retention_ms: ASSET_PUBLICATION_RETENTION_MS,
            work_retry_ceiling: ASSET_WORK_RETRY_CEILING,
            work_lease_ms: ASSET_WORK_LEASE_MS,
            signed_url_default_ttl_ms: ASSET_SIGNED_URL_DEFAULT_TTL_MS,
            signed_url_max_ttl_ms: ASSET_SIGNED_URL_MAX_TTL_MS,
            image: Some(AssetImageFactsV1::local_v1()),
            video: Some(AssetVideoFactsV1::local_v1()),
            reference_gc: Some(AssetReferenceGcFactsV1 {
                capability_id: "asset_reference_gc_v1".to_owned(),
                grace_min_ms: ASSET_REFERENCE_GC_GRACE_MIN_MS,
                grace_max_ms: ASSET_REFERENCE_GC_GRACE_MAX_MS,
            }),
            lifecycle_callbacks: vec!["ready".to_owned(), "rejected".to_owned()],
            seed_asset_fixtures: true,
            export: Some(AssetExportFactsV1 {
                cut_export: true,
                import_validation: true,
                import_apply: "experimental".to_owned(),
            }),
            advisory_limits: Vec::new(),
            missing: vec![
                "asset-byte-backup".to_owned(),
                "asset-custom-read-authorizers".to_owned(),
                "asset-deferred-length".to_owned(),
            ],
        }
    }
}

/// Consistent-cut export/import facts: cut export and import validation are
/// implemented claims; `import_apply` stays `"experimental"` until the
/// restore epoch machinery graduates (the flag-gated posture). Byte-level
/// snapshot backup remains a `missing` entry — this block claims the
/// logical cut only.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetExportFactsV1 {
    pub cut_export: bool,
    pub import_validation: bool,
    pub import_apply: String,
}

/// The reference-GC facts block (LLP 0044 §Capability facts: the
/// `asset-reference-gc-v1` target support, distinct from the app's
/// schema-level opt-in that actually enables the sweep).
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetReferenceGcFactsV1 {
    pub capability_id: String,
    pub grace_min_ms: u64,
    pub grace_max_ms: u64,
}

pub const ASSET_WORK_KIND_CONDEMNED_CLEANUP: &str = "condemned-object-cleanup";
/// A declared lifecycle callback: the row invokes an ordinary generated
/// mutation with typed facts under the asset owner's authority — never raw
/// byte authority (LLP 0044 §Declarative processing).
pub const ASSET_WORK_KIND_LIFECYCLE_CALLBACK: &str = "lifecycle-callback";
/// Reference-GC grace bounds, Enforced facts on the declaring target: a
/// schema-declared grace outside them refuses at generation.
pub const ASSET_REFERENCE_GC_GRACE_MIN_MS: u64 = 60_000;
pub const ASSET_REFERENCE_GC_GRACE_MAX_MS: u64 = 30 * 24 * 60 * 60 * 1000;
/// The reserved seed-row value for a fixture-produced asset reference
/// (LLP 0109 §17): an object with exactly this one member, admissible only
/// on `v.assetRef` fields, resolved inside the install transaction.
pub const SEED_FIXTURE_PLACEHOLDER_KEY: &str = "$assetFixture";

#[derive(Clone, Debug)]
pub struct SeedFixtureMappingV1 {
    pub fixture_id: String,
    pub source_digest: String,
    pub asset_id: String,
    pub intent_id: String,
    pub updated_at_ms: u64,
}

pub fn seed_placeholder_fixture_id(value: &Value) -> Option<&str> {
    let object = value.as_object()?;
    if object.len() != 1 {
        return None;
    }
    object.get(SEED_FIXTURE_PLACEHOLDER_KEY)?.as_str()
}

pub fn lookup_seed_fixture(
    tx: &Transaction<'_>,
    fixture_id: &str,
) -> SnapbackResult<Option<SeedFixtureMappingV1>> {
    tx.query_row(
        "SELECT source_digest, asset_id, intent_id, updated_at_ms
         FROM _snapback_asset_seed_fixtures_v1 WHERE fixture_id = ?1",
        [fixture_id],
        |row| {
            Ok(SeedFixtureMappingV1 {
                fixture_id: fixture_id.to_owned(),
                source_digest: row.get(0)?,
                asset_id: row.get(1)?,
                intent_id: row.get(2)?,
                updated_at_ms: row.get::<_, i64>(3)? as u64,
            })
        },
    )
    .optional()
    .map_err(SnapbackError::from)
}

pub fn upsert_seed_fixture(
    tx: &Transaction<'_>,
    mapping: &SeedFixtureMappingV1,
) -> SnapbackResult<()> {
    tx.execute(
        "INSERT INTO _snapback_asset_seed_fixtures_v1
             (fixture_id, source_digest, asset_id, intent_id, updated_at_ms)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(fixture_id) DO UPDATE SET
             source_digest = excluded.source_digest,
             asset_id = excluded.asset_id,
             intent_id = excluded.intent_id,
             updated_at_ms = excluded.updated_at_ms",
        rusqlite::params![
            mapping.fixture_id,
            mapping.source_digest,
            mapping.asset_id,
            mapping.intent_id,
            mapping.updated_at_ms as i64,
        ],
    )?;
    Ok(())
}

/// Resolve `{"$assetFixture": id}` placeholders into asset ids inside the
/// install transaction (LLP 0109 §17). Refuse-whole semantics: any missing
/// fixture declaration, un-ingested or stale mapping, wrong placement, or
/// vanished asset refuses before a single row effect. Placeholders are
/// admissible only on `v.assetRef` fields, so a placeholder can never
/// silently become an ordinary string value.
pub fn resolve_seed_fixture_placeholders(
    tx: &Transaction<'_>,
    schema: &crate::manifest::SchemaManifest,
    tables: &std::collections::BTreeMap<String, Vec<serde_json::Map<String, Value>>>,
    fixtures: Option<&crate::seed_identity::SeedAssetFixturesV1>,
) -> SnapbackResult<crate::manifest::SeedData> {
    let mut resolved = std::collections::BTreeMap::new();
    for (table_name, rows) in tables {
        let mut resolved_rows = Vec::with_capacity(rows.len());
        for row in rows {
            let mut resolved_row = row.clone();
            for (field_name, value) in row {
                let Some(fixture_id) = seed_placeholder_fixture_id(value) else {
                    continue;
                };
                let is_asset_ref = schema.table(table_name).is_some_and(|table| {
                    table.fields.iter().any(|field| {
                        field.name == *field_name
                            && matches!(
                                field.field_type,
                                crate::manifest::FieldType::AssetRef { .. }
                            )
                    })
                });
                if !is_asset_ref {
                    return Err(SnapbackError::error(
                        "SNAPBACK_SEED_ASSET_FIXTURE_PLACEMENT_INVALID",
                        "seed",
                        format!(
                            "{table_name}.{field_name} carries an $assetFixture placeholder but is not a v.assetRef field"
                        ),
                    ));
                }
                let Some(fixtures) = fixtures else {
                    return Err(SnapbackError::error(
                        "SNAPBACK_SEED_ASSET_FIXTURE_UNRESOLVED",
                        "seed",
                        "seed rows reference asset fixtures but no fixtures artifact is attached; resetInstall and legacy seed paths do not carry placeholders",
                    ));
                };
                let Some(declared) = fixtures.fixture(fixture_id) else {
                    return Err(SnapbackError::error(
                        "SNAPBACK_SEED_ASSET_FIXTURE_UNKNOWN",
                        "seed",
                        format!("seed references undeclared asset fixture {fixture_id}"),
                    ));
                };
                let mapping = lookup_seed_fixture(tx, fixture_id)?;
                let mapping = match mapping {
                    Some(mapping) if mapping.source_digest == declared.source_digest => mapping,
                    _ => {
                        return Err(SnapbackError::error(
                            "SNAPBACK_SEED_ASSET_FIXTURE_NOT_INGESTED",
                            "seed",
                            format!(
                                "asset fixture {fixture_id} is not ingested at its declared sourceDigest; run asset.ensureSeedFixture first"
                            ),
                        ));
                    }
                };
                let asset = load_asset(tx, &mapping.asset_id)?;
                if !asset.is_some_and(|asset| asset.availability != AssetAvailability::Deleted) {
                    return Err(SnapbackError::error(
                        "SNAPBACK_SEED_ASSET_FIXTURE_NOT_INGESTED",
                        "seed",
                        format!(
                            "asset fixture {fixture_id} maps to a missing or deleted asset; re-run asset.ensureSeedFixture"
                        ),
                    ));
                }
                resolved_row.insert(field_name.clone(), Value::String(mapping.asset_id.clone()));
            }
            resolved_rows.push(resolved_row);
        }
        resolved.insert(table_name.clone(), resolved_rows);
    }
    Ok(crate::manifest::SeedData { tables: resolved })
}

/// Optional declared image renditions produced off the canonical bytes by
/// the runner; required ones ride finalization itself (LLP 0044 §step 8).
pub const ASSET_WORK_KIND_IMAGE_VARIANT: &str = "image-variant";
pub const ASSET_RECIPE_IMAGE_VARIANT_V1: &str = "image-variant.v1";
#[cfg(test)]
pub const ASSET_WORK_KIND_TEST_TRANSIENT_FAILURE: &str = "test-transient-failure";
pub const ASSET_WORK_LEASE_MS: u64 = 60_000;
pub const ASSET_WORK_BACKOFF_BASE_MS: u64 = 5_000;
pub const ASSET_WORK_BACKOFF_CAP_MS: u64 = 10 * 60 * 1000;
pub const ASSET_WORK_CLAIM_BATCH: usize = 16;

/// @ref LLP 0044#processing-runner-and-idempotency — the closed ledger
/// transition set. `Claimed → Enqueued` is lease expiry (an explicit,
/// receipted transition); `Retrying` is transient and re-enters `Enqueued`
/// in the same transaction with the incremented attempt count.
pub fn work_transition_allowed(from: AssetWorkState, to: AssetWorkState) -> bool {
    use AssetWorkState as S;
    matches!(
        (from, to),
        (S::Enqueued, S::Claimed)
            | (S::Enqueued, S::Cancelled)
            | (S::Claimed, S::Done)
            | (S::Claimed, S::Retrying)
            | (S::Claimed, S::Exhausted)
            | (S::Claimed, S::Ambiguous)
            | (S::Claimed, S::Cancelled)
            | (S::Claimed, S::Enqueued)
            | (S::Retrying, S::Enqueued)
    )
}

pub fn work_backoff_ms(attempt_count: u64) -> u64 {
    let doublings = attempt_count.min(8) as u32;
    (ASSET_WORK_BACKOFF_BASE_MS << doublings).min(ASSET_WORK_BACKOFF_CAP_MS)
}

pub fn transition_work(
    tx: &Transaction<'_>,
    row: &mut AssetWorkRowV1,
    to: AssetWorkState,
    now_ms: u64,
) -> SnapbackResult<()> {
    if !work_transition_allowed(row.state, to) {
        return Err(SnapbackError::error(
            "SNAPBACK_ASSET_WORK_TRANSITION_INVALID",
            "assets",
            format!(
                "asset work transition {:?} -> {:?} is not in the closed set",
                row.state, to
            ),
        ));
    }
    row.state = to;
    row.updated_at_ms = now_ms;
    update_work_row(tx, row)
}

/// Claimed rows keep `next_eligible_at_ms` equal to their lease expiry, so
/// the one `(state, next_eligible_at_ms)` index serves both the due scan and
/// the expired-lease scan.
pub fn update_work_row(tx: &Transaction<'_>, row: &AssetWorkRowV1) -> SnapbackResult<()> {
    let updated = tx.execute(
        "UPDATE _snapback_asset_work_ledger_v1
         SET state = ?2, next_eligible_at_ms = ?3, record_json = ?4,
             updated_at_ms = ?5
         WHERE work_id = ?1",
        rusqlite::params![
            row.work_id,
            state_str(row.state)?,
            row.next_eligible_at_ms,
            record_json(row)?,
            row.updated_at_ms,
        ],
    )?;
    if updated != 1 {
        return Err(SnapbackError::error(
            "SNAPBACK_ASSET_WORK_UNKNOWN",
            "assets",
            format!("unknown asset work row {}", row.work_id),
        ));
    }
    Ok(())
}

pub fn load_work_row(
    tx: &Transaction<'_>,
    work_id: &str,
) -> SnapbackResult<Option<AssetWorkRowV1>> {
    let mut statement =
        tx.prepare("SELECT record_json FROM _snapback_asset_work_ledger_v1 WHERE work_id = ?1")?;
    let mut rows = statement.query([work_id])?;
    match rows.next()? {
        Some(row) => {
            let json: String = row.get(0)?;
            Ok(Some(decode_record(&json)?))
        }
        None => Ok(None),
    }
}

fn work_rows_in_state(
    tx: &Transaction<'_>,
    state: AssetWorkState,
    eligible_before_ms: u64,
    limit: usize,
) -> SnapbackResult<Vec<AssetWorkRowV1>> {
    let mut statement = tx.prepare(
        "SELECT record_json FROM _snapback_asset_work_ledger_v1
         WHERE state = ?1 AND next_eligible_at_ms <= ?2
         ORDER BY next_eligible_at_ms ASC LIMIT ?3",
    )?;
    let rows = statement.query_map(
        rusqlite::params![state_str(state)?, eligible_before_ms, limit as i64],
        |row| row.get::<_, String>(0),
    )?;
    let mut parsed = Vec::new();
    for json in rows {
        parsed.push(decode_record(&json?)?);
    }
    Ok(parsed)
}

pub fn load_due_work(
    tx: &Transaction<'_>,
    now_ms: u64,
    limit: usize,
) -> SnapbackResult<Vec<AssetWorkRowV1>> {
    work_rows_in_state(tx, AssetWorkState::Enqueued, now_ms, limit)
}

/// Expired leases: claimed rows whose lease deadline (mirrored into
/// `next_eligible_at_ms` at claim time) has passed.
pub fn load_expired_leases(
    tx: &Transaction<'_>,
    now_ms: u64,
    limit: usize,
) -> SnapbackResult<Vec<AssetWorkRowV1>> {
    work_rows_in_state(tx, AssetWorkState::Claimed, now_ms.saturating_sub(1), limit)
}

fn state_str<T: Serialize>(state: T) -> SnapbackResult<String> {
    serde_json::to_value(state)
        .ok()
        .and_then(|value| value.as_str().map(str::to_owned))
        .ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_ASSET_RECORD_INVALID",
                "assets",
                "asset state does not serialize to a name-keyed string",
            )
        })
}

// ---------------------------------------------------------------------------
// Trusted content-type detection (LLP 0044 §Restricted staging and trusted
// finalization): the deliverable type comes from bytes, never from the
// client's declaration alone. Conservative magic-number set for the common
// types; anything unrecognized is application/octet-stream.
// ---------------------------------------------------------------------------

pub fn detect_content_type(head: &[u8]) -> &'static str {
    if head.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return "image/jpeg";
    }
    if head.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        return "image/png";
    }
    if head.starts_with(b"GIF87a") || head.starts_with(b"GIF89a") {
        return "image/gif";
    }
    if head.len() >= 12 && head.starts_with(b"RIFF") && &head[8..12] == b"WEBP" {
        return "image/webp";
    }
    if head.starts_with(b"%PDF") {
        return "application/pdf";
    }
    if head.len() >= 12 && &head[4..8] == b"ftyp" {
        // ISO base media (MP4/QuickTime family): distinguish by brand.
        return if &head[8..11] == b"qt " || &head[8..12] == b"qt  " {
            "video/quicktime"
        } else {
            "video/mp4"
        };
    }
    if head.starts_with(&[0x1F, 0x8B]) {
        return "application/gzip";
    }
    if head.starts_with(b"PK\x03\x04") {
        return "application/zip";
    }
    "application/octet-stream"
}

/// The committed-schema registrations for this module, consumed by
/// `schema_export::artifact_schemas`.
pub fn schema_registrations() -> Vec<(&'static str, Value)> {
    fn schema_of<T: schemars::JsonSchema>() -> Value {
        serde_json::to_value(schemars::schema_for!(T)).expect("schema serializes")
    }
    vec![
        (
            "asset.upload-reference.schema.json",
            schema_of::<AssetUploadReference>(),
        ),
        (
            "asset.task-state.schema.json",
            schema_of::<AssetTaskStateV1>(),
        ),
        (
            "asset.attempt-create-request.schema.json",
            schema_of::<AssetAttemptCreateRequestV1>(),
        ),
        (
            "asset.attempt-create-response.schema.json",
            schema_of::<AssetAttemptCreateResponseV1>(),
        ),
        (
            "asset.attempt-cancel-request.schema.json",
            schema_of::<AssetAttemptCancelRequestV1>(),
        ),
        (
            "asset.tus-instruction.schema.json",
            schema_of::<AssetTusInstructionV1>(),
        ),
        (
            "asset.s3-instruction.schema.json",
            schema_of::<AssetS3TransferInstructionV1>(),
        ),
        (
            "asset.finalize-request.schema.json",
            schema_of::<AssetFinalizeRequestV1>(),
        ),
        (
            "asset.finalize-response.schema.json",
            schema_of::<AssetFinalizeResponseV1>(),
        ),
        (
            "asset.signed-url-request.schema.json",
            schema_of::<AssetSignedUrlIssueRequestV1>(),
        ),
        (
            "asset.signed-url-response.schema.json",
            schema_of::<AssetSignedUrlIssueResponseV1>(),
        ),
        (
            "asset.lifecycle-message.schema.json",
            schema_of::<AssetLifecycleMessageV1>(),
        ),
        ("asset.receipt.schema.json", schema_of::<AssetReceiptV1>()),
        (
            "asset.refusal-detail.schema.json",
            schema_of::<AssetRefusalDetailV1>(),
        ),
        ("asset.record.schema.json", schema_of::<AssetRecordV1>()),
        (
            "asset.record-view.schema.json",
            schema_of::<AssetRecordClientViewV1>(),
        ),
        (
            "asset.attempt-record.schema.json",
            schema_of::<AssetAttemptRecordV1>(),
        ),
        (
            "asset.blob-record.schema.json",
            schema_of::<AssetBlobRecordV1>(),
        ),
        (
            "asset.rendition-record.schema.json",
            schema_of::<AssetRenditionRecordV1>(),
        ),
        (
            "asset.publication-record.schema.json",
            schema_of::<AssetPublicationRecordV1>(),
        ),
        ("asset.work-row.schema.json", schema_of::<AssetWorkRowV1>()),
        (
            "asset.cut-manifest.schema.json",
            schema_of::<crate::assets_cut::AssetCutManifestV1>(),
        ),
    ]
}

#[cfg(test)]
mod tests {
    #[test]
    fn on_demand_width_normalizes_up_the_ladder_and_bounds() {
        use super::normalize_on_demand_width as norm;
        assert_eq!(norm(1), Some(16));
        assert_eq!(norm(16), Some(16));
        assert_eq!(norm(100), Some(128));
        assert_eq!(norm(129), Some(192));
        assert_eq!(norm(2048), Some(2048));
        assert_eq!(norm(2049), None);
        assert_eq!(norm(0), None);
    }

    use super::*;
    use rusqlite::Connection;

    fn test_tx(conn: &mut Connection) -> Transaction<'_> {
        conn.transaction().expect("transaction")
    }

    fn blob_record(digest: &str, key: &str) -> AssetBlobRecordV1 {
        AssetBlobRecordV1 {
            blob_id: AssetFsStore::new_opaque_key(),
            app_id: "app_1".to_owned(),
            store: ASSET_STORE_LOCAL_FS.to_owned(),
            physical_key: key.to_owned(),
            byte_length: 42,
            detected_content_type: "application/octet-stream".to_owned(),
            digest_algorithm: ASSET_DIGEST_ALGORITHM_SHA256.to_owned(),
            digest: digest.to_owned(),
            canonicalization_policy: "none".to_owned(),
            created_at_ms: 1,
        }
    }

    #[test]
    fn blob_identity_uniqueness_converges_on_the_winner() {
        let mut conn = Connection::open_in_memory().expect("db");
        let tx = test_tx(&mut conn);
        create_infra(&tx).expect("infra");

        let winner = blob_record("d1", "k1");
        assert!(matches!(
            insert_blob(&tx, &winner, 1).expect("insert"),
            BlobInsertOutcome::Created
        ));

        let loser = blob_record("d1", "k2");
        match insert_blob(&tx, &loser, 2).expect("race") {
            BlobInsertOutcome::ConvergedOnWinner { blob_id } => {
                assert_eq!(blob_id, winner.blob_id);
            }
            BlobInsertOutcome::Created => panic!("uniqueness constraint did not hold"),
        }

        let count: u64 = tx
            .query_row(
                "SELECT reference_count FROM _snapback_asset_blobs_v1 WHERE blob_id = ?1",
                [&winner.blob_id],
                |row| row.get(0),
            )
            .expect("count");
        assert_eq!(count, 2, "the loser adopted the winner's reference");
    }

    #[test]
    fn implementation_carrier_migrates_policy_only_generation_and_bumps() {
        let mut conn = Connection::open_in_memory().expect("db");
        let tx = test_tx(&mut conn);
        tx.execute_batch(
            "CREATE TABLE _snapback_asset_intent_generations_v1 (
                 intent_id TEXT PRIMARY KEY NOT NULL,
                 intent_policy_hash TEXT NOT NULL,
                 generation INTEGER NOT NULL,
                 revoked INTEGER NOT NULL DEFAULT 0,
                 updated_at_ms INTEGER NOT NULL
             );
             INSERT INTO _snapback_asset_intent_generations_v1 (
                 intent_id, intent_policy_hash, generation, revoked, updated_at_ms
             ) VALUES ('app:avatarUpload', 'sha256:same-policy', 4, 0, 1);",
        )
        .expect("legacy policy-only generation");

        create_infra(&tx).expect("additive carrier migration");
        let generation = ensure_intent_generation(
            &tx,
            "app:avatarUpload",
            "sha256:same-policy",
            "sha256:current-implementation",
            "{}",
            2,
        )
        .expect("carrier-aware activation");
        assert_eq!(generation.generation, 5);
        let stored: (String, Option<String>, u64) = tx
            .query_row(
                "SELECT intent_policy_hash, implementation_hash, generation
                 FROM _snapback_asset_intent_generations_v1
                 WHERE intent_id = 'app:avatarUpload'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("migrated generation");
        assert_eq!(stored.0, "sha256:same-policy");
        assert_eq!(stored.1.as_deref(), Some("sha256:current-implementation"));
        assert_eq!(
            stored.2, 5,
            "legacy NULL identity cannot be adopted in place"
        );
    }

    #[test]
    fn blob_mutable_state_is_single_representation_and_legacy_json_migrates() {
        let mut conn = Connection::open_in_memory().expect("db");
        let tx = test_tx(&mut conn);
        create_infra(&tx).expect("infra");

        let record = blob_record("d9", "k9");
        assert!(matches!(
            insert_blob(&tx, &record, 1).expect("insert"),
            BlobInsertOutcome::Created
        ));
        let stored: String = tx
            .query_row(
                "SELECT record_json FROM _snapback_asset_blobs_v1 WHERE blob_id = ?1",
                [&record.blob_id],
                |row| row.get(0),
            )
            .expect("json");
        assert!(
            !stored.contains("referenceCount") && !stored.contains("condemned"),
            "mutable state must not enter record_json: {stored}"
        );
        release_blob_reference(&tx, &record.blob_id, 2).expect("release");
        assert!(condemn_blob_if_unreferenced(&tx, &record.blob_id, 3).expect("condemn"));
        let live = load_blob_live(&tx, &record.blob_id)
            .expect("load")
            .expect("row");
        assert_eq!(live.reference_count, 0);
        assert!(live.condemned);
        assert_eq!(live.record.digest, record.digest);

        // A legacy row whose JSON still carries the removed members decodes
        // after the idempotent open-time strip.
        tx.execute(
            "INSERT INTO _snapback_asset_blobs_v1 (
                 blob_id, app_id, store, physical_key, digest_algorithm, digest,
                 canonicalization_policy, byte_length, reference_count, condemned,
                 record_json, updated_at_ms
             ) VALUES ('legacy', 'app_1', 'local-fs', 'klegacy', 'sha256',
                       'dlegacy', 'none', 42, 3, 0, ?1, 4)",
            [
                "{\"blobId\":\"legacy\",\"appId\":\"app_1\",\"store\":\"local-fs\",\
                 \"physicalKey\":\"klegacy\",\"byteLength\":42,\
                 \"detectedContentType\":\"application/octet-stream\",\
                 \"digestAlgorithm\":\"sha256\",\"digest\":\"dlegacy\",\
                 \"canonicalizationPolicy\":\"none\",\"referenceCount\":1,\
                 \"condemned\":false,\"createdAtMs\":1}"
                    .to_owned(),
            ],
        )
        .expect("legacy row");
        assert!(
            load_blob(&tx, "legacy").is_err(),
            "legacy json refuses pre-migration"
        );
        create_infra(&tx).expect("re-open migration");
        let migrated = load_blob_live(&tx, "legacy").expect("load").expect("row");
        assert_eq!(migrated.reference_count, 3, "columns are the authority");
        assert_eq!(migrated.record.byte_length, 42);
    }

    #[test]
    fn condemned_blobs_are_never_reusable_and_refcounts_fence_gc() {
        let mut conn = Connection::open_in_memory().expect("db");
        let tx = test_tx(&mut conn);
        create_infra(&tx).expect("infra");

        let record = blob_record("d2", "k3");
        insert_blob(&tx, &record, 1).expect("insert");

        assert!(
            !condemn_blob_if_unreferenced(&tx, &record.blob_id, 2).expect("fence"),
            "a referenced blob must not be condemnable",
        );
        assert_eq!(
            release_blob_reference(&tx, &record.blob_id, 3).expect("release"),
            0
        );
        assert!(condemn_blob_if_unreferenced(&tx, &record.blob_id, 4).expect("condemn"));

        assert!(matches!(
            acquire_blob_reference(&tx, "app_1", ASSET_DIGEST_ALGORITHM_SHA256, "d2", "none", 5)
                .expect("acquire"),
            BlobAcquisition::Absent
        ));
        assert!(
            release_blob_reference(&tx, &record.blob_id, 6).is_err(),
            "releasing a zero-reference blob is a structural error",
        );
    }

    #[test]
    fn single_current_attempt_is_structural() {
        let mut conn = Connection::open_in_memory().expect("db");
        let tx = test_tx(&mut conn);
        create_infra(&tx).expect("infra");

        let insert = |attempt_id: &str, state: &str, staging: &str| {
            tx.execute(
                "INSERT INTO _snapback_asset_attempts_v1 (
                     attempt_id, asset_id, state, staging_key, expires_at_ms,
                     record_json, updated_at_ms
                 ) VALUES (?1, 'asset_1', ?2, ?3, 0, '{}', 0)",
                rusqlite::params![attempt_id, state, staging],
            )
        };
        insert("a1", "open", "s1").expect("first current attempt");
        assert!(
            insert("a2", "transferring", "s2").is_err(),
            "two current attempts for one asset must violate the partial unique index",
        );
        tx.execute(
            "UPDATE _snapback_asset_attempts_v1 SET state = 'cancelled' WHERE attempt_id = 'a1'",
            [],
        )
        .expect("supersede");
        insert("a2", "open", "s2").expect("successor after supersession");
    }

    #[test]
    fn app_schemas_cannot_declare_or_shadow_asset_system_tables() {
        use crate::manifest::{FieldManifest, FieldType, SchemaManifest, TableManifest};

        for reserved in ASSET_SYSTEM_TABLES {
            let mut db = crate::storage::LocalDatabase::memory().expect("memory database");
            let error = db
                .schema_seed()
                .apply_schema(SchemaManifest {
                    tables: vec![TableManifest {
                        name: reserved.to_owned(),
                        fields: vec![FieldManifest {
                            name: "k".to_owned(),
                            field_type: FieldType::String,
                            optional: false,
                        }],
                        indexes: Vec::new(),
                        syncable: false,
                        permission_backing: false,
                        permission_fields: None,
                        search_indexes: Vec::new(),
                        vector_indexes: Vec::new(),
                        search_live_limits: None,
                        membership: None,
                        authority_profile: None,
                        asset_sharing: None,
                        visibility: None,
                        history: None,
                    }],
                    ..SchemaManifest::default()
                })
                .expect_err("a reserved asset table name must refuse");
            assert_eq!(error.diagnostic.code, "SNAPBACK_INVALID_IDENTIFIER");
        }
    }

    #[test]
    fn opaque_store_keys_refuse_path_shapes() {
        assert!(validated_key("01890f3c-9d5b-7000-8000-000000000001").is_ok());
        for bad in ["../escape", "a/b", "", "name.png", "key with space"] {
            assert!(validated_key(bad).is_err(), "{bad:?} must refuse");
        }
    }

    #[test]
    fn closed_state_vocabularies_are_name_keyed() {
        assert_eq!(
            serde_json::to_value(AssetAttemptState::Finalizing).unwrap(),
            serde_json::json!("finalizing"),
        );
        assert_eq!(
            serde_json::to_value(AssetPublicationState::Condemned).unwrap(),
            serde_json::json!("condemned"),
        );
        assert_eq!(
            serde_json::to_value(AssetDeliveryProfile::PrivateStrict).unwrap(),
            serde_json::json!("private-strict"),
        );
        assert_eq!(
            serde_json::to_value(AssetIntegrityGrade::ReceivedBytesCanonical).unwrap(),
            serde_json::json!("received-bytes-canonical"),
        );
        assert!(serde_json::from_value::<AssetWorkState>(serde_json::json!(0)).is_err());
    }

    #[test]
    fn byte_ranges_parse_per_rfc_9110_single_range_semantics() {
        use ByteRangeOutcome as O;
        assert_eq!(parse_byte_range(None, 100), O::Full);
        assert_eq!(
            parse_byte_range(Some("bytes=0-99"), 100),
            O::Partial { start: 0, end: 99 }
        );
        assert_eq!(
            parse_byte_range(Some("bytes=2-5"), 100),
            O::Partial { start: 2, end: 5 }
        );
        // An end past the representation clamps (RFC 9110 §14.1.2).
        assert_eq!(
            parse_byte_range(Some("bytes=90-150"), 100),
            O::Partial { start: 90, end: 99 }
        );
        assert_eq!(
            parse_byte_range(Some("bytes=10-"), 100),
            O::Partial { start: 10, end: 99 }
        );
        assert_eq!(
            parse_byte_range(Some("bytes=-4"), 100),
            O::Partial { start: 96, end: 99 }
        );
        // A suffix longer than the representation is the whole thing.
        assert_eq!(
            parse_byte_range(Some("bytes=-500"), 100),
            O::Partial { start: 0, end: 99 }
        );
        assert_eq!(parse_byte_range(Some("bytes=100-"), 100), O::Unsatisfiable);
        assert_eq!(parse_byte_range(Some("bytes=5-2"), 100), O::Unsatisfiable);
        assert_eq!(parse_byte_range(Some("bytes=-0"), 100), O::Unsatisfiable);
        // Multi-range and foreign units are ignored, never mis-served.
        assert_eq!(parse_byte_range(Some("bytes=0-1,5-9"), 100), O::Full);
        assert_eq!(parse_byte_range(Some("items=0-4"), 100), O::Full);
        assert_eq!(parse_byte_range(Some("bytes=abc-"), 100), O::Full);
    }

    #[test]
    fn active_content_and_unrecognized_types_force_attachment() {
        assert!(forces_attachment_disposition("image/svg+xml"));
        assert!(forces_attachment_disposition("TEXT/HTML; charset=utf-8"));
        assert!(forces_attachment_disposition("application/xml"));
        assert!(forces_attachment_disposition("application/octet-stream"));
        assert!(!forces_attachment_disposition("image/png"));
        assert!(!forces_attachment_disposition("image/jpeg"));
        assert!(!forces_attachment_disposition("video/mp4"));
    }

    #[test]
    fn filenames_sanitize_to_safe_metadata() {
        assert_eq!(sanitize_filename(Some("photo.bin")), "photo.bin");
        // Path separators are gone; residual dots/underscores are inert.
        assert_eq!(
            sanitize_filename(Some("../../etc/passwd")),
            "_.._etc_passwd"
        );
        assert_eq!(sanitize_filename(Some("a\"b\r\nc.png")), "a_b__c.png");
        assert_eq!(sanitize_filename(Some("  ..  ")), "download");
        assert_eq!(sanitize_filename(None), "download");
    }

    #[test]
    fn rendition_transitions_are_closed_and_reach_retired() {
        use AssetRenditionState as R;
        assert!(rendition_transition_allowed(R::Pending, R::Ready));
        assert!(rendition_transition_allowed(R::Pending, R::Failed));
        assert!(rendition_transition_allowed(R::Ready, R::Superseded));
        for from in [R::Pending, R::Ready, R::Failed, R::Superseded] {
            assert!(rendition_transition_allowed(from, R::Retired));
        }
        assert!(!rendition_transition_allowed(R::Retired, R::Ready));
        assert!(!rendition_transition_allowed(R::Failed, R::Ready));
        assert!(!rendition_transition_allowed(R::Superseded, R::Ready));
    }
}
