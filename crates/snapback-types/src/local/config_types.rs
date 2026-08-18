use serde::{Deserialize, Serialize};
use serde_json::Value;

/// One entry's LLP 0036 status: names and states only — never values.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct ConfigEntryStatus {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub purpose: Option<String>,
    pub secret: bool,
    pub required: bool,
    pub pool: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub probe: Option<String>,
    #[serde(rename = "howToGet", skip_serializing_if = "Option::is_none")]
    pub how_to_get: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub acquisition: Option<Value>,
    pub set: bool,
    #[serde(rename = "memberCount")]
    pub member_count: usize,
    #[serde(rename = "lastChangedMs", skip_serializing_if = "Option::is_none")]
    pub last_changed_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verified: Option<ConfigVerificationStatus>,
    #[serde(rename = "applyState")]
    pub apply_state: String,
}

/// Closed public projection of a stored verification record. Probe messages
/// are handler-controlled text and therefore stay in operator-local storage;
/// AdminRead responses expose only the finite state and timestamp.
///
/// @ref LLP 0031#independent-policy-axes — config status remains AdminRead only
/// because this type cannot carry handler output or configured values.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct ConfigVerificationStatus {
    pub ok: bool,
    #[serde(rename = "atMs", alias = "at_ms")]
    pub at_ms: u64,
}

/// The `config.status` payload (LLP 0036 §Operations and projections).
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct ConfigStatus {
    pub generation: u64,
    #[serde(rename = "backendClass")]
    pub backend_class: String,
    /// ENG-22752: whether any app has loaded a functions manifest on this
    /// instance yet. With inspect-first boot the answer is "no" until the app
    /// page is opened once, so empty `entries` means "nothing declared *yet*"
    /// rather than "this app declares no configuration" — the setup wizard
    /// needs the distinction to say which one is true.
    #[serde(rename = "appProvisioned", default)]
    pub app_provisioned: bool,
    pub entries: Vec<ConfigEntryStatus>,
    #[serde(rename = "requiredMissing")]
    pub required_missing: Vec<String>,
}

/// The `config.plan` dry-run facts (LLP 0036 §Operations and projections).
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct ConfigPlan {
    #[serde(rename = "backendClass")]
    pub backend_class: String,
    #[serde(rename = "writeLocus")]
    pub write_locus: String,
    #[serde(rename = "appliesImmediately")]
    pub applies_immediately: bool,
    #[serde(rename = "valueWritesAccepted")]
    pub value_writes_accepted: bool,
    pub generation: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entry: Option<String>,
    #[serde(rename = "wouldApplyState")]
    pub would_apply_state: String,
}

/// The `config.set` / `config.unset` envelope facts — never values.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct ConfigWriteOutcome {
    pub entry: String,
    #[serde(rename = "applyState")]
    pub apply_state: String,
    #[serde(rename = "valueChanged")]
    pub value_changed: bool,
    pub generation: u64,
}

/// The `config.verify` envelope facts.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct ConfigVerifyOutcome {
    pub entry: String,
    pub ok: bool,
    pub verified: ConfigVerificationStatus,
    pub generation: u64,
}
