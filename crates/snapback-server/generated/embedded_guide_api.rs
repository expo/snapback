// Generated API artifact. Its parsed shape and exact bytes are pinned by
// embedded-guide-api-shape.v1.json and checked without executing build.rs.

pub const GUIDE_CONTENT_SHA256: &str =
    include!(concat!(env!("OUT_DIR"), "/guide_content_sha256.expr.rs"));

pub static EMBEDDED_GUIDE_FILES: &[EmbeddedGuideFile] =
    include!(concat!(env!("OUT_DIR"), "/embedded_guide_files.expr.rs"));

pub static SECTION_FLAT_PATHS: &[&str] =
    include!(concat!(env!("OUT_DIR"), "/section_flat_paths.expr.rs"));
