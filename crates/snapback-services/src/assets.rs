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

use serde_json::Value;

use crate::diagnostic::{SnapbackError, SnapbackResult};
pub(crate) use snapback_kernel::assets::*;
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

pub struct AssetFinalizePrepareFailure {
    pub asset_outcome: AssetAvailability,
    pub refusal: SnapbackError,
}

pub enum AssetFinalizePrepareError {
    /// Store access failed before a deterministic byte/policy refusal. The
    /// attempt remains current and retryable exactly as it did before the
    /// prepare boundary was extracted.
    Transient(SnapbackError),
    /// The received bytes deterministically violate the stated policy.
    Refusal(AssetFinalizePrepareFailure),
}

/// The restricted-custody object containing the canonical bytes after
/// preparation. It is not a deliverable blob and carries no database state.
#[derive(Clone)]
pub enum AssetPreparedCanonicalObject {
    Staging(String),
    Canonical(String),
}

impl AssetPreparedCanonicalObject {
    pub fn as_ref(&self) -> crate::assets_store::AssetObjectRef<'_> {
        match self {
            Self::Staging(key) => crate::assets_store::AssetObjectRef::Staging(key),
            Self::Canonical(key) => crate::assets_store::AssetObjectRef::Canonical(key),
        }
    }
}

#[derive(Clone)]
pub struct AssetPreparedCanonical {
    pub object: AssetPreparedCanonicalObject,
    pub digest: String,
    pub byte_length: u64,
    pub policy: &'static str,
}

#[derive(Clone)]
pub struct AssetVariantPreparation {
    pub key: String,
    pub width: u64,
    pub rendered: Vec<u8>,
    pub digest: String,
    pub byte_length: u64,
    pub content_type: String,
    pub recipe_version: u64,
}

#[derive(Clone)]
pub struct AssetFinalizePreparation {
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

pub fn prepare_asset_variant(
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
pub fn prepare_required_asset_variants(
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
pub enum FinalizePreflightV1 {
    AlreadyComplete(AssetFinalizeResponseV1),
    Proceed(FinalizePrepareTicketV1),
}

/// Immutable continuity ticket between TUS PATCH validation and its durable
/// offset acknowledgement. The byte-store handle owns no `LocalSnapback`
/// borrow, so the potentially slow append and sync can run off the global
/// writer before the commit half compares the exact state observed here.
pub struct AssetTusPatchTicketV1 {
    attempt_id: String,
    staging_key: String,
    expected_offset: u64,
    expected_all_chunks_checksummed: bool,
    new_offset: u64,
    all_chunks_checksummed: bool,
    store: std::sync::Arc<dyn crate::assets_store::AssetStore>,
}

/// Read-only authorization/preflight either resolves an existing ladder
/// rendition or hands the database-free source read/render to the caller.
pub enum AssetWidthPreflightV1 {
    AlreadyReady(String),
    Proceed(AssetWidthPrepareTicketV1),
}

/// Owned facts needed to read and render one bounded on-demand width without
/// retaining `LocalSnapback`, SQLite, or caller authority.
pub struct AssetWidthPrepareTicketV1 {
    asset_id: String,
    key: String,
    width: u64,
    primary_key: String,
    content_type: String,
    store: std::sync::Arc<dyn crate::assets_store::AssetStore>,
    app_id: String,
    app_quota: u64,
}

/// Rendered bytes awaiting their caller-fenced durable publication plan.
pub struct AssetWidthPlanTicketV1 {
    ticket: AssetWidthPrepareTicketV1,
    prepared: AssetVariantPreparation,
}

/// A committed publication plan names the external blob PUT. This ticket
/// carries no caller permit; the separate durable authority-handoff design
/// governs retirement that races the idempotent PUT.
pub struct AssetWidthPutTicketV1 {
    plan: AssetWidthPlanTicketV1,
    publication: crate::asset_proof::AssetWidthPublicationPlannedProof,
    put_lease: AssetPublicationPutLeaseV1,
}

/// Verified blob bytes awaiting the caller-fenced staged and
/// rendition/blob/quota commits.
pub struct AssetWidthCommitTicketV1 {
    asset_id: String,
    key: String,
    app_id: String,
    app_quota: u64,
    prepared: crate::asset_proof::AssetWidthPreparedVariant,
    put_lease: AssetPublicationPutLeaseV1,
}

/// Publication PUT tickets have enough time for the S3 seam's bounded PUT
/// plus read-back verification, but cannot retain condemned bytes or rows
/// indefinitely when a blocking job is abandoned.
pub const ASSET_PUBLICATION_PUT_LEASE_MS: u64 = 5 * 60 * 1000;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum AssetPublicationPutLeasePhaseV1 {
    Ready,
    InFlight,
    CommitPending,
}

#[derive(Clone, Copy, Debug)]
struct AssetPublicationPutLeaseRecordV1 {
    expires_at: std::time::Instant,
    phase: AssetPublicationPutLeasePhaseV1,
}

#[derive(Default)]
struct AssetPublicationPutLeaseRegistryV1 {
    next_lease_id: u64,
    publications: std::collections::BTreeMap<
        String,
        std::collections::BTreeMap<u64, AssetPublicationPutLeaseRecordV1>,
    >,
}

fn asset_publication_put_leases() -> &'static std::sync::Mutex<AssetPublicationPutLeaseRegistryV1> {
    static LEASES: std::sync::OnceLock<std::sync::Mutex<AssetPublicationPutLeaseRegistryV1>> =
        std::sync::OnceLock::new();
    LEASES.get_or_init(|| std::sync::Mutex::new(AssetPublicationPutLeaseRegistryV1::default()))
}

/// Cleanup distinguishes an active lease from an external PUT that crossed
/// its deadline. The latter no longer retains object bytes, but its durable
/// condemned publication row remains the uncertainty owner until the call
/// returns and drops the marker.
#[doc(hidden)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AssetPublicationPutLeaseStateV1 {
    None,
    Active,
    ExpiredInFlight,
}

fn asset_publication_put_lease_state_at(
    publication_id: &str,
    now: std::time::Instant,
) -> AssetPublicationPutLeaseStateV1 {
    let mut registry = asset_publication_put_leases()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let Some(leases) = registry.publications.get_mut(publication_id) else {
        return AssetPublicationPutLeaseStateV1::None;
    };
    leases.retain(|_, lease| {
        lease.expires_at > now || lease.phase == AssetPublicationPutLeasePhaseV1::InFlight
    });
    let state = if leases.values().any(|lease| lease.expires_at > now) {
        AssetPublicationPutLeaseStateV1::Active
    } else if leases
        .values()
        .any(|lease| lease.phase == AssetPublicationPutLeasePhaseV1::InFlight)
    {
        AssetPublicationPutLeaseStateV1::ExpiredInFlight
    } else {
        AssetPublicationPutLeaseStateV1::None
    };
    if leases.is_empty() {
        registry.publications.remove(publication_id);
    }
    state
}

fn asset_publication_put_lease_expired() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_ASSET_STORE_UNAVAILABLE",
        "assets",
        "the bounded publication lease expired before the PUT/commit ticket resolved",
    )
    .with_details(serde_json::json!({
        "reason": "publication-put-lease-expired",
        "leaseMs": ASSET_PUBLICATION_PUT_LEASE_MS,
    }))
}

/// Process-local lifetime token for one PUT capability. The durable
/// publication remains authoritative; this token only prevents maintenance
/// from retiring that record while an in-memory ticket can still recreate its
/// idempotent object.
///
/// @ref LLP 0044#publication-and-crash-recovery — bounded external PUT
/// authority keeps its durable publication discoverable through the final
/// blob/rendition commit; an expired service ticket never decides deletion.
#[derive(Clone)]
#[doc(hidden)]
pub struct AssetPublicationPutLeaseV1 {
    inner: std::sync::Arc<AssetPublicationPutLeaseInnerV1>,
}

struct AssetPublicationPutLeaseInnerV1 {
    publication_id: String,
    lease_id: u64,
}

impl AssetPublicationPutLeaseV1 {
    fn acquire(publication_id: &str) -> Self {
        let mut registry = asset_publication_put_leases()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        registry.next_lease_id = registry.next_lease_id.wrapping_add(1).max(1);
        let lease_id = registry.next_lease_id;
        registry
            .publications
            .entry(publication_id.to_owned())
            .or_default()
            .insert(
                lease_id,
                AssetPublicationPutLeaseRecordV1 {
                    expires_at: std::time::Instant::now()
                        + std::time::Duration::from_millis(ASSET_PUBLICATION_PUT_LEASE_MS),
                    phase: AssetPublicationPutLeasePhaseV1::Ready,
                },
            );
        Self {
            inner: std::sync::Arc::new(AssetPublicationPutLeaseInnerV1 {
                publication_id: publication_id.to_owned(),
                lease_id,
            }),
        }
    }

    fn transition_if_active(&self, phase: AssetPublicationPutLeasePhaseV1) -> SnapbackResult<()> {
        let now = std::time::Instant::now();
        let mut registry = asset_publication_put_leases()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let active = registry
            .publications
            .get_mut(&self.inner.publication_id)
            .and_then(|leases| leases.get_mut(&self.inner.lease_id))
            .is_some_and(|lease| {
                if lease.expires_at > now {
                    lease.phase = phase;
                    true
                } else {
                    false
                }
            });
        if active {
            return Ok(());
        }
        if let Some(leases) = registry.publications.get_mut(&self.inner.publication_id) {
            leases.remove(&self.inner.lease_id);
            if leases.is_empty() {
                registry.publications.remove(&self.inner.publication_id);
            }
        }
        Err(asset_publication_put_lease_expired())
    }

    fn is_active(&self) -> bool {
        let now = std::time::Instant::now();
        asset_publication_put_leases()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .publications
            .get(&self.inner.publication_id)
            .and_then(|leases| leases.get(&self.inner.lease_id))
            .is_some_and(|lease| lease.expires_at > now)
    }

    /// A direct cleanup owned by this ticket may delete only when no sibling
    /// ticket can still write the same key. Expired in-flight siblings remain
    /// unresolved because their remote effect may return late.
    fn has_unresolved_sibling(&self) -> bool {
        let now = std::time::Instant::now();
        let mut registry = asset_publication_put_leases()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let Some(leases) = registry.publications.get_mut(&self.inner.publication_id) else {
            return false;
        };
        leases.retain(|_, lease| {
            lease.expires_at > now || lease.phase == AssetPublicationPutLeasePhaseV1::InFlight
        });
        leases
            .iter()
            .any(|(lease_id, _)| *lease_id != self.inner.lease_id)
    }
}

impl Drop for AssetPublicationPutLeaseInnerV1 {
    fn drop(&mut self) {
        let mut registry = asset_publication_put_leases()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(leases) = registry.publications.get_mut(&self.publication_id) {
            leases.remove(&self.lease_id);
            if leases.is_empty() {
                registry.publications.remove(&self.publication_id);
            }
        }
    }
}

#[doc(hidden)]
pub fn asset_publication_put_lease_state(publication_id: &str) -> AssetPublicationPutLeaseStateV1 {
    asset_publication_put_lease_state_at(publication_id, std::time::Instant::now())
}

#[cfg(any(test, feature = "remainder-tests"))]
pub fn asset_publication_expire_put_leases_for_test(publication_id: &str) {
    let mut registry = asset_publication_put_leases()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(leases) = registry.publications.get_mut(publication_id) {
        let expired = std::time::Instant::now()
            .checked_sub(std::time::Duration::from_millis(1))
            .unwrap_or_else(std::time::Instant::now);
        for lease in leases.values_mut() {
            lease.expires_at = expired;
        }
    }
}

impl AssetWidthPrepareTicketV1 {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        asset_id: String,
        key: String,
        width: u64,
        primary_key: String,
        content_type: String,
        store: std::sync::Arc<dyn crate::assets_store::AssetStore>,
        app_id: String,
        app_quota: u64,
    ) -> Self {
        Self {
            asset_id,
            key,
            width,
            primary_key,
            content_type,
            store,
            app_id,
            app_quota,
        }
    }

    /// The source read and media render may involve remote storage and CPU;
    /// both run after the route has dropped its prework authority permit.
    pub fn prepare(self) -> SnapbackResult<AssetWidthPlanTicketV1> {
        let canonical_bytes = self
            .store
            .read(crate::assets_store::AssetObjectRef::Blob(&self.primary_key))?;
        let variant = crate::manifest::AssetImageVariant {
            key: self.key.clone(),
            width: self.width,
            required: false,
        };
        let prepared = prepare_asset_variant(&canonical_bytes, &self.content_type, &variant, 1)?;
        Ok(AssetWidthPlanTicketV1 {
            ticket: self,
            prepared,
        })
    }
}

impl AssetWidthPlanTicketV1 {
    pub fn app_id(&self) -> &str {
        &self.ticket.app_id
    }

    pub fn digest(&self) -> &str {
        &self.prepared.digest
    }

    pub fn asset_id(&self) -> &str {
        &self.ticket.asset_id
    }

    pub fn variant_key(&self) -> &str {
        &self.ticket.key
    }

    /// Construct the external PUT capability only from the opaque proof
    /// returned by the kernel transaction that committed this exact plan.
    ///
    /// A raw, caller-synthesized publication record is intentionally the
    /// wrong argument type:
    ///
    /// ```compile_fail
    /// use snapback_services::assets::{
    ///     AssetWidthPlanTicketV1, AssetWidthPutTicketV1,
    /// };
    /// use snapback_kernel::assets::AssetPublicationRecordV1;
    ///
    /// fn forge(
    ///     ticket: AssetWidthPlanTicketV1,
    ///     unproven: AssetPublicationRecordV1,
    /// ) -> AssetWidthPutTicketV1 {
    ///     ticket.into_put(unproven).unwrap()
    /// }
    /// ```
    ///
    /// An attempt-owned required-rendition proof is also the wrong domain,
    /// even when it uses a real ladder key such as `w128` and its asset and
    /// digest happen to match:
    ///
    /// ```compile_fail
    /// use snapback_kernel::services_assets::AssetPublicationPlannedProof;
    /// use snapback_services::assets::{
    ///     AssetWidthPlanTicketV1, AssetWidthPutTicketV1,
    /// };
    ///
    /// fn cross_publication_domains(
    ///     ticket: AssetWidthPlanTicketV1,
    ///     attempt_owned: AssetPublicationPlannedProof,
    /// ) -> AssetWidthPutTicketV1 {
    ///     ticket.into_put(attempt_owned).unwrap()
    /// }
    /// ```
    pub fn into_put(
        self,
        proof: crate::asset_proof::AssetWidthPublicationPlannedProof,
    ) -> SnapbackResult<AssetWidthPutTicketV1> {
        let publication = proof.publication();
        if publication.app_id != self.ticket.app_id
            || publication.attempt_id.is_some()
            || publication.asset_id.as_deref() != Some(self.ticket.asset_id.as_str())
            || publication.variant_key.as_deref() != Some(self.ticket.key.as_str())
            || publication.digest != self.prepared.digest
            || !matches!(
                publication.state,
                crate::assets::AssetPublicationState::Planned
                    | crate::assets::AssetPublicationState::Staged
            )
        {
            return Err(SnapbackError::error(
                "SNAPBACK_ASSET_RECORD_INVALID",
                "assets",
                "the committed width publication proof does not match the prepared variant",
            ));
        }
        Ok(AssetWidthPutTicketV1 {
            put_lease: AssetPublicationPutLeaseV1::acquire(&publication.publication_id),
            plan: self,
            publication: proof,
        })
    }
}

impl AssetWidthPutTicketV1 {
    /// Perform and verify the irreversible external cut without a caller
    /// permit or database owner. The committed plan is its durable handoff.
    pub fn put(self) -> SnapbackResult<AssetWidthCommitTicketV1> {
        self.put_lease
            .transition_if_active(AssetPublicationPutLeasePhaseV1::InFlight)?;
        let store = &self.plan.ticket.store;
        let publication = self.publication.publication();
        let put = store.put_blob_idempotent(&publication.planned_key, &self.plan.prepared.rendered);
        if !self.put_lease.is_active() {
            return Err(asset_publication_put_lease_expired());
        }
        put?;
        let copied = store.hash(crate::assets_store::AssetObjectRef::Blob(
            &publication.planned_key,
        ));
        if !self.put_lease.is_active() {
            return Err(asset_publication_put_lease_expired());
        }
        let copied = copied?;
        if copied.digest != self.plan.prepared.digest
            || copied.byte_length != self.plan.prepared.byte_length
        {
            return Err(SnapbackError::error(
                "SNAPBACK_ASSET_STORE_UNAVAILABLE",
                "assets",
                "the published variant object did not verify",
            ));
        }
        self.put_lease
            .transition_if_active(AssetPublicationPutLeasePhaseV1::CommitPending)?;
        let AssetWidthPlanTicketV1 { ticket, prepared } = self.plan;
        Ok(AssetWidthCommitTicketV1 {
            asset_id: ticket.asset_id,
            key: ticket.key,
            app_id: ticket.app_id,
            app_quota: ticket.app_quota,
            prepared: self.publication.into_prepared_variant(
                prepared.key,
                prepared.width,
                prepared.digest,
                prepared.byte_length,
                prepared.content_type,
                prepared.recipe_version,
            ),
            put_lease: self.put_lease,
        })
    }

    #[cfg(any(test, feature = "remainder-tests"))]
    pub fn publication_for_test(&self) -> &AssetPublicationRecordV1 {
        self.publication.publication()
    }
}

impl AssetWidthCommitTicketV1 {
    pub fn into_parts(
        self,
    ) -> SnapbackResult<(
        String,
        String,
        String,
        u64,
        crate::asset_proof::AssetWidthPreparedVariant,
        AssetPublicationPutLeaseV1,
    )> {
        self.put_lease
            .transition_if_active(AssetPublicationPutLeasePhaseV1::CommitPending)?;
        Ok((
            self.asset_id,
            self.key,
            self.app_id,
            self.app_quota,
            self.prepared,
            self.put_lease,
        ))
    }
}

impl AssetTusPatchTicketV1 {
    /// Construct a continuity ticket only from the kernel's proof of the exact
    /// current attempt snapshot.
    ///
    /// @ref LLP 0276#phases — the higher adapter may carry admitted facts,
    /// but it cannot assert the storage continuity capability itself.
    pub fn from_current_attempt(
        proof: crate::asset_proof::AssetAttemptCurrentProof,
        new_offset: u64,
        all_chunks_checksummed: bool,
        store: std::sync::Arc<dyn crate::assets_store::AssetStore>,
    ) -> SnapbackResult<Self> {
        let attempt = proof.into_attempt();
        Ok(Self {
            attempt_id: attempt.attempt_id,
            staging_key: attempt.staging_key,
            expected_offset: attempt.acknowledged_offset,
            expected_all_chunks_checksummed: attempt.all_chunks_checksummed,
            new_offset,
            all_chunks_checksummed,
            store,
        })
    }

    pub fn attempt_id(&self) -> &str {
        &self.attempt_id
    }

    pub fn expected_offset(&self) -> u64 {
        self.expected_offset
    }

    pub fn expected_all_chunks_checksummed(&self) -> bool {
        self.expected_all_chunks_checksummed
    }

    pub fn new_offset(&self) -> u64 {
        self.new_offset
    }

    pub fn all_chunks_checksummed(&self) -> bool {
        self.all_chunks_checksummed
    }

    /// Write-then-record half of the TUS crash protocol. A successful return
    /// proves the chunk is durable, but deliberately does not claim that its
    /// offset has been acknowledged yet.
    pub fn append(&self, chunk: &[u8]) -> SnapbackResult<()> {
        self.store
            .append_staging(&self.staging_key, self.expected_offset, chunk)
    }
}

/// Immutable continuity ticket between asset-finalize preflight and commit.
/// The byte-store handle is config-derived while Local is available, then
/// clone-shareable without retaining any LocalSnapback or database borrow.
#[derive(Clone)]
pub struct FinalizePrepareTicketV1 {
    attempt: AssetAttemptRecordV1,
    request: AssetFinalizeRequestV1,
    frozen_intent: crate::manifest::AssetUploadIntentDefinition,
    on_ready: Option<String>,
    store: std::sync::Arc<dyn crate::assets_store::AssetStore>,
    image_finalization_enabled: bool,
    video_finalization_enabled: bool,
    app_id: String,
    app_quota: u64,
    schema: crate::manifest::SchemaManifest,
}

/// A deterministic byte/policy refusal still returns through the lock-held
/// commit half so the attempt failure and receipts are recorded exactly once.
/// Transient store errors remain ordinary `SnapbackResult` errors and leave the
/// attempt current and retryable.
pub enum FinalizePreparationV1 {
    Prepared(AssetFinalizePreparation),
    Refused(AssetFinalizePrepareFailure),
}

/// Phase A either observes an already-complete concurrent finalization or
/// hands the database-free canonical object put to the caller. The `Proceed`
/// ticket is created only after its `planned` publication record commits.
pub enum FinalizePhaseAOutcomeV1 {
    AlreadyComplete(AssetFinalizeResponseV1),
    Proceed(Box<FinalizePutTicketV1>),
}

/// Type-state handoff from lock-held Phase A to lock-free Phase B. It owns the
/// immutable prepare result, exact publication key, and clone-shared store;
/// it carries no `LocalSnapback` or database borrow.
pub struct FinalizePutTicketV1 {
    ticket: FinalizePrepareTicketV1,
    prepared: AssetFinalizePreparation,
    publication: AssetPublicationRecordV1,
    required_publications: Vec<AssetPublicationRecordV1>,
    publication_put_leases: Vec<AssetPublicationPutLeaseV1>,
    grade: AssetIntegrityGrade,
}

/// Proof that Phase B's object put returned and the recorded key verified.
/// Only this ticket is accepted by lock-held Phase C/D.
pub struct FinalizeCommitTicketV1 {
    put: FinalizePutTicketV1,
    prepared_required: Vec<snapback_kernel::storage::AssetPreparedVariant>,
}

/// Post-publication physical cleanup runs without caller permits or Local.
/// Its resulting receipt is committed only after the route reserves again.
pub struct FinalizeCleanupTicketV1 {
    response: AssetFinalizeResponseV1,
    store: std::sync::Arc<dyn crate::assets_store::AssetStore>,
    staging_key: String,
    reused_blob_key: Option<String>,
    publication_put_leases: Vec<AssetPublicationPutLeaseV1>,
}

pub struct FinalizeCleanupCommitTicketV1 {
    response: AssetFinalizeResponseV1,
    attempt_id: String,
    asset_id: String,
}

impl FinalizePutTicketV1 {
    fn clone_with_leases(&self, publication_put_leases: Vec<AssetPublicationPutLeaseV1>) -> Self {
        Self {
            ticket: self.ticket.clone(),
            prepared: self.prepared.clone(),
            publication: self.publication.clone(),
            required_publications: self.required_publications.clone(),
            publication_put_leases,
            grade: self.grade,
        }
    }

    /// Every external PUT in this ticket is backed by its own opaque proof of
    /// a committed publication plan. In particular, required rendition plans
    /// cannot be supplied as caller-authored records.
    ///
    /// ```compile_fail
    /// use snapback_services::assets::{
    ///     AssetFinalizePreparation, FinalizePrepareTicketV1, FinalizePutTicketV1,
    /// };
    /// use snapback_kernel::{
    ///     assets::{AssetIntegrityGrade, AssetPublicationRecordV1},
    ///     services_assets::AssetPublicationPlannedProof,
    /// };
    ///
    /// fn forge_required(
    ///     primary: AssetPublicationPlannedProof,
    ///     ticket: FinalizePrepareTicketV1,
    ///     prepared: AssetFinalizePreparation,
    ///     unproven: Vec<AssetPublicationRecordV1>,
    /// ) {
    ///     let _ = FinalizePutTicketV1::from_planned_publication(
    ///         primary,
    ///         ticket,
    ///         prepared,
    ///         unproven,
    ///         AssetIntegrityGrade::ReceivedBytesCanonical,
    ///     );
    /// }
    /// ```
    pub fn from_planned_publication(
        proof: crate::asset_proof::AssetPublicationPlannedProof,
        ticket: FinalizePrepareTicketV1,
        prepared: AssetFinalizePreparation,
        required_proofs: Vec<crate::asset_proof::AssetPublicationPlannedProof>,
        grade: AssetIntegrityGrade,
    ) -> SnapbackResult<Self> {
        let publication = proof.into_publication();
        if publication.app_id != ticket.app_id
            || publication.attempt_id.as_deref() != Some(ticket.attempt.attempt_id.as_str())
            || publication.digest != prepared.canonical.digest
            || publication.variant_key.is_some()
            || !matches!(
                publication.state,
                crate::assets::AssetPublicationState::Planned
                    | crate::assets::AssetPublicationState::Staged
            )
        {
            return Err(SnapbackError::error(
                "SNAPBACK_ASSET_RECORD_INVALID",
                "assets",
                "the committed primary publication proof does not match finalization",
            ));
        }
        if prepared.required_variants.len() != required_proofs.len() {
            return Err(SnapbackError::error(
                "SNAPBACK_ASSET_RECORD_INVALID",
                "assets",
                "the required rendition publication proofs do not match the prepared variants",
            ));
        }
        let mut required_publications = Vec::with_capacity(required_proofs.len());
        for (required, proof) in prepared.required_variants.iter().zip(required_proofs) {
            let required_publication = proof.into_publication();
            if required_publication.app_id != ticket.app_id
                || required_publication.attempt_id.as_deref()
                    != Some(ticket.attempt.attempt_id.as_str())
                || required_publication.asset_id.as_deref()
                    != Some(ticket.attempt.asset_id.as_str())
                || required_publication.variant_key.as_deref() != Some(required.key.as_str())
                || required_publication.digest != required.digest
                || !matches!(
                    required_publication.state,
                    crate::assets::AssetPublicationState::Planned
                        | crate::assets::AssetPublicationState::Staged
                )
            {
                return Err(SnapbackError::error(
                    "SNAPBACK_ASSET_RECORD_INVALID",
                    "assets",
                    "a committed required-rendition proof does not match finalization",
                ));
            }
            required_publications.push(required_publication);
        }
        let publication_put_leases = std::iter::once(&publication)
            .chain(required_publications.iter())
            .map(|publication| AssetPublicationPutLeaseV1::acquire(&publication.publication_id))
            .collect();
        Ok(Self {
            ticket,
            prepared,
            publication,
            required_publications,
            publication_put_leases,
            grade,
        })
    }

    /// Phase B of the write-ahead publication protocol. This method is
    /// deliberately database-free so transports can run remote/object-store
    /// latency without retaining the global Local writer.
    pub fn put(self) -> SnapbackResult<FinalizeCommitTicketV1> {
        if self.prepared.required_variants.len() != self.required_publications.len()
            || self.publication_put_leases.len() != self.required_publications.len() + 1
        {
            return Err(SnapbackError::error(
                "SNAPBACK_ASSET_RECORD_INVALID",
                "assets",
                "the required rendition publication plans do not match the prepared variants",
            ));
        }
        let planned_key = &self.publication.planned_key;
        let primary_put_lease = &self.publication_put_leases[0];
        primary_put_lease.transition_if_active(AssetPublicationPutLeasePhaseV1::InFlight)?;
        let copied_from_staging = self
            .ticket
            .store
            .copy_from_staging(self.prepared.canonical.object.as_ref(), planned_key);
        if !primary_put_lease.is_active() {
            return Err(asset_publication_put_lease_expired());
        }
        copied_from_staging?;
        let copied = self
            .ticket
            .store
            .hash(crate::assets_store::AssetObjectRef::Blob(planned_key));
        if !primary_put_lease.is_active() {
            return Err(asset_publication_put_lease_expired());
        }
        let copied = copied?;
        if copied.digest != self.prepared.canonical.digest
            || copied.byte_length != self.prepared.canonical.byte_length
        {
            return Err(SnapbackError::error(
                "SNAPBACK_ASSET_STORE_UNAVAILABLE",
                "assets",
                "the published object did not verify against the canonical digest",
            ));
        }
        primary_put_lease.transition_if_active(AssetPublicationPutLeasePhaseV1::CommitPending)?;
        let mut prepared_required = Vec::with_capacity(self.required_publications.len());
        for (index, (prepared, publication)) in self
            .prepared
            .required_variants
            .iter()
            .zip(&self.required_publications)
            .enumerate()
        {
            let put_lease = &self.publication_put_leases[index + 1];
            put_lease.transition_if_active(AssetPublicationPutLeasePhaseV1::InFlight)?;
            let put = self
                .ticket
                .store
                .put_blob_idempotent(&publication.planned_key, &prepared.rendered);
            if !put_lease.is_active() {
                return Err(asset_publication_put_lease_expired());
            }
            put?;
            let copied = self
                .ticket
                .store
                .hash(crate::assets_store::AssetObjectRef::Blob(
                    &publication.planned_key,
                ));
            if !put_lease.is_active() {
                return Err(asset_publication_put_lease_expired());
            }
            let copied = copied?;
            if copied.digest != prepared.digest || copied.byte_length != prepared.byte_length {
                return Err(SnapbackError::error(
                    "SNAPBACK_ASSET_STORE_UNAVAILABLE",
                    "assets",
                    "the published required variant object did not verify",
                ));
            }
            put_lease.transition_if_active(AssetPublicationPutLeasePhaseV1::CommitPending)?;
            prepared_required.push(snapback_kernel::storage::AssetPreparedVariant {
                key: prepared.key.clone(),
                width: prepared.width,
                publication: publication.clone(),
                digest: prepared.digest.clone(),
                byte_length: prepared.byte_length,
                content_type: prepared.content_type.clone(),
                recipe_version: prepared.recipe_version,
            });
        }
        Ok(FinalizeCommitTicketV1 {
            put: self,
            prepared_required,
        })
    }
}

impl Clone for FinalizePutTicketV1 {
    fn clone(&self) -> Self {
        let publication_put_leases = std::iter::once(&self.publication)
            .chain(self.required_publications.iter())
            .map(|publication| AssetPublicationPutLeaseV1::acquire(&publication.publication_id))
            .collect();
        self.clone_with_leases(publication_put_leases)
    }
}

impl Clone for FinalizeCommitTicketV1 {
    fn clone(&self) -> Self {
        Self {
            // A commit ticket has no remaining store-write capability. Its
            // witness-retry clone shares the same lease identities so the
            // retry handoff does not manufacture a false sibling PUT.
            put: self
                .put
                .clone_with_leases(self.put.publication_put_leases.clone()),
            prepared_required: self.prepared_required.clone(),
        }
    }
}

impl FinalizePrepareTicketV1 {
    #[allow(clippy::too_many_arguments)]
    pub fn from_current_attempt(
        proof: crate::asset_proof::AssetAttemptCurrentProof,
        request: AssetFinalizeRequestV1,
        frozen_intent: crate::manifest::AssetUploadIntentDefinition,
        on_ready: Option<String>,
        store: std::sync::Arc<dyn crate::assets_store::AssetStore>,
        image_finalization_enabled: bool,
        video_finalization_enabled: bool,
        app_id: String,
        app_quota: u64,
        schema: crate::manifest::SchemaManifest,
    ) -> SnapbackResult<Self> {
        let attempt = proof.into_attempt();
        Ok(Self {
            attempt,
            request,
            frozen_intent,
            on_ready,
            store,
            image_finalization_enabled,
            video_finalization_enabled,
            app_id,
            app_quota,
            schema,
        })
    }

    pub fn attempt(&self) -> &AssetAttemptRecordV1 {
        &self.attempt
    }

    pub fn request(&self) -> &AssetFinalizeRequestV1 {
        &self.request
    }

    pub fn app_id(&self) -> &str {
        &self.app_id
    }

    pub fn prepare(&self) -> SnapbackResult<FinalizePreparationV1> {
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

pub type FinalizePrepareParts = (
    AssetAttemptRecordV1,
    AssetFinalizeRequestV1,
    crate::manifest::AssetUploadIntentDefinition,
    Option<String>,
    std::sync::Arc<dyn crate::assets_store::AssetStore>,
    bool,
    bool,
    String,
    u64,
    crate::manifest::SchemaManifest,
);

impl FinalizePrepareTicketV1 {
    pub fn into_parts(self) -> FinalizePrepareParts {
        (
            self.attempt,
            self.request,
            self.frozen_intent,
            self.on_ready,
            self.store,
            self.image_finalization_enabled,
            self.video_finalization_enabled,
            self.app_id,
            self.app_quota,
            self.schema,
        )
    }
}

impl FinalizePutTicketV1 {
    pub fn into_parts(
        self,
    ) -> (
        FinalizePrepareTicketV1,
        AssetFinalizePreparation,
        AssetPublicationRecordV1,
        AssetIntegrityGrade,
        Vec<AssetPublicationPutLeaseV1>,
    ) {
        (
            self.ticket,
            self.prepared,
            self.publication,
            self.grade,
            self.publication_put_leases,
        )
    }

    #[cfg(any(test, feature = "remainder-tests"))]
    pub fn publication_for_test(&self) -> &AssetPublicationRecordV1 {
        &self.publication
    }
}

impl FinalizeCommitTicketV1 {
    pub fn attempt(&self) -> &AssetAttemptRecordV1 {
        self.put.ticket.attempt()
    }

    pub fn frozen_intent(&self) -> &crate::manifest::AssetUploadIntentDefinition {
        &self.put.ticket.frozen_intent
    }

    pub fn into_parts(
        self,
    ) -> SnapbackResult<(
        FinalizePutTicketV1,
        Vec<snapback_kernel::storage::AssetPreparedVariant>,
    )> {
        for put_lease in &self.put.publication_put_leases {
            put_lease.transition_if_active(AssetPublicationPutLeasePhaseV1::CommitPending)?;
        }
        Ok((self.put, self.prepared_required))
    }
}

impl FinalizeCleanupTicketV1 {
    pub fn new(
        response: AssetFinalizeResponseV1,
        store: std::sync::Arc<dyn crate::assets_store::AssetStore>,
        staging_key: String,
        reused_blob_key: Option<String>,
        publication_put_leases: Vec<AssetPublicationPutLeaseV1>,
    ) -> Self {
        Self {
            response,
            store,
            staging_key,
            reused_blob_key,
            publication_put_leases,
        }
    }

    pub fn cleanup(self) -> SnapbackResult<FinalizeCleanupCommitTicketV1> {
        self.store.delete_staging_pair(&self.staging_key)?;
        let sibling_put_unresolved = self
            .publication_put_leases
            .first()
            .is_some_and(AssetPublicationPutLeaseV1::has_unresolved_sibling);
        if let Some(blob_key) = &self.reused_blob_key
            && !sibling_put_unresolved
        {
            self.store.delete_blob(blob_key).map_err(|error| {
                SnapbackError::error(
                    "SNAPBACK_ASSET_STORE_UNAVAILABLE",
                    "assets",
                    format!("cannot remove condemned object: {error}"),
                )
            })?;
        }
        Ok(FinalizeCleanupCommitTicketV1 {
            attempt_id: self.response.task.attempt_id.clone(),
            asset_id: self.response.task.asset_id.clone(),
            response: self.response,
        })
    }
}

impl FinalizeCleanupCommitTicketV1 {
    pub fn into_parts(self) -> (AssetFinalizeResponseV1, String, String) {
        (self.response, self.attempt_id, self.asset_id)
    }
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
        snapback_kernel::assets::new_opaque_key()
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

    #[cfg(any(test, feature = "remainder-tests"))]
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

/// Unpublished seam for remainder-only store inspection paths.
pub trait AssetFsStoreLocalExt {
    fn staging_directory(instance_dir: &Path) -> PathBuf;
    fn blobs_directory(instance_dir: &Path) -> PathBuf;
}

impl AssetFsStoreLocalExt for AssetFsStore {
    fn staging_directory(instance_dir: &Path) -> PathBuf {
        Self::staging_directory(instance_dir)
    }

    fn blobs_directory(instance_dir: &Path) -> PathBuf {
        Self::blobs_directory(instance_dir)
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

pub trait AssetFactsLocalExt {
    fn local_v1() -> Self;
}

impl AssetFactsLocalExt for AssetImageFactsV1 {
    fn local_v1() -> Self {
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

impl AssetFactsLocalExt for AssetVideoFactsV1 {
    fn local_v1() -> Self {
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

impl AssetFactsLocalExt for AssetTargetFactsV1 {
    fn local_v1() -> Self {
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
