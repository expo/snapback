use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeMap;

pub const VECTOR_CAPABILITY: &str = "vector_search_v1";
pub const VECTOR_DISTANCE_PROFILE: &str = "snapback-vector-distance-v1";
pub const VECTOR_ORDERING_PROFILE: &str = "nearest-first-row-id.v1";
pub const VECTOR_MAX_DIMENSIONS: u32 = 4_096;
pub const VECTOR_MAX_K: u32 = 64;
pub const VECTOR_MAX_FILTERS: usize = 8;
pub const VECTOR_MAX_CORPUS: u32 = 65_536;
pub const VECTOR_MAX_SCALAR_PAIRS: u64 = 1 << 26;
pub const VECTOR_MAX_MAINTENANCE_EFFECTS: u32 = 1_024;
pub const VECTOR_MAX_BYTES_PER_COMMIT: u32 = 4 * 1024 * 1024;
/// `2^100`, encoded directly so the admission ceiling is itself a stable
/// binary64 fact and never depends on a platform `pow` implementation.
pub const VECTOR_COMPONENT_ABS_MAX: f64 = f64::from_bits(0x4630_0000_0000_0000);

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum VectorMetricV1 {
    L2sq,
    Dot,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum VectorFieldClassV1 {
    Public,
    Private,
    Sensitive,
    Forbidden,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum VectorVisibilityV1 {
    PublicRead,
    Owner { field: String },
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
pub enum VectorTieBreakV1 {
    #[serde(rename = "id-asc")]
    IdAsc,
    #[serde(rename = "id-desc")]
    IdDesc,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VectorMaintenanceLimitsV1 {
    pub vector_maintenance_effects: u32,
    pub vector_bytes: u32,
}

impl Default for VectorMaintenanceLimitsV1 {
    fn default() -> Self {
        Self {
            vector_maintenance_effects: VECTOR_MAX_MAINTENANCE_EFFECTS,
            vector_bytes: VECTOR_MAX_BYTES_PER_COMMIT,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VectorIndexManifestV1 {
    pub format_version: u32,
    pub name: String,
    pub semantic_version: String,
    pub vector_field: String,
    pub dimensions: u32,
    pub metric: VectorMetricV1,
    pub distance_profile: String,
    pub ordering_profile: String,
    /// Closed classification carrier for every participating source field.
    pub field_classifications: BTreeMap<String, VectorFieldClassV1>,
    #[serde(default)]
    pub equality_filters: Vec<String>,
    #[serde(default)]
    pub stored_fields: Vec<String>,
    pub visibility: VectorVisibilityV1,
    pub tie_break: VectorTieBreakV1,
    pub max_indexed_vectors_per_partition: u32,
    #[serde(default)]
    pub maintenance_limits: VectorMaintenanceLimitsV1,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VectorQueryPlanV1 {
    pub table: String,
    pub index: String,
    pub distance_profile: String,
    pub result_projection: String,
    pub required_capability: String,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
pub enum VectorFilterOpV1 {
    #[default]
    #[serde(rename = "eq")]
    Eq,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(untagged)]
pub enum VectorFilterValueV1 {
    String(String),
    Number(serde_json::Number),
    Boolean(bool),
}

impl VectorFilterValueV1 {
    pub fn matches_value(&self, other: &Value) -> bool {
        match (self, other) {
            (Self::String(left), Value::String(right)) => left == right,
            (Self::Number(left), Value::Number(right)) => left == right,
            (Self::Boolean(left), Value::Bool(right)) => left == right,
            _ => false,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VectorFilterV1 {
    pub field: String,
    pub op: VectorFilterOpV1,
    pub value: VectorFilterValueV1,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VectorRequestV1 {
    pub vector: Vec<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub k: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filters: Option<Vec<VectorFilterV1>>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VectorItemV1 {
    pub row_id: String,
    pub distance: f64,
    pub fields: Map<String, Value>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VectorPageV1 {
    pub items: Vec<VectorItemV1>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VectorSearchFactsV1 {
    pub capability_id: String,
    pub maturity: String,
    pub exact: bool,
    pub distance_profile: String,
    pub distance_profile_digest: String,
    pub ordering_profile: String,
    pub metrics: Vec<String>,
    pub tie_breaks: Vec<String>,
    pub dimension_max: u32,
    pub k_max: u32,
    pub corpus_max: u32,
    pub scalar_pairs_max: u64,
    pub component_abs_max: String,
    pub equality_filters_max: u32,
    pub stored_fields: bool,
    pub visibility: Vec<String>,
    pub maintenance: String,
    pub maintenance_effects_max: u32,
    pub maintenance_bytes_max: u32,
    pub pagination: String,
    pub accelerator: String,
    pub storage_class: String,
    pub corruption_posture: String,
    pub query_vector_telemetry: String,
    pub conversion_witnesses: Vec<String>,
    pub authorization_filters: Vec<String>,
    pub storage_engines: Vec<String>,
    pub nonclaims: Vec<String>,
}

impl VectorSearchFactsV1 {
    pub fn local_v1() -> Self {
        Self {
            capability_id: VECTOR_CAPABILITY.to_owned(),
            maturity: "experimental".to_owned(),
            exact: true,
            distance_profile: VECTOR_DISTANCE_PROFILE.to_owned(),
            distance_profile_digest: crate::vector::fixtures::vector_distance_fixture_digest(),
            ordering_profile: VECTOR_ORDERING_PROFILE.to_owned(),
            metrics: vec!["l2sq".to_owned(), "dot".to_owned()],
            tie_breaks: vec!["id-asc".to_owned(), "id-desc".to_owned()],
            dimension_max: VECTOR_MAX_DIMENSIONS,
            k_max: VECTOR_MAX_K,
            corpus_max: VECTOR_MAX_CORPUS,
            scalar_pairs_max: VECTOR_MAX_SCALAR_PAIRS,
            component_abs_max: "2^100".to_owned(),
            equality_filters_max: VECTOR_MAX_FILTERS as u32,
            stored_fields: true,
            visibility: vec!["public-read".to_owned(), "owner.v1".to_owned()],
            maintenance: "synchronous".to_owned(),
            maintenance_effects_max: VECTOR_MAX_MAINTENANCE_EFFECTS,
            maintenance_bytes_max: VECTOR_MAX_BYTES_PER_COMMIT,
            pagination: "single-page".to_owned(),
            accelerator: "none".to_owned(),
            storage_class: "ordinary-transactional-shadow".to_owned(),
            corruption_posture: "digest-recheck-quarantine".to_owned(),
            query_vector_telemetry: "shape-and-digest-only".to_owned(),
            conversion_witnesses: vec!["rust".to_owned(), "javascript".to_owned()],
            authorization_filters: vec!["public-read".to_owned(), "owner.v1".to_owned()],
            storage_engines: vec!["sqlite".to_owned()],
            nonclaims: vec![
                "ann".to_owned(),
                "embedding-computation".to_owned(),
                "hybrid-ranking".to_owned(),
                "external-vector-store".to_owned(),
                "live-vector-search".to_owned(),
                "pagination".to_owned(),
                "cosine".to_owned(),
                "range-filters".to_owned(),
                "membership-visibility".to_owned(),
                "sensitive-fields".to_owned(),
                "offline-vector-search".to_owned(),
                "hosted-targets".to_owned(),
                "postgres".to_owned(),
            ],
        }
    }
}
