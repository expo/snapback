//! Server-binary identity: the build/provenance facts that answer
//! "is this MY checkout's binary?" for an externally started, possibly
//! unprovisioned server — before any app functions bundle is loaded.
//!
//! The reuse-provenance scheme (ENG-22753/ENG-22757) verifies a running server
//! by matching `GET /inspect` → `functions.appId`/`bundleHash` against the
//! committed `artifacts.json`. That only works once a functions bundle is
//! loaded, so an externally started unprovisioned server — or a schema-only
//! server (`ensureApp({ schema })`, no functions) like the cursors-web web
//! surfaces — reports no bundle identity and is always refused. This identity
//! rides the ungated `/health` payload so that class of server becomes
//! verifiable by build provenance instead (ENG-22798). Refusal-when-unverifiable
//! stays the default; this only shrinks the unverifiable set.
//!
//! @ref LLP 0031#server-binary-identity-on-health — the ungated public /health
//! carries a build-identity block; build provenance is not an environment leak,
//! so it stays on the public payload (consistent with the D3 sensitivity line).

use serde::{Deserialize, Serialize};
use std::sync::OnceLock;
use uuid::Uuid;

pub const BUILD_DISTRIBUTION_CONTRIBUTOR_SOURCE: &str = "contributor-source";
pub const BUILD_DISTRIBUTION_PUBLIC_PACKAGE: &str = "public-package";

/// Compile-time distribution class used by capability authorities whose trust
/// root differs between a reviewed checkout and a public native package.
pub const fn build_distribution() -> &'static str {
    match option_env!("SNAPBACK_BUILD_DISTRIBUTION") {
        Some(distribution) => distribution,
        None => BUILD_DISTRIBUTION_CONTRIBUTOR_SOURCE,
    }
}

/// The server-binary identity carried on the ungated `/health` payload.
///
/// Fields are camelCase on the wire to match the camelCase inspect payload the
/// JS provenance helpers already read.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BinaryIdentity {
    /// `CARGO_PKG_VERSION` of the snapback crate this binary was built from.
    pub crate_version: String,
    /// The git commit the binary was built at, or `"unknown"` when the build
    /// happened outside a git checkout (or git was unavailable at build time).
    pub git_commit: String,
    /// Whether the working tree was dirty at build time. `true` also stands in
    /// for "unknown" (no clean commit to pin the bytes to), so a build that
    /// cannot be soundly identified is conservatively treated as dirty by
    /// consumers and never enables reuse.
    pub git_dirty: bool,
    /// `"debug"` or `"release"`.
    pub build_profile: String,
    /// A per-process boot id: distinct on every process start, so a restart of
    /// the same binary is observable (the nonce changes) even when the build
    /// identity is unchanged. Not part of the "is this my binary?" verdict — a
    /// caller cannot know the expected nonce of a server it did not spawn — but
    /// it lets a caller that *did* spawn a server confirm the port still answers
    /// the same process.
    pub startup_nonce: String,
}

/// The identity of this running server binary/process. Cheap; recomputed per
/// call (the startup nonce is memoized process-wide).
pub fn binary_identity() -> BinaryIdentity {
    BinaryIdentity {
        crate_version: env!("CARGO_PKG_VERSION").to_owned(),
        git_commit: option_env!("SNAPBACK_BUILD_GIT_COMMIT")
            .unwrap_or("unknown")
            .to_owned(),
        // Only a build.rs-proven-clean tree emits "false"/"0"; anything else
        // (including an unset stamp) is treated as dirty.
        git_dirty: !matches!(
            option_env!("SNAPBACK_BUILD_GIT_DIRTY"),
            Some("false") | Some("0")
        ),
        build_profile: if cfg!(debug_assertions) {
            "debug".to_owned()
        } else {
            "release".to_owned()
        },
        startup_nonce: startup_nonce().to_owned(),
    }
}

/// The per-process boot id, generated once on first read and stable thereafter.
/// A UUIDv7 is time-ordered and random, so it is unique per process start.
fn startup_nonce() -> &'static str {
    static NONCE: OnceLock<String> = OnceLock::new();
    NONCE.get_or_init(|| Uuid::now_v7().to_string())
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
            assert_ne!(
                a.git_commit, "unknown",
                "a build inside this git worktree must be stamped by build.rs",
            );
            assert!(
                option_env!("SNAPBACK_BUILD_GIT_COMMIT").is_some(),
                "snapback-types must receive its package-local build-script stamp",
            );
        }
        assert!(matches!(a.build_profile.as_str(), "debug" | "release"));
        assert!(matches!(
            build_distribution(),
            BUILD_DISTRIBUTION_CONTRIBUTOR_SOURCE | BUILD_DISTRIBUTION_PUBLIC_PACKAGE
        ));
        assert!(!a.startup_nonce.is_empty());
        // Same process -> same nonce (the "still the same process" signal).
        let b = binary_identity();
        assert_eq!(a.startup_nonce, b.startup_nonce);
        // git_commit is either "unknown" or a plausible hex sha.
        if a.git_commit != "unknown" {
            assert!(a.git_commit.chars().all(|c| c.is_ascii_hexdigit()));
        }
    }
}
