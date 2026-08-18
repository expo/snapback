use serde::{Deserialize, Serialize};

/// Durable recipient grants are charged to their asset owner's app. Pending
/// and active rows both count; revoke releases the slot transactionally.
pub const ASSET_MAX_GRANTS_PER_APP: u64 = 1024;

fn default_asset_max_grants_per_app() -> u64 {
    ASSET_MAX_GRANTS_PER_APP
}
pub const ASSET_APP_LOGICAL_QUOTA_BYTES: u64 = 4 * 1024 * 1024 * 1024;

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
