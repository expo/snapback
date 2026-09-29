//! Compiled query and mutation facts shared by the server and device.
use super::ColumnType;
use serde::{Deserialize, Serialize};

// @ref LLP 3000.028#3.3 — the SDK serializes positions; Rust alone evaluates queries.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SearchComposition {
    pub table: String,
    pub index: String,
    pub column: String,
    pub kind: ColumnType,
    pub order: crate::ir::Order,
    pub limit: u64,
    pub needle: String,
    pub cursor: String,
    pub variant: Option<crate::ir::VariantId>,
}

// @ref LLP 3000.007#6.2 — eligibility is static; prediction and horizon coverage are per call.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Execution {
    /// Complete query footprint, retained when private derivations are projected out.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reads: Option<Vec<String>>,
    /// Compiler-proved SDK composition descriptor; no application predicate is changed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub search: Option<SearchComposition>,
    // @ref LLP 3000.017#2.4 — absent facts retain legacy schema bytes.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub ephemeral: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub renews: bool,
    #[serde(default, rename = "renewMs", skip_serializing_if = "Option::is_none")]
    pub renew_ms: Option<u64>,
    #[serde(default, rename = "ephemeralReads", skip_serializing_if = "Vec::is_empty")]
    pub ephemeral_reads: Vec<String>,
    /// Author-declared device-only query. Incomplete local answers never fall back to the server.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub held: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub components: Vec<Component>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runs: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub predicts: Option<String>,
    #[serde(default)]
    pub sites: Vec<ResidencySite>,
    #[serde(default)]
    pub requires: Vec<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub connected_effects_only: bool,
    /// Pure presence-dependent branches whose untaken arm prediction also charges.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub prediction_guards: Vec<String>,
    /// Infallible effect-payload work omitted by the device, at original statement paths.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub prediction_skips: Vec<String>,
    /// Server reads that feed effects exclusively; these do not require device coverage.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub effect_payload_reads: Vec<ResidencySite>,
}

/// A returned record field and the zero-based top-level statements it owns.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Component {
    pub field: String,
    pub statements: Vec<usize>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ResidencySite {
    pub site: String,
    pub table: String,
    pub index: String,
    pub kind: String,
    pub class: SiteClass,
    pub reason: String,
    pub rewrite: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SiteClass { Held, Horizon, Server }
