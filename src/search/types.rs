use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeMap;

pub const SEARCH_ANALYZER: &str = "snapback-category-unicode17-v1";
pub const SEARCH_PARSER: &str = "snapback-search-parser-v1";
pub const SEARCH_SCORER: &str = "snapback-term-score-v1";
pub const SEARCH_CURSOR_PROFILE: &str = "snapback-search-cursor-xchacha20-v1";
pub const SEARCH_CAPABILITY: &str = "full_text_search_v1";
pub const SEARCH_CURSOR_TTL_MS: u64 = 120_000;
pub const SEARCH_CURSOR_MAX_BYTES: usize = 2_048;
pub const SEARCH_MAX_LIMIT: u32 = 50;
pub const SEARCH_MAX_MAINTENANCE_EFFECTS: usize = 1_024;
pub const SEARCH_MAX_POSTING_OPS: usize = 4_096;
pub const SEARCH_MAX_POSITIONS: usize = 8_192;
pub const SEARCH_MAX_BYTES_PER_COMMIT: usize = 256 * 1024;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchTextFieldV1 {
    #[schemars(range(min = 1, max = 64))]
    pub weight: u32,
    pub classification: SearchFieldClassV1,
}

#[derive(
    Clone, Copy, Debug, Default, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize, JsonSchema,
)]
#[serde(rename_all = "kebab-case")]
pub enum SearchFieldClassV1 {
    #[default]
    Public,
    Private,
    Sensitive,
    Forbidden,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum SearchVisibilityV1 {
    PublicRead,
    Owner {
        field: String,
    },
    Membership {
        #[serde(rename = "declaration")]
        declaration: String,
        #[serde(rename = "resourceField")]
        resource_field: String,
        #[serde(rename = "roles", default, skip_serializing_if = "Option::is_none")]
        roles: Option<Vec<String>>,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchSourceLimitsV1 {
    pub max_indexed_bytes: u32,
    pub max_tokens: u32,
    pub max_posting_operations: u32,
}

impl Default for SearchSourceLimitsV1 {
    fn default() -> Self {
        Self {
            max_indexed_bytes: 32 * 1024,
            max_tokens: 2_048,
            max_posting_operations: 4_096,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchQueryLimitsV1 {
    pub max_candidate_work: u32,
    pub max_prefix_terms: u32,
    pub min_prefix_scalars: u32,
}

impl Default for SearchQueryLimitsV1 {
    fn default() -> Self {
        Self {
            max_candidate_work: 10_000,
            max_prefix_terms: 256,
            min_prefix_scalars: 2,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchCursorLimitsV1 {
    pub ttl_ms: u64,
    pub max_bytes: u32,
}

impl Default for SearchCursorLimitsV1 {
    fn default() -> Self {
        Self {
            ttl_ms: SEARCH_CURSOR_TTL_MS,
            max_bytes: SEARCH_CURSOR_MAX_BYTES as u32,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchMaintenanceLimitsV1 {
    pub search_maintenance_effects: u32,
    pub search_posting_ops: u32,
    pub search_positions: u32,
    pub search_bytes: u32,
}

impl Default for SearchMaintenanceLimitsV1 {
    fn default() -> Self {
        Self {
            search_maintenance_effects: SEARCH_MAX_MAINTENANCE_EFFECTS as u32,
            search_posting_ops: SEARCH_MAX_POSTING_OPS as u32,
            search_positions: SEARCH_MAX_POSITIONS as u32,
            search_bytes: SEARCH_MAX_BYTES_PER_COMMIT as u32,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchIndexManifestV1 {
    pub format_version: u32,
    pub name: String,
    pub semantic_version: String,
    pub analyzer: String,
    pub analyzer_tables_digest: String,
    pub text_fields: BTreeMap<String, SearchTextFieldV1>,
    /// Closed classification carrier for every participating field that is
    /// not already classified by `text_fields`.
    pub field_classifications: BTreeMap<String, SearchFieldClassV1>,
    #[serde(default)]
    pub equality_filters: Vec<String>,
    #[serde(default)]
    pub stored_fields: Vec<String>,
    #[serde(default)]
    pub highlight_fields: Vec<String>,
    pub visibility: SearchVisibilityV1,
    pub tie_break: String,
    #[serde(default)]
    pub source_limits: SearchSourceLimitsV1,
    #[serde(default)]
    pub query_limits: SearchQueryLimitsV1,
    #[serde(default)]
    pub cursor_limits: SearchCursorLimitsV1,
    #[serde(default)]
    pub maintenance_limits: SearchMaintenanceLimitsV1,
    /// Optional lower ceilings for the separately capability-gated live
    /// search surface. Absence selects the target's admitted defaults.
    ///
    /// @ref LLP 0136#capability-id-and-claim-discipline-llp-0119-oq2-proposal
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub live_limits: Option<SearchLiveLimitsV1>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchLiveLimitsV1 {
    pub max_live_subscriptions: u32,
    pub max_live_subscriptions_per_connection: u32,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchQueryPlanV1 {
    pub table: String,
    pub index: String,
    pub parser: String,
    pub result_projection: String,
    pub required_capability: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resource_arg: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchTermV1 {
    pub value: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub field: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchPhraseV1 {
    pub values: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub field: Option<String>,
}

/// The one filter operator the v1 parser profile admits. A closed enum rather
/// than a free string so the deserialization grammar, the exported request
/// schema, and the published client typings admit exactly the same set — a new
/// operator is a new parser profile, not a wider string.
///
/// @ref LLP 0131#the-search-fixture-cv-5 — every carrier of the AST grammar
/// derives from or verifies against the one exported request schema.
#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
pub enum SearchFilterOpV1 {
    #[default]
    #[serde(rename = "eq")]
    Eq,
}

/// The closed scalar vocabulary for equality-filter values. Previously this
/// field was an open `serde_json::Value` whose non-scalar shapes were refused
/// later by semantic validation; closing it at the deserialization grammar
/// keeps the accepted query set identical while letting every schema carrier
/// state the same admissible set.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(untagged)]
pub enum SearchFilterValueV1 {
    String(String),
    Number(serde_json::Number),
    Boolean(bool),
}

impl SearchFilterValueV1 {
    pub fn as_value(&self) -> Value {
        match self {
            Self::String(value) => Value::String(value.clone()),
            Self::Number(value) => Value::Number(value.clone()),
            Self::Boolean(value) => Value::Bool(*value),
        }
    }

    pub fn matches_value(&self, other: &Value) -> bool {
        match (self, other) {
            (Self::String(left), Value::String(right)) => left == right,
            (Self::Number(left), Value::Number(right)) => left == right,
            (Self::Boolean(left), Value::Bool(right)) => left == right,
            _ => false,
        }
    }

    pub fn is_string(&self) -> bool {
        matches!(self, Self::String(_))
    }

    pub fn is_boolean(&self) -> bool {
        matches!(self, Self::Boolean(_))
    }

    pub fn as_i64(&self) -> Option<i64> {
        match self {
            Self::Number(value) => value.as_i64(),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchFilterV1 {
    pub field: String,
    pub op: SearchFilterOpV1,
    pub value: SearchFilterValueV1,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
pub enum SearchMatchAtomV1 {
    Term(SearchTermV1),
    Phrase(SearchPhraseV1),
    Prefix(SearchTermV1),
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
pub enum SearchClauseV1 {
    Term(SearchTermV1),
    Phrase(SearchPhraseV1),
    Prefix(SearchTermV1),
    Any(Vec<SearchMatchAtomV1>),
    Not(SearchMatchAtomV1),
    Filter(SearchFilterV1),
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchQueryAstV1 {
    pub all: Vec<SearchClauseV1>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchRequestV1 {
    pub query: SearchQueryAstV1,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub after: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchMatchRangeV1 {
    pub start: u32,
    pub end: u32,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchHighlightV1 {
    pub field: String,
    pub text: String,
    pub matches: Vec<SearchMatchRangeV1>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchItemV1 {
    pub row_id: String,
    pub score: u32,
    pub fields: Map<String, Value>,
    pub highlights: Vec<SearchHighlightV1>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchPageV1 {
    pub items: Vec<SearchItemV1>,
    pub cursor: Option<String>,
    pub has_more: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchCursorV1 {
    pub format_version: u32,
    pub app_id: String,
    pub database_id: String,
    pub target_profile_id: String,
    pub stream_epoch: String,
    pub semantic_version: String,
    pub physical_generation: u64,
    pub query_core_hash: String,
    pub limit: u32,
    pub authority_instance: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner_subject: Option<String>,
    pub release_policy_digest: String,
    pub score: u32,
    pub row_id: String,
    pub row_id_direction: String,
    pub key_generation: String,
    pub issued_at: u64,
    pub expires_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub membership_resource: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub membership_declaration: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub membership_roles: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub authorization_incarnation: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub authorization_epoch: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FullTextSearchFactsV1 {
    pub capability_id: String,
    pub maturity: String,
    pub analyzer: String,
    pub unicode_version: String,
    pub analyzer_tables_digest: String,
    pub parser: String,
    pub scorer: String,
    pub score_max: u32,
    pub maintenance: String,
    pub pagination: String,
    pub cursor_ttl_ms: u64,
    pub accelerator: String,
    pub authorization_filters: Vec<String>,
    pub highlights: bool,
    pub counts: bool,
    pub facets: bool,
    pub suggestions: bool,
    pub offline: bool,
    pub storage_engines: Vec<String>,
    pub nonclaims: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn membership_manifest_wire_shapes_are_exact() {
        assert_eq!(
            serde_json::to_value(SearchVisibilityV1::Membership {
                declaration: "roomMembers".to_owned(),
                resource_field: "roomId".to_owned(),
                roles: Some(vec!["owner".to_owned()]),
            })
            .unwrap(),
            json!({
                "kind": "membership",
                "declaration": "roomMembers",
                "resourceField": "roomId",
                "roles": ["owner"],
            })
        );
        assert_eq!(
            serde_json::to_value(SearchQueryPlanV1 {
                table: "messages".to_owned(),
                index: "search_messages".to_owned(),
                parser: SEARCH_PARSER.to_owned(),
                result_projection: "search-page-v1".to_owned(),
                required_capability: SEARCH_CAPABILITY.to_owned(),
                resource_arg: Some("roomId".to_owned()),
            })
            .unwrap()["resourceArg"],
            "roomId"
        );
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SearchToken {
    pub field: String,
    pub token: String,
    pub position: u32,
    pub source_start: u32,
    pub source_end: u32,
}
