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

/// Cargo's build-originated recipe stamp. `build_profile` retains its
/// historical debug/release meaning; this fact carries the named Cargo
/// profile and the closed settings a public package must prove separately.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CargoBuildRecipe {
    pub schema_version: String,
    pub cargo_profile: String,
    pub inherits: Option<String>,
    pub incremental: Option<bool>,
    pub lto: Option<String>,
    pub codegen_units: Option<u32>,
    pub opt_level: Option<u32>,
    pub strip: Option<String>,
}

impl CargoBuildRecipe {
    /// Whether these build-originated facts are the closed public ship recipe.
    pub fn is_public_package_ship_recipe(&self) -> bool {
        self.schema_version == "snapback.cargo-build-recipe.v1"
            && self.cargo_profile == "production"
            && self.inherits.as_deref() == Some("release")
            && self.incremental == Some(false)
            && self.lto.as_deref() == Some("fat")
            && self.codegen_units == Some(1)
            && self.opt_level == Some(3)
            && self.strip.as_deref() == Some("symbols")
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
    /// Actual Cargo profile plus its declared ship-recipe settings. This is
    /// stamped by the build-identity leaf and copied by receipts and seals.
    pub build_recipe: CargoBuildRecipe,
    /// A per-process boot id: distinct on every process start, so a restart of
    /// the same binary is observable (the nonce changes) even when the build
    /// identity is unchanged. Not part of the "is this my binary?" verdict — a
    /// caller cannot know the expected nonce of a server it did not spawn — but
    /// it lets a caller that *did* spawn a server confirm the port still answers
    /// the same process.
    pub startup_nonce: String,
}
