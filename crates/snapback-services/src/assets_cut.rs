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

use crate::assets::ASSET_DIGEST_ALGORITHM_SHA256;
use crate::diagnostic::{SnapbackError, SnapbackResult};
pub(crate) use snapback_kernel::assets_cut::*;

fn cut_error(code: &str, message: impl Into<String>) -> SnapbackError {
    SnapbackError::error(code, "assets", message.into())
}

fn manifest_invalid(message: impl Into<String>) -> SnapbackError {
    cut_error("SNAPBACK_ASSET_IMPORT_MANIFEST_INVALID", message)
}
/// Resolve one manifest blob path without letting the manifest select a file
/// outside the cut. The lexical spelling is closed before any target is
/// inspected; canonicalization then catches symlink escapes before callers
/// open or hash the object.
///
/// @ref LLP 0044#consistent-cut-exportimport-dated-design-addition-2026-07-31 —
/// refuse-partial verification covers only the cut's digest-addressed blob
/// objects, never arbitrary host files named by an import manifest.
pub fn resolve_import_blob_path(
    dir: &std::path::Path,
    object_path: &str,
) -> SnapbackResult<std::path::PathBuf> {
    let relative = std::path::Path::new(object_path);
    let digest = object_path.strip_prefix("blobs/sha256/").ok_or_else(|| {
        manifest_invalid("blob object path must use the blobs/sha256/<digest> spelling")
    })?;
    if relative.as_os_str().is_empty()
        || relative.is_absolute()
        || relative.components().any(|component| {
            matches!(
                component,
                std::path::Component::ParentDir
                    | std::path::Component::RootDir
                    | std::path::Component::Prefix(_)
            )
        })
        || digest.len() != 64
        || !digest
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(manifest_invalid(
            "blob object path must be blobs/sha256/ followed by 64 lowercase hexadecimal characters",
        ));
    }

    let root = std::fs::canonicalize(dir).map_err(|_| {
        cut_error(
            "SNAPBACK_ASSET_IMPORT_INCOMPLETE",
            "cut directory could not be resolved",
        )
    })?;
    let joined = dir.join(relative);
    let resolved = std::fs::canonicalize(&joined).map_err(|_| {
        cut_error(
            "SNAPBACK_ASSET_IMPORT_INCOMPLETE",
            format!("blob object {object_path} is missing"),
        )
    })?;
    if !resolved.starts_with(&root) {
        return Err(manifest_invalid(
            "blob object path resolves outside the cut directory",
        ));
    }
    Ok(resolved)
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
        let path = resolve_import_blob_path(dir, &blob.object_path)?;
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
        "grantCount": manifest.grants.len(),
        "collectionItemCount": manifest.collection_items.len(),
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
            grants: Vec::new(),
            collection_items: Vec::new(),
            quota: AssetCutQuotaV1 {
                settled_logical_bytes: 0,
                ready_asset_count: 0,
                grant_count: 0,
                collection_item_count: 0,
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

    fn write_manifest(dir: &std::path::Path, manifest: &mut AssetCutManifestV1) {
        manifest.manifest_digest = cut_manifest_digest(manifest).expect("manifest digest");
        std::fs::write(
            dir.join(ASSET_CUT_MANIFEST_FILE),
            serde_json::to_string(manifest).expect("encode manifest"),
        )
        .expect("write manifest");
    }

    fn manifest_with_blob(object_path: &str, digest: &str, byte_length: u64) -> AssetCutManifestV1 {
        let mut manifest = manifest_fixture();
        manifest.blobs.push(AssetCutBlobV1 {
            blob_id: "blob-1".to_owned(),
            digest_algorithm: ASSET_DIGEST_ALGORITHM_SHA256.to_owned(),
            digest: digest.to_owned(),
            byte_length,
            detected_content_type: "application/octet-stream".to_owned(),
            canonicalization_policy: "identity".to_owned(),
            object_path: object_path.to_owned(),
        });
        manifest
    }

    #[test]
    fn validate_export_dir_refuses_traversal_and_absolute_blob_paths_before_read() {
        for object_path in ["../etc/passwd", "/etc/passwd"] {
            let dir = tempfile::tempdir().expect("tempdir");
            let mut manifest = manifest_with_blob(object_path, &"0".repeat(64), 0);
            write_manifest(dir.path(), &mut manifest);

            let error = validate_export_dir(dir.path()).expect_err("unsafe path must refuse");
            assert_eq!(
                error.diagnostic.code,
                "SNAPBACK_ASSET_IMPORT_MANIFEST_INVALID"
            );
            assert!(
                !error
                    .diagnostic
                    .message
                    .contains("does not match the manifest")
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn validate_export_dir_refuses_symlink_escape_without_hashing_target() {
        use sha2::Digest as _;
        use std::os::unix::fs::symlink;

        let scratch = tempfile::tempdir().expect("scratch");
        let cut = scratch.path().join("cut");
        std::fs::create_dir_all(cut.join(ASSET_CUT_BLOB_DIR)).expect("blob directory");
        let outside = scratch.path().join("outside-secret");
        let outside_bytes = b"outside bytes must never be hashed";
        std::fs::write(&outside, outside_bytes).expect("outside file");
        let observed_digest = format!("{:x}", sha2::Sha256::digest(outside_bytes));
        let digest = "a".repeat(64);
        let object_path = format!("{ASSET_CUT_BLOB_DIR}/{digest}");
        symlink(&outside, cut.join(&object_path)).expect("escape symlink");
        let mut manifest = manifest_with_blob(&object_path, &digest, 999_999);
        write_manifest(&cut, &mut manifest);

        let error = validate_export_dir(&cut).expect_err("symlink escape must refuse");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_ASSET_IMPORT_MANIFEST_INVALID"
        );
        assert_eq!(
            error.diagnostic.message,
            "blob object path resolves outside the cut directory"
        );
        assert!(!error.diagnostic.message.contains(&observed_digest));
        assert!(
            !error
                .diagnostic
                .message
                .contains(&outside_bytes.len().to_string())
        );
    }

    #[test]
    fn validate_export_dir_accepts_canonical_digest_object_path() {
        use sha2::Digest as _;

        let dir = tempfile::tempdir().expect("tempdir");
        let bytes = b"valid cut object";
        let digest = format!("{:x}", sha2::Sha256::digest(bytes));
        let object_path = format!("{ASSET_CUT_BLOB_DIR}/{digest}");
        std::fs::create_dir_all(dir.path().join(ASSET_CUT_BLOB_DIR)).expect("blob directory");
        std::fs::write(dir.path().join(&object_path), bytes).expect("blob object");
        let mut manifest = manifest_with_blob(&object_path, &digest, bytes.len() as u64);
        write_manifest(dir.path(), &mut manifest);

        validate_export_dir(dir.path()).expect("canonical object path verifies");
    }
}
