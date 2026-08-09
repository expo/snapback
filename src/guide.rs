//! The build-bound Snapback Guide corpus.
//!
//! `build.rs` generates the file table from `guide/**`, excluding retrieval
//! eval evidence. Handlers perform exact lookups in this closed table, so URL
//! paths cannot escape into the checkout and a running server always serves
//! the documentation snapshot compiled into its own binary.
//!
//! @ref LLP 0061#4-distribution-and-discovery — served-guide §4a: the
//! server is the version authority for the embedded, read-only guide channel.

#[derive(Clone, Copy, Debug)]
pub struct EmbeddedGuideFile {
    pub path: &'static str,
    pub bytes: &'static [u8],
    pub content_type: &'static str,
}

include!(concat!(env!("OUT_DIR"), "/embedded_guide.rs"));

pub const INDEX_PATH: &str = "index.md";
pub const FLAT_PATH: &str = "guide-flat.generated.md";

pub fn file(path: &str) -> Option<&'static EmbeddedGuideFile> {
    EMBEDDED_GUIDE_FILES
        .iter()
        .find(|candidate| candidate.path == path)
}

#[cfg(test)]
mod tests {
    use super::*;

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
        for path in SECTION_FLAT_PATHS {
            assert!(file(path).is_some(), "missing embedded section flat {path}");
        }
    }
}
