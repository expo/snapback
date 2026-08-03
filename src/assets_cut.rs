//! Asset consistent-cut export/import (LLP 0044, dated design addition
//! 2026-07-31).
//!
//! A **cut** is the asset component of a logical export: the ready asset
//! metadata rows, their ready renditions, the digest-addressed blob objects
//! those renditions reference, the tombstone set, and the quota snapshot —
//! all captured in one read transaction at a pinned commit version. The cut
//! deliberately **excludes** in-flight upload attempts, pending/rejected
//! assets, and staging bytes (transient transfer state, the 0007 rule that a
//! logical bundle names its exclusions), and reverse-reference edges (they
//! derive from app rows, which belong to the app-data component; they
//! rebuild when app rows import through the complete-cut admission).
//!
//! Import is refuse-partial: both components — manifest and every blob
//! object — verify before any row lands. Application restores onto an empty
//! asset state only, mints fresh opaque physical keys, and bumps every
//! lifecycle generation past the manifest's (the restore-epoch fence: signed
//! URLs validate by recomputing against the *current* generation, so
//! old-epoch bearer URLs cannot validate against restored assets).

use serde_json::Value;

use crate::assets::{
    ASSET_DIGEST_ALGORITHM_SHA256, AssetBlobRecordV1, AssetRecordV1, AssetRenditionRecordV1,
};
use crate::diagnostic::{SnapbackError, SnapbackResult};
use rusqlite::Transaction;

pub const ASSET_CUT_FORMAT_VERSION: &str = "snapback.asset-cut.v1";
const ASSET_CUT_DIGEST_DOMAIN: &[u8] = b"snapback:asset-cut:v1\n";
pub const ASSET_CUT_MANIFEST_FILE: &str = "asset-cut.manifest.json";
pub const ASSET_CUT_BLOB_DIR: &str = "blobs/sha256";

/// One exported asset: the record plus the ready renditions that carry its
/// content. Only `ready` assets appear here; everything else is transient
/// or a tombstone.
#[derive(Clone, Debug, serde::Deserialize, PartialEq, serde::Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AssetCutAssetV1 {
    pub record: AssetRecordV1,
    pub renditions: Vec<AssetRenditionRecordV1>,
}

/// A deleted asset carried so import cannot resurrect it: the id and the
/// generation it died at.
#[derive(Clone, Debug, serde::Deserialize, PartialEq, serde::Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AssetCutTombstoneV1 {
    pub asset_id: String,
    pub lifecycle_generation: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deleted_at_ms: Option<u64>,
}

/// One referenced blob object, digest-addressed in the export directory.
/// The physical store key deliberately does not appear: keys are opaque and
/// instance-local; import mints fresh ones.
#[derive(Clone, Debug, serde::Deserialize, PartialEq, serde::Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AssetCutBlobV1 {
    pub blob_id: String,
    pub digest_algorithm: String,
    pub digest: String,
    pub byte_length: u64,
    pub detected_content_type: String,
    pub canonicalization_policy: String,
    /// Export-relative object path (`blobs/sha256/<hex>`).
    pub object_path: String,
}

#[derive(Clone, Debug, serde::Deserialize, PartialEq, serde::Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AssetCutQuotaV1 {
    /// Settled logical bytes at the cut (the app quota contract's number).
    pub settled_logical_bytes: u64,
    pub ready_asset_count: u64,
}

/// The consistent-cut manifest — the asset component of a logical export.
#[derive(Clone, Debug, serde::Deserialize, PartialEq, serde::Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AssetCutManifestV1 {
    pub format_version: String,
    pub app_id: String,
    /// The storage head commit version observed inside the capture
    /// transaction — the cut's consistency witness.
    pub cut_version: u64,
    pub captured_at_ms: u64,
    pub assets: Vec<AssetCutAssetV1>,
    pub tombstones: Vec<AssetCutTombstoneV1>,
    pub blobs: Vec<AssetCutBlobV1>,
    pub quota: AssetCutQuotaV1,
    /// Tagged SHA-256 over the canonical (JCS) manifest body with this field
    /// absent; domain `snapback:asset-cut:v1\n`.
    pub manifest_digest: String,
}

fn cut_error(code: &str, message: impl Into<String>) -> SnapbackError {
    SnapbackError::error(code, "assets", message)
}

/// The tagged canonical digest of the manifest body (everything except
/// `manifestDigest` itself), in the seed-fixtures idiom.
pub fn cut_manifest_digest(manifest: &AssetCutManifestV1) -> SnapbackResult<String> {
    use sha2::Digest as _;
    let body = serde_json::json!({
        "formatVersion": manifest.format_version,
        "appId": manifest.app_id,
        "cutVersion": manifest.cut_version,
        "capturedAtMs": manifest.captured_at_ms,
        "assets": manifest.assets,
        "tombstones": manifest.tombstones,
        "blobs": manifest.blobs,
        "quota": manifest.quota,
    });
    let canonical = crate::rqs::jcs(&body).map_err(|_| {
        cut_error(
            "SNAPBACK_ASSET_EXPORT_TARGET_INVALID",
            "cut manifest is outside canonical JSON limits",
        )
    })?;
    let mut hasher = sha2::Sha256::new();
    hasher.update(ASSET_CUT_DIGEST_DOMAIN);
    hasher.update(canonical.as_bytes());
    Ok(format!("sha256:{:x}", hasher.finalize()))
}

/// Everything the export needs from the capture transaction: the manifest
/// (digest still empty) plus each referenced blob's opaque physical key,
/// pairs aligned with `manifest.blobs`.
pub struct AssetCutCapture {
    pub manifest: AssetCutManifestV1,
    pub blob_keys: Vec<String>,
}

/// Capture the cut inside one read transaction. Ready assets with their
/// ready renditions; deleted assets as tombstones; each referenced blob
/// exactly once, digest-addressed.
pub fn capture_cut(
    tx: &Transaction<'_>,
    app_id: &str,
    cut_version: u64,
    now_ms: u64,
) -> SnapbackResult<AssetCutCapture> {
    let mut assets = Vec::new();
    let mut tombstones = Vec::new();
    let mut blobs: Vec<AssetCutBlobV1> = Vec::new();
    let mut blob_keys: Vec<String> = Vec::new();
    let mut seen_blobs = std::collections::BTreeSet::new();

    let records = all_asset_records(tx, app_id)?;
    for record in records {
        match record.availability {
            crate::assets::AssetAvailability::Deleted => {
                tombstones.push(AssetCutTombstoneV1 {
                    asset_id: record.asset_id,
                    lifecycle_generation: record.lifecycle_generation,
                    deleted_at_ms: record.deleted_at_ms,
                });
            }
            crate::assets::AssetAvailability::Ready => {
                let renditions: Vec<AssetRenditionRecordV1> =
                    crate::assets::renditions_for_asset(tx, &record.asset_id)?
                        .into_iter()
                        .filter(|rendition| {
                            rendition.state == crate::assets::AssetRenditionState::Ready
                        })
                        .collect();
                for rendition in &renditions {
                    if seen_blobs.insert(rendition.blob_id.clone()) {
                        let live = crate::assets::load_blob_live(tx, &rendition.blob_id)?
                            .ok_or_else(|| {
                                cut_error(
                                    "SNAPBACK_ASSET_EXPORT_BLOB_MISSING",
                                    format!(
                                        "rendition {} references blob {} which has no record",
                                        rendition.rendition_id, rendition.blob_id
                                    ),
                                )
                            })?;
                        blobs.push(blob_entry(&live.record));
                        blob_keys.push(live.record.physical_key.clone());
                    }
                }
                assets.push(AssetCutAssetV1 { record, renditions });
            }
            // Pending/rejected assets are transient transfer state: the cut
            // names them as exclusions rather than carrying them (design
            // note in the module docs and LLP 0044).
            _ => {}
        }
    }

    let accounting = crate::assets::asset_accounting(tx, app_id)?;
    let ready_asset_count = assets.len() as u64;
    let mut manifest = AssetCutManifestV1 {
        format_version: ASSET_CUT_FORMAT_VERSION.to_owned(),
        app_id: app_id.to_owned(),
        cut_version,
        captured_at_ms: now_ms,
        assets,
        tombstones,
        blobs,
        quota: AssetCutQuotaV1 {
            settled_logical_bytes: accounting.settled_bytes,
            ready_asset_count,
        },
        manifest_digest: String::new(),
    };
    manifest.manifest_digest = cut_manifest_digest(&manifest)?;
    Ok(AssetCutCapture {
        manifest,
        blob_keys,
    })
}

fn blob_entry(record: &AssetBlobRecordV1) -> AssetCutBlobV1 {
    let hex = record
        .digest
        .strip_prefix("sha256:")
        .unwrap_or(&record.digest);
    AssetCutBlobV1 {
        blob_id: record.blob_id.clone(),
        digest_algorithm: record.digest_algorithm.clone(),
        digest: record.digest.clone(),
        byte_length: record.byte_length,
        detected_content_type: record.detected_content_type.clone(),
        canonicalization_policy: record.canonicalization_policy.clone(),
        object_path: format!("{ASSET_CUT_BLOB_DIR}/{hex}"),
    }
}

fn all_asset_records(tx: &Transaction<'_>, app_id: &str) -> SnapbackResult<Vec<AssetRecordV1>> {
    let mut statement = tx.prepare(
        "SELECT record_json FROM _snapback_asset_records_v1 WHERE app_id = ?1 ORDER BY asset_id",
    )?;
    let rows = statement.query_map([app_id], |row| row.get::<_, String>(0))?;
    let mut records = Vec::new();
    for row in rows {
        let json = row?;
        records.push(serde_json::from_str(&json).map_err(|error| {
            cut_error(
                "SNAPBACK_ASSET_EXPORT_TARGET_INVALID",
                format!("asset record is undecodable: {error}"),
            )
        })?);
    }
    Ok(records)
}

/// Validation outcome for an export directory: the decoded, digest-verified
/// manifest. Every blob object must exist and hash-verify — refuse-partial.
pub fn validate_export_dir(dir: &std::path::Path) -> SnapbackResult<AssetCutManifestV1> {
    let manifest_path = dir.join(ASSET_CUT_MANIFEST_FILE);
    let raw = std::fs::read_to_string(&manifest_path).map_err(|error| {
        cut_error(
            "SNAPBACK_ASSET_IMPORT_INCOMPLETE",
            format!("cannot read {}: {error}", manifest_path.display()),
        )
    })?;
    let manifest: AssetCutManifestV1 = serde_json::from_str(&raw).map_err(|error| {
        cut_error(
            "SNAPBACK_ASSET_IMPORT_MANIFEST_INVALID",
            format!("manifest is undecodable: {error}"),
        )
    })?;
    if manifest.format_version != ASSET_CUT_FORMAT_VERSION {
        return Err(cut_error(
            "SNAPBACK_ASSET_IMPORT_MANIFEST_INVALID",
            format!("unsupported cut format {}", manifest.format_version),
        ));
    }
    let observed = cut_manifest_digest(&manifest)?;
    if observed != manifest.manifest_digest {
        return Err(cut_error(
            "SNAPBACK_ASSET_IMPORT_MANIFEST_INVALID",
            "manifestDigest does not match the canonical manifest body",
        ));
    }
    for blob in &manifest.blobs {
        if blob.digest_algorithm != ASSET_DIGEST_ALGORITHM_SHA256 {
            return Err(cut_error(
                "SNAPBACK_ASSET_IMPORT_MANIFEST_INVALID",
                format!("unsupported digest algorithm {}", blob.digest_algorithm),
            ));
        }
        let path = dir.join(&blob.object_path);
        if !path.is_file() {
            return Err(cut_error(
                "SNAPBACK_ASSET_IMPORT_INCOMPLETE",
                format!("blob object {} is missing", blob.object_path),
            ));
        }
        let observed = crate::assets_store::hash_path(&path)?;
        // Blob records carry the raw lowercase hex digest (the store's
        // `AssetObjectDigest` spelling); compare raw-to-raw.
        if observed.digest != blob.digest || observed.byte_length != blob.byte_length {
            return Err(cut_error(
                "SNAPBACK_ASSET_IMPORT_DIGEST_MISMATCH",
                format!(
                    "blob object {} does not match the manifest ({} bytes, sha256 {})",
                    blob.object_path, observed.byte_length, observed.digest
                ),
            ));
        }
    }
    Ok(manifest)
}

/// Summarized validation facts for the host-op response and receipts.
pub fn validation_summary(manifest: &AssetCutManifestV1) -> Value {
    serde_json::json!({
        "formatVersion": manifest.format_version,
        "appId": manifest.app_id,
        "cutVersion": manifest.cut_version,
        "assetCount": manifest.assets.len(),
        "tombstoneCount": manifest.tombstones.len(),
        "blobCount": manifest.blobs.len(),
        "manifestDigest": manifest.manifest_digest,
    })
}

#[cfg(test)]
#[allow(clippy::items_after_test_module)]
mod tests {
    use super::*;

    fn manifest_fixture() -> AssetCutManifestV1 {
        let mut manifest = AssetCutManifestV1 {
            format_version: ASSET_CUT_FORMAT_VERSION.to_owned(),
            app_id: "app".to_owned(),
            cut_version: 7,
            captured_at_ms: 1000,
            assets: Vec::new(),
            tombstones: vec![AssetCutTombstoneV1 {
                asset_id: "a1".to_owned(),
                lifecycle_generation: 3,
                deleted_at_ms: Some(900),
            }],
            blobs: Vec::new(),
            quota: AssetCutQuotaV1 {
                settled_logical_bytes: 0,
                ready_asset_count: 0,
            },
            manifest_digest: String::new(),
        };
        manifest.manifest_digest = cut_manifest_digest(&manifest).expect("digest");
        manifest
    }

    #[test]
    fn cut_manifest_digest_is_deterministic_and_tamper_evident() {
        let manifest = manifest_fixture();
        assert_eq!(
            cut_manifest_digest(&manifest).expect("digest"),
            manifest.manifest_digest
        );
        let mut tampered = manifest.clone();
        tampered.cut_version = 8;
        assert_ne!(
            cut_manifest_digest(&tampered).expect("digest"),
            manifest.manifest_digest
        );
    }

    #[test]
    fn validate_export_dir_refuses_partial_and_tampered_components() {
        let dir = tempfile::tempdir().expect("tempdir");
        // Missing manifest entirely.
        let err = validate_export_dir(dir.path()).expect_err("missing manifest");
        assert_eq!(err.diagnostic.code, "SNAPBACK_ASSET_IMPORT_INCOMPLETE");

        // Valid manifest, no blobs: passes.
        let manifest = manifest_fixture();
        std::fs::write(
            dir.path().join(ASSET_CUT_MANIFEST_FILE),
            serde_json::to_string(&manifest).expect("encode"),
        )
        .expect("write");
        validate_export_dir(dir.path()).expect("valid manifest verifies");

        // Tampered digest refuses.
        let mut tampered = manifest.clone();
        tampered.captured_at_ms = 2000;
        std::fs::write(
            dir.path().join(ASSET_CUT_MANIFEST_FILE),
            serde_json::to_string(&tampered).expect("encode"),
        )
        .expect("write");
        let err = validate_export_dir(dir.path()).expect_err("tampered manifest");
        assert_eq!(
            err.diagnostic.code,
            "SNAPBACK_ASSET_IMPORT_MANIFEST_INVALID"
        );
    }
}

/// Enum-to-column string via the serde spelling, so the indexed column and
/// the record JSON can never disagree.
fn lowercase_of<T: serde::Serialize>(value: &T) -> SnapbackResult<String> {
    let value = serde_json::to_value(value).map_err(|error| {
        cut_error(
            "SNAPBACK_ASSET_IMPORT_MANIFEST_INVALID",
            format!("cut member is unserializable: {error}"),
        )
    })?;
    value
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| cut_error("SNAPBACK_ASSET_IMPORT_MANIFEST_INVALID", "non-string enum"))
}

fn encode<T: serde::Serialize>(value: &T) -> SnapbackResult<String> {
    serde_json::to_string(value).map_err(|error| {
        cut_error(
            "SNAPBACK_ASSET_IMPORT_MANIFEST_INVALID",
            format!("cut member is unserializable: {error}"),
        )
    })
}

/// Apply a validated cut onto an EMPTY asset state (the restore posture).
/// The caller has already: verified the export directory (refuse-partial),
/// put every blob object into the store under the fresh opaque keys in
/// `fresh_keys` (aligned with `manifest.blobs`), and holds the experimental
/// acknowledgement. Restore-epoch fencing: every imported asset's lifecycle
/// generation is the manifest's plus one, so bearer URLs minted against the
/// exporting instance can never validate here (signed-URL validation
/// recomputes against the current generation).
pub fn apply_cut(
    tx: &Transaction<'_>,
    manifest: &AssetCutManifestV1,
    fresh_keys: &[String],
    store_kind: &str,
    now_ms: u64,
) -> SnapbackResult<()> {
    let (records, blobs, renditions): (u64, u64, u64) = (
        count(tx, "_snapback_asset_records_v1")?,
        count(tx, "_snapback_asset_blobs_v1")?,
        count(tx, "_snapback_asset_renditions_v1")?,
    );
    if records + blobs + renditions != 0 {
        return Err(cut_error(
            "SNAPBACK_ASSET_IMPORT_TARGET_NOT_EMPTY",
            format!(
                "import applies only to an empty asset state ({records} assets, {blobs} blobs, {renditions} renditions exist)"
            ),
        ));
    }
    if fresh_keys.len() != manifest.blobs.len() {
        return Err(cut_error(
            "SNAPBACK_ASSET_IMPORT_MANIFEST_INVALID",
            "fresh key set does not align with the manifest blob list",
        ));
    }

    let mut references: std::collections::BTreeMap<&str, u64> = std::collections::BTreeMap::new();
    for asset in &manifest.assets {
        for rendition in &asset.renditions {
            *references.entry(rendition.blob_id.as_str()).or_default() += 1;
        }
    }

    for (entry, fresh_key) in manifest.blobs.iter().zip(fresh_keys) {
        let record = AssetBlobRecordV1 {
            blob_id: entry.blob_id.clone(),
            app_id: manifest.app_id.clone(),
            store: store_kind.to_owned(),
            physical_key: fresh_key.clone(),
            byte_length: entry.byte_length,
            detected_content_type: entry.detected_content_type.clone(),
            digest_algorithm: entry.digest_algorithm.clone(),
            digest: entry.digest.clone(),
            canonicalization_policy: entry.canonicalization_policy.clone(),
            created_at_ms: now_ms,
        };
        let reference_count = references.get(entry.blob_id.as_str()).copied().unwrap_or(0);
        tx.execute(
            "INSERT INTO _snapback_asset_blobs_v1 (
                 blob_id, app_id, store, physical_key, digest_algorithm, digest,
                 canonicalization_policy, byte_length, reference_count, condemned,
                 record_json, updated_at_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, ?10, ?11)",
            rusqlite::params![
                record.blob_id,
                record.app_id,
                record.store,
                record.physical_key,
                record.digest_algorithm,
                record.digest,
                record.canonicalization_policy,
                record.byte_length,
                reference_count,
                encode(&record)?,
                now_ms,
            ],
        )?;
    }

    for asset in &manifest.assets {
        let mut record = asset.record.clone();
        record.lifecycle_generation = record.lifecycle_generation.saturating_add(1);
        record.updated_at_ms = now_ms;
        insert_imported_record(tx, &record, now_ms)?;
        for rendition in &asset.renditions {
            crate::assets::insert_rendition(tx, rendition)?;
        }
        crate::assets::mark_unreferenced_if_edgeless(tx, &record.asset_id, now_ms)?;
    }

    // Tombstones import as deleted rows so a later partial re-import cannot
    // resurrect them. The manifest deliberately carries only identity and
    // generation for a tombstone; the synthesized record keeps the deleted
    // availability and epoch-bumped generation, with intent identity
    // unknowable (empty) — nothing reads intent facts off a tombstone.
    for tombstone in &manifest.tombstones {
        let record = AssetRecordV1 {
            asset_id: tombstone.asset_id.clone(),
            app_id: manifest.app_id.clone(),
            intent_id: String::new(),
            intent_name: String::new(),
            intent_policy_hash: String::new(),
            policy_generation: 0,
            owner_principal: String::new(),
            delivery_profile: crate::assets::AssetDeliveryProfile::PrivateStrict,
            read_access: crate::assets::AssetReadAccessPolicy::OwnerOnly,
            availability: crate::assets::AssetAvailability::Deleted,
            primary_rendition_id: None,
            lifecycle_generation: tombstone.lifecycle_generation.saturating_add(1),
            created_at_ms: now_ms,
            updated_at_ms: now_ms,
            deleted_at_ms: tombstone.deleted_at_ms.or(Some(now_ms)),
        };
        insert_imported_record(tx, &record, now_ms)?;
    }
    Ok(())
}

fn insert_imported_record(
    tx: &Transaction<'_>,
    record: &AssetRecordV1,
    now_ms: u64,
) -> SnapbackResult<()> {
    tx.execute(
        "INSERT INTO _snapback_asset_records_v1 (
             asset_id, app_id, intent_id, owner_principal, availability,
             lifecycle_generation, record_json, updated_at_ms
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![
            record.asset_id,
            record.app_id,
            record.intent_id,
            record.owner_principal,
            lowercase_of(&record.availability)?,
            record.lifecycle_generation,
            encode(record)?,
            now_ms,
        ],
    )?;
    Ok(())
}

fn count(tx: &Transaction<'_>, table: &str) -> SnapbackResult<u64> {
    Ok(
        tx.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
            row.get::<_, u64>(0)
        })?,
    )
}
