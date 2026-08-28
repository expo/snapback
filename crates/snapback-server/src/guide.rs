//! The build-bound Snapback Guide corpus.
//!
//! The `snapback-guide-embed` build script generates the file table from
//! `guide/**`, excluding retrieval eval evidence. Handlers perform exact lookups
//! in this closed table, so URL paths cannot escape into the checkout and a
//! running server always serves the documentation snapshot compiled into it.
//!
//! @ref LLP 0061#4-distribution-and-discovery — served-guide §4a: the
//! server is the version authority for the embedded, read-only guide channel.

use serde_json::{Value, json};
use sha2::{Digest as _, Sha256};
use std::sync::LazyLock;

use snapback_types::guide_artifact::{
    ARTIFACT_MAGIC_V2, CONTENT_HASH_DIAGNOSTICS_REGISTRY_LABEL, CONTENT_HASH_REGISTRY_LABEL,
    CONTENT_HASH_RESOURCE_SEPARATOR, DIAGNOSTICS_REGISTRY_PATH, MANIFEST_PATH,
    MAX_RECORD_DECODED_BYTES, MAX_TOTAL_DECODED_BYTES, RECORD_ENCODING_DEFLATE,
    RECORD_ENCODING_STORED, RECORD_HEADER_BYTES, REGISTRY_PATH, REQUIRED_GUIDE_PATHS,
};

unsafe extern "C" {
    fn snapback_embedded_guide_bytes_ptr_v1() -> *const u8;
    fn snapback_embedded_guide_bytes_len_v1() -> usize;
    fn snapback_committed_guide_manifest_ptr_v1() -> *const u8;
    fn snapback_committed_guide_manifest_len_v1() -> usize;
}

const ARTIFACT_MAGIC: &[u8] = ARTIFACT_MAGIC_V2;
const CONTENT_HASH_LENGTH: usize = 64;

#[derive(Clone, Copy, Debug)]
pub struct EmbeddedGuideFile {
    pub path: &'static str,
    pub bytes: &'static [u8],
    pub content_type: &'static str,
}

#[derive(Debug)]
struct EmbeddedGuideData {
    content_hash: &'static str,
    files: Vec<EmbeddedGuideFile>,
    section_flat_paths: Vec<&'static str>,
}

static EMBEDDED_GUIDE: LazyLock<EmbeddedGuideData> = LazyLock::new(|| {
    parse_embedded_guide(embedded_guide_bytes())
        .unwrap_or_else(|error| panic!("malformed embedded Guide artifact: {error}"))
});

pub static GUIDE_CONTENT_SHA256: LazyLock<&'static str> =
    LazyLock::new(|| EMBEDDED_GUIDE.content_hash);

pub static EMBEDDED_GUIDE_FILES: LazyLock<&'static [EmbeddedGuideFile]> =
    LazyLock::new(|| EMBEDDED_GUIDE.files.as_slice());

pub static SECTION_FLAT_PATHS: LazyLock<&'static [&'static str]> =
    LazyLock::new(|| EMBEDDED_GUIDE.section_flat_paths.as_slice());

pub const INDEX_PATH: &str = snapback_types::guide_artifact::INDEX_PATH;
pub const FLAT_PATH: &str = snapback_types::guide_artifact::FLAT_PATH;

static SERVED_GUIDE_MANIFEST: LazyLock<Value> = LazyLock::new(|| {
    let raw = file(MANIFEST_PATH).expect("embedded Guide manifest is present");
    let mut manifest: Value =
        serde_json::from_slice(raw.bytes).expect("embedded Guide manifest must remain valid JSON");
    assert!(
        manifest.get("buildIdentity").is_none(),
        "embedded Guide artifact must be identity-free"
    );
    let content_hash = manifest
        .get("contentHash")
        .and_then(Value::as_str)
        .expect("embedded Guide manifest carries contentHash")
        .to_owned();
    manifest
        .as_object_mut()
        .expect("embedded Guide manifest is an object")
        .insert(
            "buildIdentity".to_owned(),
            json!({
                "sourceDigest": format!("sha256:{content_hash}"),
                "commit": crate::identity::git_commit(),
            }),
        );
    manifest
});

static SERVED_GUIDE_MANIFEST_BYTES: LazyLock<Vec<u8>> = LazyLock::new(|| {
    let mut bytes = serde_json::to_vec_pretty(manifest())
        .expect("runtime-stamped Guide manifest must serialize");
    bytes.push(b'\n');
    bytes
});

pub fn file(path: &str) -> Option<&'static EmbeddedGuideFile> {
    EMBEDDED_GUIDE_FILES
        .iter()
        .find(|candidate| candidate.path == path)
}

/// Return the runtime projection of the embedded manifest. The identity is
/// stamped from the enclosing binary's leaf-owned build fact, while every
/// semantic manifest field remains the inert artifact's checked content.
///
/// @ref LLP 0316#phase-4--leaf-crates-for-non-rust-inputs — a commit changes
/// runtime identity without rebuilding the Guide artifact producer.
pub fn manifest() -> &'static Value {
    &SERVED_GUIDE_MANIFEST
}

pub fn served_file(path: &str) -> Option<EmbeddedGuideFile> {
    let file = file(path)?;
    if path == MANIFEST_PATH {
        Some(EmbeddedGuideFile {
            bytes: SERVED_GUIDE_MANIFEST_BYTES.as_slice(),
            ..*file
        })
    } else {
        Some(*file)
    }
}

/// Decode the only build-generated Guide artifact.
///
/// The format is deliberately small and strict: magic/version bytes, the
/// 64-byte lowercase hexadecimal content hash, a big-endian u32 file count,
/// then sorted records of `u32 path length`, `u64 content length`, UTF-8 path,
/// and content bytes. Committed code validates the required corpus closure,
/// UTF-8 text, section-flat table, manifest identity, and the content digest
/// recomputed from its hash-bound records. `include_bytes!` makes every
/// producer byte a byte string literal; even bytes spelling an `impl`, macro,
/// or item are data.
// @ref LLP 0284#37-what-is-not-an-invariant-honest-limits — the generated
// boundary is inert data rather than expansion-visible Rust tokens.
/// Expand one record payload to the bytes every other consumer sees.
///
/// A stored record is returned as a zero-copy slice of the embedded artifact,
/// exactly as v1 behaved. A deflated record is expanded into an owned buffer
/// that is then leaked: the Guide is decoded once per process inside a
/// `LazyLock` and lives as long as the process would have held the
/// `include_bytes!` blob it replaces, so the leak has the same lifetime the
/// borrowed slice had. Keeping the `&'static [u8]` is what lets every existing
/// consumer — HTTP bodies, MCP resources, the CLI, the reference registries —
/// stay untouched.
// @ref LLP 0314.002#4-open-questions — OQ2's eager-retain branch: an evicting
// cache cannot back the outstanding `'static` borrows this API hands out.
fn decode_guide_record(
    encoding: u8,
    stored: &'static [u8],
    decoded_length: usize,
    index: usize,
    path: &str,
) -> Result<&'static [u8], String> {
    match encoding {
        RECORD_ENCODING_STORED => {
            if stored.len() != decoded_length {
                return Err(format!(
                    "file {index} stored record for {path} declares a different decoded length"
                ));
            }
            Ok(stored)
        }
        RECORD_ENCODING_DEFLATE => {
            use std::io::Read;
            // Capacity is the already-bounded declared length, and the reader
            // is capped one byte beyond it so a stream that expands past its
            // declaration is refused rather than grown into.
            let mut decoded = Vec::with_capacity(decoded_length);
            let limit = u64::try_from(decoded_length)
                .map_err(|_| format!("file {index} decoded length exceeds u64"))?
                .saturating_add(1);
            flate2::read::DeflateDecoder::new(stored)
                .take(limit)
                .read_to_end(&mut decoded)
                .map_err(|error| format!("file {index} for {path} failed to inflate: {error}"))?;
            if decoded.len() != decoded_length {
                return Err(format!(
                    "file {index} for {path} inflated to {} bytes, not the declared {decoded_length}",
                    decoded.len()
                ));
            }
            Ok(Box::leak(decoded.into_boxed_slice()))
        }
        other => Err(format!(
            "file {index} for {path} uses unknown record encoding {other}"
        )),
    }
}

fn parse_embedded_guide(bytes: &'static [u8]) -> Result<EmbeddedGuideData, String> {
    let committed_manifest: serde_json::Value =
        serde_json::from_slice(committed_guide_manifest_bytes())
            .map_err(|error| format!("committed Guide manifest is not valid JSON: {error}"))?;
    let expected_content_hash = committed_manifest
        .get("contentHash")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "committed Guide manifest has no string contentHash".to_owned())?;
    parse_embedded_guide_with_expected_content_hash(bytes, expected_content_hash)
}

fn embedded_guide_bytes() -> &'static [u8] {
    // SAFETY: the Guide leaf exports process-lifetime embedded bytes and their
    // exact length under this versioned symbol pair.
    unsafe {
        static_bytes(
            snapback_embedded_guide_bytes_ptr_v1(),
            snapback_embedded_guide_bytes_len_v1(),
            "embedded Guide artifact",
        )
    }
}

fn committed_guide_manifest_bytes() -> &'static [u8] {
    // SAFETY: the Guide leaf exports process-lifetime embedded bytes and their
    // exact length under this versioned symbol pair.
    unsafe {
        static_bytes(
            snapback_committed_guide_manifest_ptr_v1(),
            snapback_committed_guide_manifest_len_v1(),
            "committed Guide manifest",
        )
    }
}

unsafe fn static_bytes(pointer: *const u8, length: usize, label: &str) -> &'static [u8] {
    assert!(
        !pointer.is_null(),
        "Guide leaf returned a null {label} pointer"
    );
    // SAFETY: the caller establishes that the provider owns `length` bytes at
    // `pointer` for the lifetime of the process.
    unsafe { std::slice::from_raw_parts(pointer, length) }
}

fn parse_embedded_guide_with_expected_content_hash(
    bytes: &'static [u8],
    expected_content_hash: &str,
) -> Result<EmbeddedGuideData, String> {
    let mut input = ArtifactReader::new(bytes);
    input.expect_bytes(ARTIFACT_MAGIC, "magic/version")?;
    let content_hash_bytes = input.read_exact(CONTENT_HASH_LENGTH, "content hash")?;
    let content_hash = std::str::from_utf8(content_hash_bytes)
        .map_err(|_| "content hash is not UTF-8".to_owned())?;
    if !content_hash
        .bytes()
        .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err("content hash is not 64 lowercase hexadecimal bytes".to_owned());
    }

    let file_count = input.read_u32("file count")? as usize;
    if file_count == 0 {
        return Err("file table is empty".to_owned());
    }
    if file_count > input.remaining() / RECORD_HEADER_BYTES {
        return Err("file count exceeds the remaining artifact".to_owned());
    }

    let mut files = Vec::with_capacity(file_count);
    let mut previous_path: Option<&str> = None;
    let mut total_decoded: u64 = 0;
    for index in 0..file_count {
        let path_length = input.read_u32("path length")? as usize;
        let encoding = input.read_u8("record encoding")?;
        let stored_length_u64 = input.read_u64("stored length")?;
        let decoded_length_u64 = input.read_u64("decoded length")?;
        let stored_length = usize::try_from(stored_length_u64)
            .map_err(|_| format!("file {index} stored length exceeds usize"))?;
        let decoded_length = usize::try_from(decoded_length_u64)
            .map_err(|_| format!("file {index} decoded length exceeds usize"))?;
        // Bound the declared expansion before allocating anything for it: a
        // stored length is bounded by the artifact, a decoded length is not.
        // @ref LLP 0314.002#34-bounded-decoding
        if decoded_length_u64 > MAX_RECORD_DECODED_BYTES {
            return Err(format!(
                "file {index} decoded length {decoded_length_u64} exceeds the per-record ceiling"
            ));
        }
        total_decoded = total_decoded.saturating_add(decoded_length_u64);
        if total_decoded > MAX_TOTAL_DECODED_BYTES {
            return Err("decoded corpus exceeds the aggregate ceiling".to_owned());
        }
        let path_bytes = input.read_exact(path_length, "path")?;
        let path = std::str::from_utf8(path_bytes)
            .map_err(|_| format!("file {index} path is not UTF-8"))?;
        validate_guide_path(path, index)?;
        if previous_path.is_some_and(|previous| previous >= path) {
            return Err(format!("file {index} path is not strictly sorted: {path}"));
        }
        let stored_bytes = input.read_exact(stored_length, "file content")?;
        let file_bytes = decode_guide_record(
            encoding,
            stored_bytes,
            decoded_length,
            index,
            path,
        )?;
        let content_type = guide_content_type(path);
        if content_type != "application/octet-stream" {
            std::str::from_utf8(file_bytes)
                .map_err(|_| format!("file {index} content for {path} is not UTF-8"))?;
        }
        files.push(EmbeddedGuideFile {
            path,
            bytes: file_bytes,
            content_type,
        });
        previous_path = Some(path);
    }
    input.finish()?;

    validate_required_corpus(&files)?;

    let section_flat_paths = files
        .iter()
        .map(|file| file.path)
        .filter(|path| is_section_flat_path(path))
        .collect::<Vec<_>>();
    if section_flat_paths.is_empty() {
        return Err("section-flat path table is empty".to_owned());
    }

    validate_content_hash(content_hash, expected_content_hash, &files)?;

    Ok(EmbeddedGuideData {
        content_hash,
        files,
        section_flat_paths,
    })
}

fn validate_required_corpus(files: &[EmbeddedGuideFile]) -> Result<(), String> {
    for required in REQUIRED_GUIDE_PATHS {
        if embedded_file(files, required).is_none() {
            return Err(format!("required Guide file is missing: {required}"));
        }
    }
    Ok(())
}

fn embedded_file<'a>(files: &'a [EmbeddedGuideFile], path: &str) -> Option<&'a EmbeddedGuideFile> {
    files
        .binary_search_by(|candidate| candidate.path.cmp(path))
        .ok()
        .map(|index| &files[index])
}

fn validate_content_hash(
    stored_content_hash: &str,
    expected_content_hash: &str,
    files: &[EmbeddedGuideFile],
) -> Result<(), String> {
    // @ref LLP 0194#design — the served identity binds the whole flat and
    // both non-Markdown registries under the Guide generator's stable domain.
    let flat = embedded_file(files, FLAT_PATH).expect("required corpus includes whole flat");
    let registry =
        embedded_file(files, REGISTRY_PATH).expect("required corpus includes symbol registry");
    let diagnostics = embedded_file(files, DIAGNOSTICS_REGISTRY_PATH)
        .expect("required corpus includes diagnostics registry");
    let mut digest = Sha256::new();
    digest.update(flat.bytes);
    digest.update(CONTENT_HASH_RESOURCE_SEPARATOR);
    digest.update(CONTENT_HASH_REGISTRY_LABEL.as_bytes());
    digest.update(b"\0");
    digest.update(registry.bytes);
    digest.update(CONTENT_HASH_RESOURCE_SEPARATOR);
    digest.update(CONTENT_HASH_DIAGNOSTICS_REGISTRY_LABEL.as_bytes());
    digest.update(b"\0");
    digest.update(diagnostics.bytes);
    let decoded_content_hash = format!("{:x}", digest.finalize());
    if stored_content_hash != decoded_content_hash {
        return Err(format!(
            "content hash does not match decoded records: stored {stored_content_hash}, decoded {decoded_content_hash}"
        ));
    }
    if stored_content_hash != expected_content_hash {
        return Err(format!(
            "stored content hash does not match committed Guide manifest: stored {stored_content_hash}, committed {expected_content_hash}"
        ));
    }

    let manifest = embedded_file(files, MANIFEST_PATH).expect("required corpus includes manifest");
    let manifest: serde_json::Value = serde_json::from_slice(manifest.bytes)
        .map_err(|error| format!("Guide manifest is not valid JSON: {error}"))?;
    if manifest.get("buildIdentity").is_some() {
        return Err("Guide artifact manifest unexpectedly carries buildIdentity".to_owned());
    }
    let manifest_content_hash = manifest
        .get("contentHash")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "Guide manifest has no string contentHash".to_owned())?;
    if manifest_content_hash != stored_content_hash {
        return Err(format!(
            "Guide manifest contentHash does not match stored content hash: manifest {manifest_content_hash}, stored {stored_content_hash}"
        ));
    }
    Ok(())
}

fn validate_guide_path(path: &str, index: usize) -> Result<(), String> {
    if path.is_empty()
        || path.starts_with('/')
        || path.contains('\\')
        || path.bytes().any(|byte| byte.is_ascii_control())
        || path
            .split('/')
            .any(|segment| segment.is_empty() || segment == "." || segment == "..")
    {
        return Err(format!("file {index} has non-canonical path {path:?}"));
    }
    Ok(())
}

fn is_section_flat_path(path: &str) -> bool {
    path != FLAT_PATH && path.starts_with("guide-flat.") && path.ends_with(".generated.md")
}

fn guide_content_type(path: &str) -> &'static str {
    if path.ends_with(".md") {
        "text/markdown; charset=utf-8"
    } else if path.ends_with(".json") {
        "application/json; charset=utf-8"
    } else {
        "application/octet-stream"
    }
}

struct ArtifactReader {
    bytes: &'static [u8],
    offset: usize,
}

impl ArtifactReader {
    fn new(bytes: &'static [u8]) -> Self {
        Self { bytes, offset: 0 }
    }

    fn remaining(&self) -> usize {
        self.bytes.len() - self.offset
    }

    fn expect_bytes(&mut self, expected: &[u8], label: &str) -> Result<(), String> {
        if self.read_exact(expected.len(), label)? != expected {
            return Err(format!("invalid {label}"));
        }
        Ok(())
    }

    fn read_exact(&mut self, length: usize, label: &str) -> Result<&'static [u8], String> {
        let end = self
            .offset
            .checked_add(length)
            .ok_or_else(|| format!("{label} length overflow"))?;
        if end > self.bytes.len() {
            return Err(format!(
                "truncated {label} at byte {}: need {length}, have {}",
                self.offset,
                self.remaining()
            ));
        }
        let value = &self.bytes[self.offset..end];
        self.offset = end;
        Ok(value)
    }

    fn read_u8(&mut self, label: &str) -> Result<u8, String> {
        Ok(self.read_exact(1, label)?[0])
    }

    fn read_u32(&mut self, label: &str) -> Result<u32, String> {
        let bytes: [u8; 4] = self
            .read_exact(4, label)?
            .try_into()
            .expect("reader returned four bytes");
        Ok(u32::from_be_bytes(bytes))
    }

    fn read_u64(&mut self, label: &str) -> Result<u64, String> {
        let bytes: [u8; 8] = self
            .read_exact(8, label)?
            .try_into()
            .expect("reader returned eight bytes");
        Ok(u64::from_be_bytes(bytes))
    }

    fn finish(self) -> Result<(), String> {
        if self.remaining() != 0 {
            return Err(format!("{} trailing artifact byte(s)", self.remaining()));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ZERO_CONTENT_HASH: &str =
        "0000000000000000000000000000000000000000000000000000000000000000";
    const TEST_CONTENT_HASH: &str =
        "81a75c57131c0b9bc5501039bad2ea0dbaeab81a5d8c3a75700a39e309451d22";

    fn test_artifact(files: &[(&str, &[u8])]) -> &'static [u8] {
        test_artifact_with_hash(files, ZERO_CONTENT_HASH)
    }

    fn test_artifact_with_hash(files: &[(&str, &[u8])], content_hash: &str) -> &'static [u8] {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(ARTIFACT_MAGIC);
        bytes.extend_from_slice(content_hash.as_bytes());
        bytes.extend_from_slice(&(files.len() as u32).to_be_bytes());
        for (path, content) in files {
            let (encoding, stored) = snapback_types::guide_artifact::encode_guide_record(content);
            bytes.extend_from_slice(&(path.len() as u32).to_be_bytes());
            bytes.push(encoding);
            bytes.extend_from_slice(&(stored.len() as u64).to_be_bytes());
            bytes.extend_from_slice(&(content.len() as u64).to_be_bytes());
            bytes.extend_from_slice(path.as_bytes());
            bytes.extend_from_slice(&stored);
        }
        Box::leak(bytes.into_boxed_slice())
    }

    /// Build one v2 record with fully caller-controlled header fields, so a
    /// test can express shapes the honest encoder never emits.
    fn raw_record(path: &str, encoding: u8, stored: &[u8], decoded_length: u64) -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&(path.len() as u32).to_be_bytes());
        bytes.push(encoding);
        bytes.extend_from_slice(&(stored.len() as u64).to_be_bytes());
        bytes.extend_from_slice(&decoded_length.to_be_bytes());
        bytes.extend_from_slice(path.as_bytes());
        bytes.extend_from_slice(stored);
        bytes
    }

    fn artifact_with_raw_records(records: &[Vec<u8>]) -> &'static [u8] {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(ARTIFACT_MAGIC);
        bytes.extend_from_slice(ZERO_CONTENT_HASH.as_bytes());
        bytes.extend_from_slice(&(records.len() as u32).to_be_bytes());
        for record in records {
            bytes.extend_from_slice(record);
        }
        Box::leak(bytes.into_boxed_slice())
    }

    // @ref LLP 0314.002#32-a-bit-stable-encoder-normatively-required — Phase 2
    // authenticates the container with one digest produced by two callers, so
    // the encoder must be a pure function of its input.
    #[test]
    fn record_encoder_is_bit_stable_and_round_trips() {
        let payload = "# Guide\n".repeat(4096);
        let payload = payload.as_bytes();
        let (first_encoding, first) = snapback_types::guide_artifact::encode_guide_record(payload);
        let (second_encoding, second) = snapback_types::guide_artifact::encode_guide_record(payload);
        assert_eq!(first_encoding, RECORD_ENCODING_DEFLATE);
        assert_eq!(first_encoding, second_encoding);
        assert_eq!(first, second, "encoder is not bit-stable across invocations");
        assert!(first.len() < payload.len());

        let stored: &'static [u8] = Box::leak(first.into_boxed_slice());
        let decoded =
            decode_guide_record(first_encoding, stored, payload.len(), 0, "index.md").unwrap();
        assert_eq!(decoded, payload, "round trip changed the bytes");
    }

    #[test]
    fn incompressible_records_are_stored_verbatim() {
        // A short payload cannot be shrunk by deflate framing.
        let payload = b"x";
        let (encoding, stored) = snapback_types::guide_artifact::encode_guide_record(payload);
        assert_eq!(encoding, RECORD_ENCODING_STORED);
        assert_eq!(stored, payload);
    }

    // @ref LLP 0314.002#34-bounded-decoding — a declared decoded length is an
    // expansion bomb unless every one of these shapes is refused.
    #[test]
    fn hostile_record_headers_are_refused() {
        let unknown = artifact_with_raw_records(&[raw_record("index.md", 7, b"abc", 3)]);
        assert!(
            parse_embedded_guide(unknown)
                .unwrap_err()
                .contains("unknown record encoding 7"),
            "unknown encoding tag must be refused"
        );

        let lying = artifact_with_raw_records(&[raw_record(
            "index.md",
            RECORD_ENCODING_STORED,
            b"abc",
            99,
        )]);
        assert!(
            parse_embedded_guide(lying)
                .unwrap_err()
                .contains("declares a different decoded length"),
            "stored record must agree with its declared decoded length"
        );

        let oversized = artifact_with_raw_records(&[raw_record(
            "index.md",
            RECORD_ENCODING_DEFLATE,
            b"abc",
            MAX_RECORD_DECODED_BYTES + 1,
        )]);
        assert!(
            parse_embedded_guide(oversized)
                .unwrap_err()
                .contains("exceeds the per-record ceiling"),
            "per-record decoded ceiling must bound the declared length"
        );

        // A real deflate stream whose expansion is larger than declared.
        let payload = vec![b'a'; 4096];
        let (encoding, stored) = snapback_types::guide_artifact::encode_guide_record(&payload);
        assert_eq!(encoding, RECORD_ENCODING_DEFLATE);
        let understated =
            artifact_with_raw_records(&[raw_record("index.md", encoding, &stored, 16)]);
        let error = parse_embedded_guide(understated).unwrap_err();
        assert!(
            error.contains("not the declared") || error.contains("failed to inflate"),
            "an over-expanding stream must be refused, got: {error}"
        );
    }

    fn complete_test_files(index: &'static [u8]) -> Vec<(&'static str, &'static [u8])> {
        vec![
            ("capabilities.md", b"# Capabilities"),
            ("guide-flat.generated.md", b"# Whole Guide"),
            ("guide-flat.test.generated.md", b"# Test Section"),
            (
                "guide-manifest.generated.json",
                br#"{"contentHash":"81a75c57131c0b9bc5501039bad2ea0dbaeab81a5d8c3a75700a39e309451d22"}"#,
            ),
            ("index.md", index),
            ("reference/diagnostics-registry.json", b"{}"),
            ("reference/diagnostics.md", b"# Diagnostics"),
            ("reference/index.md", b"# Reference"),
            ("reference/registry.json", b"{}"),
        ]
    }

    #[test]
    fn required_projection_inputs_are_embedded_and_eval_runs_are_not() {
        for path in REQUIRED_GUIDE_PATHS {
            assert!(file(path).is_some(), "missing embedded guide file {path}");
        }
        assert!(
            EMBEDDED_GUIDE_FILES
                .iter()
                .all(|entry| !entry.path.starts_with("eval-runs/"))
        );
        assert!(!SECTION_FLAT_PATHS.is_empty());
        for path in SECTION_FLAT_PATHS.iter() {
            assert!(file(path).is_some(), "missing embedded section flat {path}");
        }
    }

    #[test]
    fn embedded_manifest_is_identity_free_and_serve_projection_is_runtime_stamped() {
        let raw: Value = serde_json::from_slice(file(MANIFEST_PATH).unwrap().bytes).unwrap();
        assert!(raw.get("buildIdentity").is_none());

        let served = manifest();
        assert_eq!(served["contentHash"], raw["contentHash"]);
        assert_eq!(
            served
                .pointer("/buildIdentity/sourceDigest")
                .and_then(Value::as_str),
            raw["contentHash"]
                .as_str()
                .map(|hash| format!("sha256:{hash}"))
                .as_deref(),
        );
        assert_eq!(
            served
                .pointer("/buildIdentity/commit")
                .and_then(Value::as_str),
            Some(crate::identity::git_commit()),
        );

        let served_bytes = served_file(MANIFEST_PATH).unwrap();
        let round_trip: Value = serde_json::from_slice(served_bytes.bytes).unwrap();
        assert_eq!(round_trip, *served);
    }

    #[test]
    fn malformed_artifacts_fail_instead_of_yielding_an_empty_guide() {
        assert_eq!(
            parse_embedded_guide(b"" as &'static [u8]).unwrap_err(),
            format!(
                "truncated magic/version at byte 0: need {}, have 0",
                ARTIFACT_MAGIC.len()
            )
        );
        let empty = test_artifact(&[]);
        assert_eq!(
            parse_embedded_guide(empty).unwrap_err(),
            "file table is empty"
        );
    }

    #[test]
    fn structurally_valid_but_incomplete_artifacts_fail_closed() {
        let artifact = test_artifact(&[
            ("guide-flat.test.generated.md", b"# Flat"),
            ("index.md", b"# Index"),
        ]);
        assert_eq!(
            parse_embedded_guide(artifact).unwrap_err(),
            "required Guide file is missing: capabilities.md"
        );
    }

    #[test]
    fn every_committed_required_path_is_part_of_the_decoder_closure() {
        for &required in REQUIRED_GUIDE_PATHS {
            let files = complete_test_files(b"# Index")
                .into_iter()
                .filter(|(path, _)| *path != required)
                .collect::<Vec<_>>();
            let artifact = test_artifact(&files);
            assert_eq!(
                parse_embedded_guide(artifact).unwrap_err(),
                format!("required Guide file is missing: {required}")
            );
        }
    }

    #[test]
    fn invalid_text_utf8_fails_closed() {
        let files = complete_test_files(b"# Invalid \xff Markdown");
        let artifact = test_artifact(&files);
        assert_eq!(
            parse_embedded_guide(artifact).unwrap_err(),
            "file 4 content for index.md is not UTF-8"
        );
    }

    #[test]
    fn stored_content_hash_must_match_decoded_records() {
        let files = complete_test_files(b"# Index");
        let artifact = test_artifact(&files);
        let error = parse_embedded_guide(artifact).unwrap_err();
        assert!(
            error.starts_with("content hash does not match decoded records:"),
            "unexpected decoder error: {error}"
        );
    }

    #[test]
    fn content_hash_must_match_the_embedded_and_committed_manifests() {
        let mut files = complete_test_files(b"# Index");
        files[3].1 =
            br#"{"contentHash":"0000000000000000000000000000000000000000000000000000000000000000"}"#;
        let artifact = test_artifact_with_hash(&files, TEST_CONTENT_HASH);
        assert!(
            parse_embedded_guide_with_expected_content_hash(artifact, TEST_CONTENT_HASH)
                .unwrap_err()
                .starts_with("Guide manifest contentHash does not match stored content hash:"),
        );

        let files = complete_test_files(b"# Index");
        let artifact = test_artifact_with_hash(&files, TEST_CONTENT_HASH);
        assert!(
            parse_embedded_guide_with_expected_content_hash(artifact, ZERO_CONTENT_HASH)
                .unwrap_err()
                .starts_with("stored content hash does not match committed Guide manifest:"),
        );
    }

    #[test]
    fn rust_items_in_the_generated_artifact_are_inert_file_bytes() {
        let item = b"impl Public { pub fn leaked() -> i32 { 7 } }";
        let files = complete_test_files(item);
        let artifact = test_artifact_with_hash(&files, TEST_CONTENT_HASH);
        let parsed = parse_embedded_guide_with_expected_content_hash(artifact, TEST_CONTENT_HASH)
            .expect("parse test artifact");
        assert_eq!(
            parsed
                .files
                .iter()
                .find(|file| file.path == "index.md")
                .expect("injected item-bearing payload is present")
                .bytes,
            item
        );
        assert_eq!(parsed.section_flat_paths, ["guide-flat.test.generated.md"]);
    }
}
