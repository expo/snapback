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
pub const BUILD_DISTRIBUTION_CONTRIBUTOR_SOURCE: &str = "contributor-source";
pub const BUILD_DISTRIBUTION_PUBLIC_PACKAGE: &str = "public-package";

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

/// The compiler-authored ship-recipe stamp carried beside the binary identity.
///
/// `build_profile` above is derived from `cfg!(debug_assertions)`, so a
/// `--profile production` binary reports `release` there and nothing
/// downstream can tell a real ship build from an env-overridden ordinary
/// release. This block is the distinguishing fact, and its authority is the
/// build: `snapback-build-identity`'s build script stamps it from the resolved
/// profile plus the `[profile.production]` recipe declared in the root
/// manifest, and refuses to stamp at all when an ambient channel could have
/// falsified that declaration. Receipts, seals, attestations, and publication
/// validators copy it; none may originate it.
///
/// @ref LLP 0314.000#phase-1--ship-the-ship-profile-and-strip-it — 1c.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildRecipe {
    /// Resolved Cargo profile directory name: `debug`, `release`, or
    /// `production`. Cargo's build-script `PROFILE` collapses every custom
    /// profile onto `debug`/`release`, so this is derived from `OUT_DIR`.
    pub profile: String,
    /// Cargo's coarse build-script `PROFILE` class, retained so the two facts
    /// are separable by a reader who knows only one of them.
    pub cargo_profile_class: String,
    /// The optimization level Cargo actually resolved, not one read from a
    /// manifest.
    pub opt_level: String,
    /// The declared `[profile.production]` recipe. Every field is `None` off
    /// the ship profile: an unattested build states no recipe rather than
    /// stating a default that nothing verified.
    pub lto: Option<String>,
    pub codegen_units: Option<u32>,
    pub incremental: Option<bool>,
    pub strip: Option<String>,
}
