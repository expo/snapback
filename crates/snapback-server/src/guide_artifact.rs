//! Committed format constants shared by the Guide artifact producer and decoder.

#![allow(dead_code)] // The build-script compilation uses only the producer subset.

pub(crate) const INDEX_PATH: &str = "index.md";
pub(crate) const CAPABILITIES_PATH: &str = "capabilities.md";
pub(crate) const MANIFEST_PATH: &str = "guide-manifest.generated.json";
pub(crate) const FLAT_PATH: &str = "guide-flat.generated.md";
pub(crate) const REFERENCE_INDEX_PATH: &str = "reference/index.md";
pub(crate) const REGISTRY_PATH: &str = "reference/registry.json";
pub(crate) const DIAGNOSTICS_PATH: &str = "reference/diagnostics.md";
pub(crate) const DIAGNOSTICS_REGISTRY_PATH: &str = "reference/diagnostics-registry.json";

/// The minimum closed corpus that both production and committed decoding require.
// @ref LLP 0284#37-what-is-not-an-invariant-honest-limits — producer and
// decoder share this committed minimum, while the decoder remains authoritative.
pub(crate) const REQUIRED_GUIDE_PATHS: &[&str] = &[
    INDEX_PATH,
    CAPABILITIES_PATH,
    MANIFEST_PATH,
    FLAT_PATH,
    REFERENCE_INDEX_PATH,
    REGISTRY_PATH,
    DIAGNOSTICS_PATH,
    DIAGNOSTICS_REGISTRY_PATH,
];

pub(crate) const CONTENT_HASH_RESOURCE_SEPARATOR: &[u8] = b"\0guide-resource\0";
pub(crate) const CONTENT_HASH_REGISTRY_LABEL: &str = "guide/reference/registry.json";
pub(crate) const CONTENT_HASH_DIAGNOSTICS_REGISTRY_LABEL: &str =
    "guide/reference/diagnostics-registry.json";
