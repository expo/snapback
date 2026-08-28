//! Build-time source identity behind a stable native link boundary.
//!
//! This small crate is the only Cargo package whose build script probes Git.
//! The changing values are exported as native symbols so rebuilding this leaf
//! does not change Rust metadata in the kernel and fan out through the runtime
//! tower.

const GIT_COMMIT: &[u8] = env!("SNAPBACK_BUILD_GIT_COMMIT").as_bytes();
const BUILD_DISTRIBUTION: &[u8] = env!("SNAPBACK_BUILD_DISTRIBUTION").as_bytes();
const BUILD_RECIPE: &[u8] = env!("SNAPBACK_BUILD_RECIPE").as_bytes();

#[unsafe(no_mangle)]
pub extern "C" fn snapback_build_git_commit_ptr_v1() -> *const u8 {
    GIT_COMMIT.as_ptr()
}

#[unsafe(no_mangle)]
pub extern "C" fn snapback_build_git_commit_len_v1() -> usize {
    GIT_COMMIT.len()
}

#[unsafe(no_mangle)]
pub extern "C" fn snapback_build_git_dirty_v1() -> u8 {
    u8::from(matches!(env!("SNAPBACK_BUILD_GIT_DIRTY"), "true" | "1"))
}

#[unsafe(no_mangle)]
pub extern "C" fn snapback_build_distribution_ptr_v1() -> *const u8 {
    BUILD_DISTRIBUTION.as_ptr()
}

#[unsafe(no_mangle)]
pub extern "C" fn snapback_build_distribution_len_v1() -> usize {
    BUILD_DISTRIBUTION.len()
}

#[unsafe(no_mangle)]
pub extern "C" fn snapback_build_recipe_ptr_v1() -> *const u8 {
    BUILD_RECIPE.as_ptr()
}

#[unsafe(no_mangle)]
pub extern "C" fn snapback_build_recipe_len_v1() -> usize {
    BUILD_RECIPE.len()
}

/// Anchor both native providers in the final composition target.
#[doc(hidden)]
#[inline(never)]
pub fn link_anchor() -> usize {
    GIT_COMMIT.len()
        ^ BUILD_DISTRIBUTION.len()
        ^ BUILD_RECIPE.len()
        ^ snapback_guide_embed::link_anchor()
}

#[cfg(test)]
#[allow(dead_code)]
#[path = "build_recipe.rs"]
mod build_recipe_tests;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_stamp_is_populated_and_conservative() {
        assert!(!GIT_COMMIT.is_empty());
        assert!(GIT_COMMIT == b"unknown" || GIT_COMMIT.iter().all(|byte| byte.is_ascii_hexdigit()),);
        assert!(matches!(
            BUILD_DISTRIBUTION,
            b"contributor-source" | b"public-package"
        ));
        assert!(BUILD_RECIPE.starts_with(b"{\"schemaVersion\":\"snapback.cargo-build-recipe.v1\""));
        assert!(snapback_build_git_dirty_v1() <= 1);
        assert_ne!(link_anchor(), usize::MAX);
    }
}
