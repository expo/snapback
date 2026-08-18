//! Asset consistent-cut export/import (LLP 0044, dated design addition
//! 2026-07-31).
//!
//! A **cut** is the asset component of a logical export: the ready asset
//! metadata rows, their ready renditions, the digest-addressed blob objects
//! those renditions reference, the tombstone set, and the quota snapshot —
//! all captured in one read transaction at a pinned commit version. The cut
//! deliberately **excludes** in-flight upload attempts, pending/rejected
//! assets, and staging bytes (transient transfer state, the 0007 rule that a
//! logical bundle names its exclusions). Reverse-reference edges derive from
//! typed rows. Ordinary app-row edges rebuild with the app-data component;
//! framework-owned media-collection rows travel here and rebuild their edges
//! during asset-cut import.
//!
//! Import is refuse-partial: both components — manifest and every blob
//! object — verify before any row lands. Application restores onto an empty
//! asset state only, mints fresh opaque physical keys, and bumps every
//! lifecycle generation past the manifest's (the restore-epoch fence: signed
//! URLs validate by recomputing against the *current* generation, so
//! old-epoch bearer URLs cannot validate against restored assets).

use serde_json::Value;

use crate::assets::{
    ASSET_DIGEST_ALGORITHM_SHA256, AssetBlobRecordV1, AssetGrantRecordV1, AssetGrantState,
    AssetRecordV1, AssetRenditionRecordV1,
};
use crate::contract_types::MediaKindV1;
use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::manifest::SchemaManifest;
use rusqlite::Transaction;

pub const ASSET_CUT_FORMAT_VERSION: &str = "snapback.asset-cut.v1";
const ASSET_CUT_DIGEST_DOMAIN: &[u8] = b"snapback:asset-cut:v1\n";
pub const ASSET_CUT_MANIFEST_FILE: &str = "asset-cut.manifest.json";
pub const ASSET_CUT_BLOB_DIR: &str = "blobs/sha256";

fn manifest_invalid(message: impl Into<String>) -> SnapbackError {
    cut_error("SNAPBACK_ASSET_IMPORT_MANIFEST_INVALID", message)
}
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
    #[serde(default, skip_serializing_if = "is_zero")]
    pub grant_count: u64,
    /// Active framework-owned collection items carried with the asset cut.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub collection_item_count: u64,
}

fn is_zero(value: &u64) -> bool {
    *value == 0
}

/// One active framework-owned collection item. Parent-incarnation tokens are
/// deliberately not portable: import rebinds the stable item id to the
/// target parent's active incarnation after the app-data component exists.
#[derive(Clone, Debug, serde::Deserialize, PartialEq, serde::Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AssetCutCollectionItemV1 {
    pub collection: String,
    pub collection_generation: String,
    pub item_id: String,
    pub parent_id: String,
    pub asset_id: String,
    pub kind: MediaKindV1,
    pub policy_generation: String,
    pub ordinal: u64,
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
    /// Grant edges are captured in the same SQLite read transaction as their
    /// ready assets. Empty is omitted to preserve pre-feature cut preimages.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub grants: Vec<AssetGrantRecordV1>,
    /// Active collection records are part of the asset component because they
    /// are the addressable attachment/authority facts that root these assets.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub collection_items: Vec<AssetCutCollectionItemV1>,
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
    let mut body = serde_json::json!({
        "formatVersion": manifest.format_version,
        "appId": manifest.app_id,
        "cutVersion": manifest.cut_version,
        "capturedAtMs": manifest.captured_at_ms,
        "assets": manifest.assets,
        "tombstones": manifest.tombstones,
        "blobs": manifest.blobs,
        "quota": manifest.quota,
    });
    if !manifest.grants.is_empty() {
        let grants = serde_json::to_value(&manifest.grants).map_err(|error| {
            cut_error(
                "SNAPBACK_ASSET_EXPORT_TARGET_INVALID",
                format!("cut grants are not serializable: {error}"),
            )
        })?;
        body.as_object_mut()
            .expect("cut body is an object")
            .insert("grants".to_owned(), grants);
    }
    if !manifest.collection_items.is_empty() {
        let items = serde_json::to_value(&manifest.collection_items).map_err(|error| {
            cut_error(
                "SNAPBACK_ASSET_EXPORT_TARGET_INVALID",
                format!("collection items cannot be encoded: {error}"),
            )
        })?;
        body.as_object_mut()
            .expect("cut digest body is an object")
            .insert("collectionItems".to_owned(), items);
    }
    let canonical = crate::rqs_contract::jcs(&body).map_err(|_| {
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
    schema: &SchemaManifest,
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
    let ready_ids = assets
        .iter()
        .map(|asset| asset.record.asset_id.as_str())
        .collect::<std::collections::BTreeSet<_>>();
    // @ref LLP 0210#d5--recipient-scoped-authority-recipe-now-grant-ops-as-the-paved-spelling —
    // system grant edges travel with their ready assets in this same SQLite
    // snapshot; they are not independently copied app rows.
    let mut grant_statement = tx.prepare(
        "SELECT record_json FROM _snapback_asset_grants_v1
         WHERE app_id = ?1 ORDER BY grant_id",
    )?;
    let grant_rows = grant_statement.query_map([app_id], |row| row.get::<_, String>(0))?;
    let mut grants = Vec::new();
    for row in grant_rows {
        let grant: AssetGrantRecordV1 = serde_json::from_str(&row?).map_err(|error| {
            cut_error(
                "SNAPBACK_ASSET_EXPORT_TARGET_INVALID",
                format!("asset grant record is undecodable: {error}"),
            )
        })?;
        if ready_ids.contains(grant.asset_id.as_str()) {
            grants.push(grant);
        }
    }
    let ready_asset_count = assets.len() as u64;
    let grant_count = grants.len() as u64;
    let collection_items = capture_collection_items(tx, schema, &ready_ids)?;
    let collection_item_count = collection_items.len() as u64;
    let mut manifest = AssetCutManifestV1 {
        format_version: ASSET_CUT_FORMAT_VERSION.to_owned(),
        app_id: app_id.to_owned(),
        cut_version,
        captured_at_ms: now_ms,
        assets,
        tombstones,
        blobs,
        grants,
        collection_items,
        quota: AssetCutQuotaV1 {
            settled_logical_bytes: accounting.settled_bytes,
            ready_asset_count,
            grant_count,
            collection_item_count,
        },
        manifest_digest: String::new(),
    };
    manifest.manifest_digest = cut_manifest_digest(&manifest)?;
    Ok(AssetCutCapture {
        manifest,
        blob_keys,
    })
}

// @ref LLP 0239#d2-assetcollection-is-the-zero-to-many-application-relation — collection rows
// are a typed, addressable part of the asset cut, never an opaque JSON leaf.
fn capture_collection_items(
    tx: &Transaction<'_>,
    schema: &SchemaManifest,
    ready_assets: &std::collections::BTreeSet<&str>,
) -> SnapbackResult<Vec<AssetCutCollectionItemV1>> {
    let mut output = Vec::new();
    for collection in &schema.asset_collections {
        let table = quote_dynamic_identifier(&collection.child_table)?;
        let sql = format!(
            "SELECT child._id, child.parentId, child.assetId, child.kind, \
                    child.policyGeneration, child.ordinal \
               FROM {table} AS child \
               JOIN _snapback_relation_incarnations_v1 AS relation \
                 ON relation.table_name = ?1 \
                AND relation.row_id = child.parentId \
                AND relation.incarnation = child.parentIncarnation \
                AND relation.active = 1 \
              ORDER BY child.parentId, child.ordinal, child._id"
        );
        let mut statement = tx.prepare(&sql)?;
        let rows = statement.query_map([&collection.owner_table], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, i64>(5)?,
            ))
        })?;
        let mut per_parent =
            std::collections::BTreeMap::<String, (u64, std::collections::BTreeSet<String>)>::new();
        for row in rows {
            let (item_id, parent_id, asset_id, kind, policy_generation, ordinal) = row?;
            let ordinal = u64::try_from(ordinal).map_err(|_| {
                cut_error(
                    "SNAPBACK_ASSET_EXPORT_COLLECTION_INVALID",
                    "collection item ordinal is negative",
                )
            })?;
            if !ready_assets.contains(asset_id.as_str())
                || policy_generation != collection.generation
            {
                return Err(cut_error(
                    "SNAPBACK_ASSET_EXPORT_COLLECTION_INVALID",
                    format!(
                        "collection {} contains an item outside its active ready-asset generation",
                        collection.name
                    ),
                ));
            }
            let state = per_parent.entry(parent_id.clone()).or_default();
            if ordinal != state.0 || !state.1.insert(asset_id.clone()) {
                return Err(cut_error(
                    "SNAPBACK_ASSET_EXPORT_COLLECTION_INVALID",
                    format!(
                        "collection {} has non-contiguous order or duplicate assets",
                        collection.name
                    ),
                ));
            }
            state.0 += 1;
            if state.0 > u64::from(collection.max_items) {
                return Err(cut_error(
                    "SNAPBACK_ASSET_EXPORT_COLLECTION_INVALID",
                    format!("collection {} exceeds its declared bound", collection.name),
                ));
            }
            output.push(AssetCutCollectionItemV1 {
                collection: collection.name.clone(),
                collection_generation: collection.generation.clone(),
                item_id,
                parent_id,
                asset_id,
                kind: parse_media_kind(&kind)?,
                policy_generation,
                ordinal,
            });
        }
    }
    Ok(output)
}

fn quote_dynamic_identifier(identifier: &str) -> SnapbackResult<String> {
    if identifier.is_empty()
        || !identifier
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
    {
        return Err(cut_error(
            "SNAPBACK_ASSET_EXPORT_COLLECTION_INVALID",
            "collection table identifier is not portable",
        ));
    }
    Ok(format!("\"{identifier}\""))
}

fn parse_media_kind(kind: &str) -> SnapbackResult<MediaKindV1> {
    match kind {
        "image" => Ok(MediaKindV1::Image),
        "video" => Ok(MediaKindV1::Video),
        "audio" => Ok(MediaKindV1::Audio),
        "file" => Ok(MediaKindV1::File),
        _ => Err(cut_error(
            "SNAPBACK_ASSET_EXPORT_COLLECTION_INVALID",
            "collection item kind is outside the closed media-kind set",
        )),
    }
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
    schema: &SchemaManifest,
    manifest: &AssetCutManifestV1,
    fresh_keys: &[String],
    store_kind: &str,
    now_ms: u64,
) -> SnapbackResult<()> {
    let (records, blobs, renditions, grants): (u64, u64, u64, u64) = (
        count(tx, "_snapback_asset_records_v1")?,
        count(tx, "_snapback_asset_blobs_v1")?,
        count(tx, "_snapback_asset_renditions_v1")?,
        count(tx, "_snapback_asset_grants_v1")?,
    );
    if records + blobs + renditions + grants != 0 {
        return Err(cut_error(
            "SNAPBACK_ASSET_IMPORT_TARGET_NOT_EMPTY",
            format!(
                "import applies only to an empty asset state ({records} assets, {blobs} blobs, {renditions} renditions, {grants} grants exist)"
            ),
        ));
    }
    if fresh_keys.len() != manifest.blobs.len() {
        return Err(cut_error(
            "SNAPBACK_ASSET_IMPORT_MANIFEST_INVALID",
            "fresh key set does not align with the manifest blob list",
        ));
    }
    if manifest.grants.len() as u64 > crate::assets::ASSET_MAX_GRANTS_PER_APP
        || manifest.quota.grant_count != manifest.grants.len() as u64
    {
        return Err(cut_error(
            "SNAPBACK_ASSET_IMPORT_MANIFEST_INVALID",
            "grant rows do not match the cut quota snapshot or exceed the app ceiling",
        ));
    }
    if manifest.quota.collection_item_count != manifest.collection_items.len() as u64 {
        return Err(cut_error(
            "SNAPBACK_ASSET_IMPORT_MANIFEST_INVALID",
            "collection rows do not match the cut quota snapshot",
        ));
    }
    for collection in &schema.asset_collections {
        let table = quote_dynamic_identifier(&collection.child_table)?;
        if count(tx, &table)? != 0 {
            return Err(cut_error(
                "SNAPBACK_ASSET_IMPORT_TARGET_NOT_EMPTY",
                format!(
                    "collection import requires empty framework table {}",
                    collection.child_table
                ),
            ));
        }
    }
    let ready_assets = manifest
        .assets
        .iter()
        .map(|asset| (asset.record.asset_id.as_str(), asset.record.grants_enabled))
        .collect::<std::collections::BTreeMap<_, _>>();
    let mut grant_ids = std::collections::BTreeSet::new();
    for grant in &manifest.grants {
        if ready_assets.get(grant.asset_id.as_str()) != Some(&true)
            || !grant_ids.insert(grant.grant_id.as_str())
        {
            return Err(cut_error(
                "SNAPBACK_ASSET_IMPORT_MANIFEST_INVALID",
                "every imported grant must have a unique id and name a grant-enabled ready asset in the cut",
            ));
        }
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

    for grant in &manifest.grants {
        let app_id = manifest.app_id.as_str();
        tx.execute(
            "INSERT INTO _snapback_asset_grants_v1
                 (grant_id, asset_id, app_id, principal, state, minted_by, record_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                grant.grant_id,
                grant.asset_id,
                app_id,
                grant.principal,
                if grant.state == AssetGrantState::Active {
                    "active"
                } else {
                    "pending"
                },
                grant.provenance.minted_by,
                encode(grant)?,
            ],
        )?;
        if grant.state == AssetGrantState::Active {
            tx.execute(
                "UPDATE _snapback_asset_records_v1 SET unreferenced_since_ms = NULL
                 WHERE asset_id = ?1",
                [&grant.asset_id],
            )?;
        }
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
            grants_enabled: false,
            availability: crate::assets::AssetAvailability::Deleted,
            primary_rendition_id: None,
            media_kind: None,
            lifecycle_generation: tombstone.lifecycle_generation.saturating_add(1),
            created_at_ms: now_ms,
            updated_at_ms: now_ms,
            deleted_at_ms: tombstone.deleted_at_ms.or(Some(now_ms)),
        };
        insert_imported_record(tx, &record, now_ms)?;
    }
    apply_collection_items(tx, schema, manifest, now_ms)?;
    Ok(())
}

fn apply_collection_items(
    tx: &Transaction<'_>,
    schema: &SchemaManifest,
    manifest: &AssetCutManifestV1,
    now_ms: u64,
) -> SnapbackResult<()> {
    let mut identities = std::collections::BTreeSet::new();
    let mut per_parent = std::collections::BTreeMap::<
        (String, String),
        (u64, std::collections::BTreeSet<String>),
    >::new();
    for item in &manifest.collection_items {
        let collection = schema
            .asset_collections
            .iter()
            .find(|collection| collection.name == item.collection)
            .filter(|collection| collection.generation == item.collection_generation)
            .ok_or_else(|| {
                cut_error(
                    "SNAPBACK_ASSET_IMPORT_COLLECTION_SCHEMA_MISMATCH",
                    format!(
                        "collection {} generation is absent from the target schema",
                        item.collection
                    ),
                )
            })?;
        if item.policy_generation != collection.generation
            || !collection.kinds.contains(&item.kind)
            || !identities.insert((collection.child_table.clone(), item.item_id.clone()))
        {
            return Err(cut_error(
                "SNAPBACK_ASSET_IMPORT_MANIFEST_INVALID",
                "collection item identity, kind, or policy generation is invalid",
            ));
        }
        let state = per_parent
            .entry((collection.name.clone(), item.parent_id.clone()))
            .or_default();
        if item.ordinal != state.0
            || !state.1.insert(item.asset_id.clone())
            || state.0 >= u64::from(collection.max_items)
        {
            return Err(cut_error(
                "SNAPBACK_ASSET_IMPORT_MANIFEST_INVALID",
                "collection order, duplicate policy, or count bound is invalid",
            ));
        }
        state.0 += 1;
        let record = crate::assets::load_asset(tx, &item.asset_id)?.ok_or_else(|| {
            cut_error(
                "SNAPBACK_ASSET_IMPORT_MANIFEST_INVALID",
                "collection item references an asset absent from the cut",
            )
        })?;
        if record.availability != crate::assets::AssetAvailability::Ready
            || record.intent_name != collection.intent
            || record.media_kind != Some(item.kind)
        {
            return Err(cut_error(
                "SNAPBACK_ASSET_IMPORT_MANIFEST_INVALID",
                "collection item does not match a finalized admitted asset",
            ));
        }
        let incarnation: String = tx
            .query_row(
                "SELECT incarnation FROM _snapback_relation_incarnations_v1 \
                  WHERE table_name = ?1 AND row_id = ?2 AND active = 1",
                rusqlite::params![collection.owner_table, item.parent_id],
                |row| row.get(0),
            )
            .map_err(|_| {
                cut_error(
                    "SNAPBACK_ASSET_IMPORT_COLLECTION_PARENT_MISSING",
                    format!(
                        "collection {} parent {} is absent from the restored app-data cut",
                        item.collection, item.parent_id
                    ),
                )
            })?;
        let table = quote_dynamic_identifier(&collection.child_table)?;
        let timestamp = i64::try_from(now_ms).map_err(|_| {
            cut_error(
                "SNAPBACK_ASSET_IMPORT_MANIFEST_INVALID",
                "import timestamp exceeds SQLite's portable range",
            )
        })?;
        let ordinal = i64::try_from(item.ordinal).map_err(|_| {
            cut_error(
                "SNAPBACK_ASSET_IMPORT_MANIFEST_INVALID",
                "collection ordinal exceeds SQLite's portable range",
            )
        })?;
        tx.execute(
            &format!(
                "INSERT INTO {table} \
                    (_id, _version, _createdAt, _updatedAt, parentId, parentIncarnation, \
                     assetId, kind, policyGeneration, ordinal) \
                 VALUES (?1, 0, ?2, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"
            ),
            rusqlite::params![
                item.item_id,
                timestamp,
                item.parent_id,
                incarnation,
                item.asset_id,
                media_kind_name(item.kind),
                item.policy_generation,
                ordinal,
            ],
        )?;
        crate::assets::insert_reference_edge(
            tx,
            &manifest.app_id,
            &item.asset_id,
            &collection.child_table,
            &item.item_id,
            "assetId",
            now_ms,
        )?;
    }
    Ok(())
}

fn media_kind_name(kind: MediaKindV1) -> &'static str {
    match kind {
        MediaKindV1::Image => "image",
        MediaKindV1::Video => "video",
        MediaKindV1::Audio => "audio",
        MediaKindV1::File => "file",
    }
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
