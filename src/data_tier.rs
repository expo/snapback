//! Public, language-neutral data-tier publication metadata.
//!
//! Snapback owns the profile and corpus (LLP 0051 D5/Q2).  Consumers pin a
//! Snapback git commit and read the paths declared by [`DataTierProfile`]; a
//! sibling checkout is a local convenience, never an implicit dependency.
//! The types in this module are the DK-7 authority for the generated profile,
//! corpus-manifest, and corpus-case schemas.
//!
//! @ref LLP 0051#d5-conformance-the-corpus-becomes-the-data-tier-contract —
//!   one versioned corpus, soft skips for optional too-new cases, and
//!   fail-closed required-profile mismatches.
//! @ref LLP 0037#decision-ratified-2026-07-02 — Rust serde types own every
//!   Snapback public artifact shape; committed JSON schemas are generated.

use crate::manifest::{
    CTX_ANSWER_LEDGER_VERSION, CtxAnswerLedger, MutationPlan, REPLAY_OPAQUE_ID_MAX_BYTES,
    REPLAY_OPAQUE_ID_PATTERN, SNAPBACK_SCHEMA_VERSION, TableManifest,
};
use crate::value_expr::{
    DATA_TIER_PROFILE_VERSION, MAX_EXPR_DEPTH, MAX_INSERT_EACH_FANOUT, MAX_PLAN_SERIALIZED_BYTES,
    MAX_PLAN_STEPS, PINNED_FUNCTIONS,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeMap;

pub const DATA_TIER_CORPUS_NAME: &str = "snapback-data-tier";
pub const DATA_TIER_CORPUS_FORMAT_VERSION: u32 = 1;
pub const DATA_TIER_PUBLICATION_VERSION: u32 = 1;
pub const DATA_TIER_PROFILE_FILE: &str = "schemas/data-tier.profile.json";
pub const DATA_TIER_CASE_SCHEMA_FILE: &str = "schemas/data-tier.case.schema.json";
pub const DATA_TIER_CORPUS_MANIFEST_FILE: &str = "tests/conformance/data-tier/corpus.manifest.json";
pub const DATA_TIER_CORPUS_DIRECTORY: &str = "tests/conformance/data-tier";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DataTierPlanBounds {
    pub max_steps: usize,
    pub max_expr_depth: usize,
    pub max_insert_each_fanout: usize,
    pub max_serialized_bytes: usize,
    pub max_ledger_ids: usize,
    pub max_ledger_id_bytes: usize,
    pub opaque_id_pattern: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DataTierCompatibilityPolicy {
    /// Optional cases above an evaluator's supported profile are not run.
    pub optional_too_new: String,
    /// A required profile mismatch is a hard, typed failure.
    pub required_too_new: String,
    /// A consumer requiring a newer producer is also a hard, typed failure.
    pub producer_too_old: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DataTierGitPublication {
    pub kind: String,
    pub repository: String,
    pub addressing: String,
    pub profile_path: String,
    pub corpus_manifest_path: String,
    pub corpus_directory: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DataTierProfile {
    pub artifact_kind: String,
    pub publication_version: u32,
    pub schema_version: String,
    pub profile_version: u32,
    pub corpus_format_version: u32,
    pub ledger_version: u32,
    pub corpus: String,
    pub bounds: DataTierPlanBounds,
    pub pinned_functions: Vec<String>,
    pub case_schema_path: String,
    pub publication: DataTierGitPublication,
    pub compatibility: DataTierCompatibilityPolicy,
}

impl DataTierProfile {
    pub fn current() -> Self {
        Self {
            artifact_kind: "dataTierProfile".to_owned(),
            publication_version: DATA_TIER_PUBLICATION_VERSION,
            schema_version: SNAPBACK_SCHEMA_VERSION.to_owned(),
            profile_version: DATA_TIER_PROFILE_VERSION,
            corpus_format_version: DATA_TIER_CORPUS_FORMAT_VERSION,
            ledger_version: CTX_ANSWER_LEDGER_VERSION,
            corpus: DATA_TIER_CORPUS_NAME.to_owned(),
            bounds: DataTierPlanBounds {
                max_steps: MAX_PLAN_STEPS,
                max_expr_depth: MAX_EXPR_DEPTH,
                max_insert_each_fanout: MAX_INSERT_EACH_FANOUT,
                max_serialized_bytes: MAX_PLAN_SERIALIZED_BYTES,
                max_ledger_ids: crate::manifest::CTX_ANSWER_LEDGER_MAX_IDS,
                max_ledger_id_bytes: REPLAY_OPAQUE_ID_MAX_BYTES,
                opaque_id_pattern: REPLAY_OPAQUE_ID_PATTERN.to_owned(),
            },
            pinned_functions: PINNED_FUNCTIONS
                .iter()
                .map(|value| (*value).to_owned())
                .collect(),
            case_schema_path: DATA_TIER_CASE_SCHEMA_FILE.to_owned(),
            publication: DataTierGitPublication {
                kind: "gitPinnedCheckout".to_owned(),
                repository: "https://github.com/ccheever/snapback.git".to_owned(),
                addressing: "commitSha".to_owned(),
                profile_path: DATA_TIER_PROFILE_FILE.to_owned(),
                corpus_manifest_path: DATA_TIER_CORPUS_MANIFEST_FILE.to_owned(),
                corpus_directory: DATA_TIER_CORPUS_DIRECTORY.to_owned(),
            },
            compatibility: DataTierCompatibilityPolicy {
                optional_too_new: "skipped:corpus_version_too_new".to_owned(),
                required_too_new: "SNAPBACK_DATA_TIER_VERSION_REQUIRED".to_owned(),
                producer_too_old: "SNAPBACK_DATA_TIER_VERSION_UNSUPPORTED".to_owned(),
            },
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DataTierCorpusCaseEntry {
    pub name: String,
    pub path: String,
    pub sha256: String,
    #[serde(default)]
    pub required_capabilities: Vec<String>,
    pub minimum_profile_version: u32,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DataTierCorpusManifest {
    pub artifact_kind: String,
    pub corpus: String,
    pub corpus_format_version: u32,
    pub profile_version: u32,
    pub ledger_version: u32,
    pub profile_path: String,
    pub cases: Vec<DataTierCorpusCaseEntry>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DataTierCaseSchema {
    pub tables: Vec<TableManifest>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DataTierCaseError {
    pub code: String,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DataTierCaseExpectation {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub changed_count: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rows: Option<BTreeMap<String, Vec<Map<String, Value>>>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<DataTierCaseError>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DataTierCorpusCase {
    pub corpus: String,
    pub corpus_version: u32,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(default)]
    pub required_capabilities: Vec<String>,
    #[serde(default = "data_tier_profile_version")]
    pub minimum_profile_version: u32,
    pub schema: DataTierCaseSchema,
    #[serde(default)]
    pub seed: BTreeMap<String, Vec<Map<String, Value>>>,
    pub plan: MutationPlan,
    #[serde(default)]
    pub args: Value,
    #[serde(default)]
    pub auth_user_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ctx_ledger: Option<CtxAnswerLedger>,
    pub expect: DataTierCaseExpectation,
}

fn data_tier_profile_version() -> u32 {
    DATA_TIER_PROFILE_VERSION
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataTierCompatibilityOutcome {
    Compatible,
    SoftSkip { code: &'static str },
    Fail { code: &'static str },
}

/// Consumer-side compatibility rule, shipped next to the metadata it governs.
pub fn compatibility_outcome(
    producer_profile: u32,
    consumer_min: u32,
    consumer_max: u32,
    required: bool,
) -> DataTierCompatibilityOutcome {
    if producer_profile < consumer_min {
        return DataTierCompatibilityOutcome::Fail {
            code: "SNAPBACK_DATA_TIER_VERSION_UNSUPPORTED",
        };
    }
    if producer_profile > consumer_max {
        return if required {
            DataTierCompatibilityOutcome::Fail {
                code: "SNAPBACK_DATA_TIER_VERSION_REQUIRED",
            }
        } else {
            DataTierCompatibilityOutcome::SoftSkip {
                code: "skipped:corpus_version_too_new",
            }
        };
    }
    DataTierCompatibilityOutcome::Compatible
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compatibility_is_typed_and_required_profiles_fail_closed() {
        assert_eq!(
            compatibility_outcome(2, 1, 1, false),
            DataTierCompatibilityOutcome::SoftSkip {
                code: "skipped:corpus_version_too_new"
            }
        );
        assert_eq!(
            compatibility_outcome(2, 1, 1, true),
            DataTierCompatibilityOutcome::Fail {
                code: "SNAPBACK_DATA_TIER_VERSION_REQUIRED"
            }
        );
        assert_eq!(
            compatibility_outcome(0, 1, 1, false),
            DataTierCompatibilityOutcome::Fail {
                code: "SNAPBACK_DATA_TIER_VERSION_UNSUPPORTED"
            }
        );
    }
}
