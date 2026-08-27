use snapback_types::guide_artifact as artifact;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::{fs, io};

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=../../guide");
    let artifact_path = emit_embedded_guide();
    // The identity leaf watches this producer-owned output rather than
    // declaring a second recursive `guide/**` Cargo input. `links` metadata
    // makes the stable path available to its dependent build script.
    println!("cargo:artifact_path={}", artifact_path.display());
}

/// Emit one inert binary artifact for the committed server decoder.
///
/// @ref LLP 0061#4-distribution-and-discovery — the exact checked Guide
/// snapshot remains embedded and served as a read-only version authority.
/// @ref LLP 0316#phase-4--leaf-crates-for-non-rust-inputs — the artifact is
/// identity-free so a commit cannot invalidate this producer.
fn emit_embedded_guide() -> PathBuf {
    let manifest_dir = PathBuf::from(
        std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is set by cargo"),
    );
    let guide_dir = manifest_dir.join("../../guide");
    let mut files = Vec::new();
    collect_guide_files(&guide_dir, &guide_dir, &mut files).expect("walk the checked guide corpus");
    files.sort();
    assert!(
        files.iter().any(|path| is_section_flat_path(path)),
        "served guide is missing generated section flat projections"
    );
    for required in artifact::REQUIRED_GUIDE_PATHS {
        assert!(
            files.iter().any(|path| path == required),
            "served guide is missing required generated/input file {required}"
        );
    }

    let manifest =
        fs::read(guide_dir.join(artifact::MANIFEST_PATH)).expect("read generated guide manifest");
    let mut embedded_manifest: serde_json::Value =
        serde_json::from_slice(&manifest).expect("generated guide manifest must be valid JSON");
    let content_hash = embedded_manifest
        .get("contentHash")
        .and_then(serde_json::Value::as_str)
        .expect("generated guide manifest carries contentHash")
        .to_owned();
    assert!(
        content_hash.len() == 64
            && content_hash
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)),
        "generated guide contentHash must be a lowercase SHA-256 hex digest"
    );
    let removed_identity = embedded_manifest
        .as_object_mut()
        .expect("generated guide manifest must be an object")
        .remove("buildIdentity")
        .expect("generated guide manifest carries buildIdentity");
    assert!(
        removed_identity
            .get("sourceDigest")
            .and_then(serde_json::Value::as_str)
            .is_some(),
        "generated guide manifest buildIdentity carries sourceDigest"
    );
    let mut embedded_manifest =
        serde_json::to_vec_pretty(&embedded_manifest).expect("serialize identity-free manifest");
    embedded_manifest.push(b'\n');

    let out_dir = PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR is set by cargo"));
    let artifact_path = out_dir.join("embedded-guide.v1.bin");
    let mut output = fs::File::create(&artifact_path).expect("create embedded Guide data artifact");
    output
        .write_all(b"SNAPBACK_EMBEDDED_GUIDE\0\x01")
        .expect("write embedded Guide artifact magic");
    output
        .write_all(content_hash.as_bytes())
        .expect("write embedded Guide content hash");
    write_u32(&mut output, files.len(), "embedded Guide file count");
    for path in files {
        let bytes = if path == artifact::MANIFEST_PATH {
            embedded_manifest.clone()
        } else {
            fs::read(guide_dir.join(&path))
                .unwrap_or_else(|error| panic!("read embedded Guide file {path}: {error}"))
        };
        write_u32(&mut output, path.len(), "embedded Guide path length");
        write_u64(&mut output, bytes.len(), "embedded Guide file length");
        output
            .write_all(path.as_bytes())
            .expect("write embedded Guide path");
        output
            .write_all(&bytes)
            .expect("write embedded Guide file bytes");
    }
    output.flush().expect("flush embedded Guide data artifact");
    artifact_path
}

fn is_section_flat_path(path: &str) -> bool {
    path != artifact::FLAT_PATH
        && path.starts_with("guide-flat.")
        && path.ends_with(".generated.md")
}

fn write_u32(output: &mut impl Write, value: usize, label: &str) {
    let value = u32::try_from(value).unwrap_or_else(|_| panic!("{label} exceeds u32"));
    output
        .write_all(&value.to_be_bytes())
        .unwrap_or_else(|error| panic!("write {label}: {error}"));
}

fn write_u64(output: &mut impl Write, value: usize, label: &str) {
    let value = u64::try_from(value).unwrap_or_else(|_| panic!("{label} exceeds u64"));
    output
        .write_all(&value.to_be_bytes())
        .unwrap_or_else(|error| panic!("write {label}: {error}"));
}

fn collect_guide_files(root: &Path, dir: &Path, files: &mut Vec<String>) -> io::Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            if entry.file_name() != "eval-runs" {
                collect_guide_files(root, &path, files)?;
            }
            continue;
        }
        if path.is_file() {
            files.push(
                path.strip_prefix(root)
                    .expect("guide entry stays beneath guide root")
                    .to_string_lossy()
                    .replace('\\', "/"),
            );
        }
    }
    Ok(())
}
