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
    #[serde(default)]
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
    Owner { field: String },
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
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchQueryPlanV1 {
    pub table: String,
    pub index: String,
    pub parser: String,
    pub result_projection: String,
    pub required_capability: String,
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

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchFilterV1 {
    pub field: String,
    pub op: String,
    pub value: Value,
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

impl FullTextSearchFactsV1 {
    pub fn local_v1() -> Self {
        Self {
            capability_id: SEARCH_CAPABILITY.to_owned(),
            maturity: "stable".to_owned(),
            analyzer: SEARCH_ANALYZER.to_owned(),
            unicode_version: crate::search::unicode17_generated::UNICODE_VERSION.to_owned(),
            analyzer_tables_digest: crate::search::unicode17_generated::ANALYZER_TABLES_DIGEST
                .to_owned(),
            parser: SEARCH_PARSER.to_owned(),
            scorer: SEARCH_SCORER.to_owned(),
            score_max: 22_937_600,
            maintenance: "synchronous".to_owned(),
            pagination: "current-keyset-v1".to_owned(),
            cursor_ttl_ms: SEARCH_CURSOR_TTL_MS,
            accelerator: "none".to_owned(),
            authorization_filters: vec!["public-read".to_owned(), "owner.v1".to_owned()],
            highlights: true,
            counts: false,
            facets: false,
            suggestions: false,
            offline: false,
            storage_engines: vec!["sqlite".to_owned()],
            nonclaims: vec![
                "live-search".to_owned(),
                "offline-search".to_owned(),
                "postgres".to_owned(),
                "relational-visibility".to_owned(),
                "native-fts-acceleration".to_owned(),
                "sensitive-fields".to_owned(),
            ],
        }
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
