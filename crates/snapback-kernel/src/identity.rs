//! Runtime projection of the enclosing binary's leaf-owned build identity.
//!
//! The native symbols have a stable ABI: their values may change and force a
//! final relink, but they do not make this kernel crate a Rust dependency of
//! the changing build-identity leaf.

use std::sync::OnceLock;
use uuid::Uuid;

pub use snapback_types::identity::{
    BUILD_DISTRIBUTION_CONTRIBUTOR_SOURCE, BUILD_DISTRIBUTION_PUBLIC_PACKAGE, BinaryIdentity,
};

unsafe extern "C" {
    fn snapback_build_git_commit_ptr_v1() -> *const u8;
    fn snapback_build_git_commit_len_v1() -> usize;
    fn snapback_build_git_dirty_v1() -> u8;
    fn snapback_build_distribution_ptr_v1() -> *const u8;
    fn snapback_build_distribution_len_v1() -> usize;
}

/// Compile-time distribution class used by capability authorities whose trust
/// root differs between a reviewed checkout and a public native package.
#[inline(never)]
pub fn build_distribution() -> &'static str {
    // SAFETY: the identity leaf exports a process-lifetime byte string and its
    // exact length under this versioned symbol pair.
    unsafe {
        static_utf8(
            snapback_build_distribution_ptr_v1(),
            snapback_build_distribution_len_v1(),
            "build distribution",
        )
    }
}

/// The source revision stamped into this build, or `"unknown"` when the
/// checkout could not be identified by the leaf build script.
#[inline(never)]
pub fn git_commit() -> &'static str {
    // SAFETY: the identity leaf exports a process-lifetime byte string and its
    // exact length under this versioned symbol pair.
    unsafe {
        static_utf8(
            snapback_build_git_commit_ptr_v1(),
            snapback_build_git_commit_len_v1(),
            "Git commit",
        )
    }
}

/// Whether the runtime input closure was dirty when the identity leaf built.
/// Unknown probe state is emitted as dirty by the leaf and therefore fails
/// closed here.
#[inline(never)]
pub fn git_dirty() -> bool {
    // SAFETY: this versioned leaf symbol returns only 0 or 1.
    unsafe { snapback_build_git_dirty_v1() != 0 }
}

/// The identity of this running server binary/process.
///
/// @ref LLP 0031#server-binary-identity-on-health — the public health identity
/// remains tied to the exact enclosing binary while Git invalidation stops at
/// its leaf plus the required final relink.
#[inline(never)]
pub fn binary_identity() -> BinaryIdentity {
    BinaryIdentity {
        crate_version: env!("CARGO_PKG_VERSION").to_owned(),
        git_commit: git_commit().to_owned(),
        git_dirty: git_dirty(),
        build_profile: if cfg!(debug_assertions) {
            "debug".to_owned()
        } else {
            "release".to_owned()
        },
        startup_nonce: startup_nonce().to_owned(),
    }
}

fn startup_nonce() -> &'static str {
    static NONCE: OnceLock<String> = OnceLock::new();
    NONCE.get_or_init(|| Uuid::now_v7().to_string())
}

unsafe fn static_utf8(pointer: *const u8, length: usize, label: &str) -> &'static str {
    assert!(
        !pointer.is_null(),
        "identity leaf returned a null {label} pointer"
    );
    // SAFETY: the caller establishes that the provider owns `length` bytes at
    // `pointer` for the lifetime of the process.
    let bytes = unsafe { std::slice::from_raw_parts(pointer, length) };
    std::str::from_utf8(bytes)
        .unwrap_or_else(|_| panic!("identity leaf returned non-UTF-8 {label}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    #[test]
    fn identity_is_populated_and_nonce_is_stable_within_a_process() {
        let a = binary_identity();
        assert_eq!(a.crate_version, env!("CARGO_PKG_VERSION"));
        assert!(!a.crate_version.is_empty());
        let in_git_work_tree = Command::new("git")
            .current_dir(env!("CARGO_MANIFEST_DIR"))
            .args(["rev-parse", "--is-inside-work-tree"])
            .output()
            .is_ok_and(|output| output.status.success());
        if in_git_work_tree {
            assert_ne!(a.git_commit, "unknown");
        }
        assert!(matches!(a.build_profile.as_str(), "debug" | "release"));
        assert!(matches!(
            build_distribution(),
            BUILD_DISTRIBUTION_CONTRIBUTOR_SOURCE | BUILD_DISTRIBUTION_PUBLIC_PACKAGE
        ));
        assert!(!a.startup_nonce.is_empty());
        assert_eq!(a.startup_nonce, binary_identity().startup_nonce);
    }
}
