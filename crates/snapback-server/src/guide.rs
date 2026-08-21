//! The build-bound Snapback Guide corpus.
//!
//! `build.rs` generates the file table from `guide/**`, excluding retrieval
//! eval evidence. Handlers perform exact lookups in this closed table, so URL
//! paths cannot escape into the checkout and a running server always serves
//! the documentation snapshot compiled into its own binary.
//!
//! @ref LLP 0061#4-distribution-and-discovery — served-guide §4a: the
//! server is the version authority for the embedded, read-only guide channel.

use std::sync::LazyLock;

const ARTIFACT_MAGIC: &[u8] = b"SNAPBACK_EMBEDDED_GUIDE\0\x01";
const CONTENT_HASH_LENGTH: usize = 64;
const EMBEDDED_GUIDE_BYTES: &[u8] =
    include_bytes!(concat!(env!("OUT_DIR"), "/embedded-guide.v1.bin"));

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
    parse_embedded_guide(EMBEDDED_GUIDE_BYTES)
        .unwrap_or_else(|error| panic!("malformed embedded Guide artifact: {error}"))
});

pub static GUIDE_CONTENT_SHA256: LazyLock<&'static str> =
    LazyLock::new(|| EMBEDDED_GUIDE.content_hash);

pub static EMBEDDED_GUIDE_FILES: LazyLock<&'static [EmbeddedGuideFile]> =
    LazyLock::new(|| EMBEDDED_GUIDE.files.as_slice());

pub static SECTION_FLAT_PATHS: LazyLock<&'static [&'static str]> =
    LazyLock::new(|| EMBEDDED_GUIDE.section_flat_paths.as_slice());

pub const INDEX_PATH: &str = "index.md";
pub const FLAT_PATH: &str = "guide-flat.generated.md";

pub fn file(path: &str) -> Option<&'static EmbeddedGuideFile> {
    EMBEDDED_GUIDE_FILES
        .iter()
        .find(|candidate| candidate.path == path)
}

/// Decode the only build-generated Guide artifact.
///
/// The format is deliberately small and strict: magic/version bytes, the
/// 64-byte lowercase hexadecimal content hash, a big-endian u32 file count,
/// then sorted records of `u32 path length`, `u64 content length`, UTF-8 path,
/// and opaque content bytes. Section-flat paths and content types are derived
/// under committed code. `include_bytes!` makes every producer byte a byte
/// string literal; even bytes spelling an `impl`, macro, or item are data.
// @ref LLP 0284#37-what-is-not-an-invariant-honest-limits — the generated
// boundary is inert data rather than expansion-visible Rust tokens.
fn parse_embedded_guide(bytes: &'static [u8]) -> Result<EmbeddedGuideData, String> {
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
    if file_count > input.remaining() / 12 {
        return Err("file count exceeds the remaining artifact".to_owned());
    }

    let mut files = Vec::with_capacity(file_count);
    let mut previous_path: Option<&str> = None;
    for index in 0..file_count {
        let path_length = input.read_u32("path length")? as usize;
        let content_length_u64 = input.read_u64("content length")?;
        let content_length = usize::try_from(content_length_u64)
            .map_err(|_| format!("file {index} content length exceeds usize"))?;
        let path_bytes = input.read_exact(path_length, "path")?;
        let path = std::str::from_utf8(path_bytes)
            .map_err(|_| format!("file {index} path is not UTF-8"))?;
        validate_guide_path(path, index)?;
        if previous_path.is_some_and(|previous| previous >= path) {
            return Err(format!("file {index} path is not strictly sorted: {path}"));
        }
        let file_bytes = input.read_exact(content_length, "file content")?;
        files.push(EmbeddedGuideFile {
            path,
            bytes: file_bytes,
            content_type: guide_content_type(path),
        });
        previous_path = Some(path);
    }
    input.finish()?;

    let section_flat_paths = files
        .iter()
        .map(|file| file.path)
        .filter(|path| is_section_flat_path(path))
        .collect::<Vec<_>>();
    if section_flat_paths.is_empty() {
        return Err("section-flat path table is empty".to_owned());
    }

    Ok(EmbeddedGuideData {
        content_hash,
        files,
        section_flat_paths,
    })
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

    fn test_artifact(files: &[(&str, &[u8])]) -> &'static [u8] {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(ARTIFACT_MAGIC);
        bytes
            .extend_from_slice(b"0000000000000000000000000000000000000000000000000000000000000000");
        bytes.extend_from_slice(&(files.len() as u32).to_be_bytes());
        for (path, content) in files {
            bytes.extend_from_slice(&(path.len() as u32).to_be_bytes());
            bytes.extend_from_slice(&(content.len() as u64).to_be_bytes());
            bytes.extend_from_slice(path.as_bytes());
            bytes.extend_from_slice(content);
        }
        Box::leak(bytes.into_boxed_slice())
    }

    #[test]
    fn required_projection_inputs_are_embedded_and_eval_runs_are_not() {
        for path in [
            INDEX_PATH,
            "capabilities.md",
            "guide-manifest.generated.json",
            FLAT_PATH,
            "reference/index.md",
            crate::guide_reference::REGISTRY_PATH,
            crate::guide_reference::DIAGNOSTICS_REGISTRY_PATH,
            "reference/diagnostics.md",
        ] {
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
    fn rust_items_in_the_generated_artifact_are_inert_file_bytes() {
        let item = b"impl Public { pub fn leaked() -> i32 { 7 } }";
        let artifact = test_artifact(&[
            ("guide-flat.test.generated.md", b"# Flat"),
            ("index.md", item),
        ]);
        let parsed = parse_embedded_guide(artifact).expect("parse test artifact");
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
