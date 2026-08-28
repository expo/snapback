//! Stable format constants shared by the Guide artifact producer and decoder.

pub const INDEX_PATH: &str = "index.md";
pub const CAPABILITIES_PATH: &str = "capabilities.md";
pub const MANIFEST_PATH: &str = "guide-manifest.generated.json";
pub const FLAT_PATH: &str = "guide-flat.generated.md";
pub const REFERENCE_INDEX_PATH: &str = "reference/index.md";
pub const REGISTRY_PATH: &str = "reference/registry.json";
pub const DIAGNOSTICS_PATH: &str = "reference/diagnostics.md";
pub const DIAGNOSTICS_REGISTRY_PATH: &str = "reference/diagnostics-registry.json";

/// The minimum closed corpus that both production and committed decoding require.
// @ref LLP 0284#37-what-is-not-an-invariant-honest-limits — producer and
// decoder share this committed minimum, while the decoder remains authoritative.
pub const REQUIRED_GUIDE_PATHS: &[&str] = &[
    INDEX_PATH,
    CAPABILITIES_PATH,
    MANIFEST_PATH,
    FLAT_PATH,
    REFERENCE_INDEX_PATH,
    REGISTRY_PATH,
    DIAGNOSTICS_PATH,
    DIAGNOSTICS_REGISTRY_PATH,
];

/// Container magic and version. `\x02` is the version byte: v1 stored every
/// record payload raw, v2 gives each record an encoding tag and a decoded
/// length so payloads can be compressed.
// @ref LLP 0314.002#31-a-breaking-container-version — the tag could not be
// added under `\x01` without silently breaking every v1 decoder.
pub const ARTIFACT_MAGIC_V2: &[u8] = b"SNAPBACK_EMBEDDED_GUIDE\0\x02";

/// Record payload stored verbatim, chosen whenever deflate would not be
/// smaller, so an incompressible record never pays for a codec.
pub const RECORD_ENCODING_STORED: u8 = 0;
/// Record payload stored as raw deflate (RFC 1951, no gzip/zlib wrapper).
///
/// Raw deflate carries no mtime, filename, or OS byte, so the encoder is
/// bit-stable by construction rather than by convention.
pub const RECORD_ENCODING_DEFLATE: u8 = 1;

/// Fixed per-record header width in v2: u32 path length, u8 encoding,
/// u64 stored length, u64 decoded length.
pub const RECORD_HEADER_BYTES: usize = 4 + 1 + 8 + 8;

/// Decoded-size ceilings. The corpus is ~20.7 MB across ~187 records with a
/// 5.2 MB largest record; these bound a hostile or corrupt artifact without
/// constraining honest growth.
// @ref LLP 0314.002#34-bounded-decoding — a declared decoded length is an
// expansion bomb unless it is bounded per record and in aggregate.
pub const MAX_RECORD_DECODED_BYTES: u64 = 64 * 1024 * 1024;
pub const MAX_TOTAL_DECODED_BYTES: u64 = 256 * 1024 * 1024;

/// Encode one record payload, or keep it verbatim when compression does not
/// pay.
///
/// This is the single encoder LLP 0314.000 Phase 2 requires both of its
/// callers to share. It lives in the rank-0 contract leaf precisely so the
/// producer (`snapback-guide-embed`) and any pack-time caller cannot drift
/// apart: Phase 2 authenticates the container with one `artifactSha256`
/// produced by two callers, so the encoder must be a pure function of its
/// input. Raw deflate makes that structural — no mtime, filename, or OS byte
/// to canonicalize.
// @ref LLP 0314.002#32-a-bit-stable-encoder-normatively-required
pub fn encode_guide_record(bytes: &[u8]) -> (u8, Vec<u8>) {
    use std::io::Write as _;
    let mut encoder = flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::best());
    encoder
        .write_all(bytes)
        .expect("deflate into an in-memory buffer cannot fail");
    let deflated = encoder
        .finish()
        .expect("deflate into an in-memory buffer cannot fail");
    if deflated.len() < bytes.len() {
        (RECORD_ENCODING_DEFLATE, deflated)
    } else {
        (RECORD_ENCODING_STORED, bytes.to_vec())
    }
}

pub const CONTENT_HASH_RESOURCE_SEPARATOR: &[u8] = b"\0guide-resource\0";
pub const CONTENT_HASH_REGISTRY_LABEL: &str = "guide/reference/registry.json";
pub const CONTENT_HASH_DIAGNOSTICS_REGISTRY_LABEL: &str =
    "guide/reference/diagnostics-registry.json";
