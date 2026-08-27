//! Build-owned inert Snapback Guide artifact.
//!
//! Guide edits rebuild this small leaf. The server decoder consumes the bytes
//! without making the server build script watch `guide/**`.

/// The versioned, length-prefixed Guide file table emitted by this package's
/// build script. The embedded manifest deliberately carries no `buildIdentity`;
/// runtime projections add the enclosing binary identity when they serve it.
///
/// @ref LLP 0316#phase-4--leaf-crates-for-non-rust-inputs — non-Rust Guide
/// invalidation terminates at this leaf before downstream relinking.
pub static EMBEDDED_GUIDE_BYTES: &[u8] =
    include_bytes!(concat!(env!("OUT_DIR"), "/embedded-guide.v1.bin"));

/// The checked manifest is retained separately so the committed decoder can
/// bind the artifact header to the source manifest without making a consuming
/// crate watch `guide/**` directly.
pub static COMMITTED_GUIDE_MANIFEST_BYTES: &[u8] =
    include_bytes!("../../../guide/guide-manifest.generated.json");

/// Stable native boundary used by the server decoder. The Guide corpus changes
/// the bytes behind these symbols without changing Rust metadata in the large
/// transport crate.
#[unsafe(no_mangle)]
pub extern "C" fn snapback_embedded_guide_bytes_ptr_v1() -> *const u8 {
    EMBEDDED_GUIDE_BYTES.as_ptr()
}

#[unsafe(no_mangle)]
pub extern "C" fn snapback_embedded_guide_bytes_len_v1() -> usize {
    EMBEDDED_GUIDE_BYTES.len()
}

#[unsafe(no_mangle)]
pub extern "C" fn snapback_committed_guide_manifest_ptr_v1() -> *const u8 {
    COMMITTED_GUIDE_MANIFEST_BYTES.as_ptr()
}

#[unsafe(no_mangle)]
pub extern "C" fn snapback_committed_guide_manifest_len_v1() -> usize {
    COMMITTED_GUIDE_MANIFEST_BYTES.len()
}

/// A Rust-level anchor for final composition crates. The returned value keeps
/// both embedded byte arrays reachable; callers need not know their contents.
#[doc(hidden)]
#[inline(never)]
pub fn link_anchor() -> usize {
    EMBEDDED_GUIDE_BYTES.len() ^ COMMITTED_GUIDE_MANIFEST_BYTES.len()
}
