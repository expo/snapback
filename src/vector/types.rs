use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeMap;

pub use super::profile::VectorMetricV1;
use super::profile::{
    VECTOR_COMPONENT_ABS_MAX, VECTOR_PROFILE_DIMENSIONS_MAX, VECTOR_PROFILE_DIMENSIONS_MIN,
};
use super::storage::{VECTOR_MAINTENANCE_BYTES_MAX, VECTOR_MAINTENANCE_EFFECTS_MAX};

pub const VECTOR_CAPABILITY: &str = "vector_search_v1";
pub const VECTOR_RESULT_PROJECTION: &str = "vector-page-v1";
pub const VECTOR_MAX_K: u32 = 64;
pub const VECTOR_DEFAULT_K: u32 = 10;
pub const VECTOR_MAX_FILTERS: usize = 8;
pub const VECTOR_MAX_CORPUS: u32 = 65_536;
pub const VECTOR_MAX_SCALAR_PAIRS: u64 = 1 << 26;

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
    #[schemars(range(min = 1, max = 1_024))]
    pub vector_maintenance_effects: u64,
    #[schemars(range(min = 1, max = 4_194_304))]
    pub vector_bytes: u64,
}

impl Default for VectorMaintenanceLimitsV1 {
    fn default() -> Self {
        Self {
            vector_maintenance_effects: VECTOR_MAINTENANCE_EFFECTS_MAX,
            vector_bytes: VECTOR_MAINTENANCE_BYTES_MAX,
        }
    }
}

/// The complete table-local identity of one exact vector index.
///
/// @ref LLP 0132#vector-values-and-declarations — one version binds the vector
///   field, dimensions, metric, release policy, ordering, and every work bound.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VectorIndexManifestV1 {
    pub format_version: u32,
    pub name: String,
    pub semantic_version: String,
    pub vector_field: String,
    #[schemars(range(min = VECTOR_PROFILE_DIMENSIONS_MIN, max = VECTOR_PROFILE_DIMENSIONS_MAX))]
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
    #[schemars(range(min = 1, max = 65_536))]
    pub max_indexed_vectors_per_partition: u32,
    #[schemars(range(min = 1, max = 67_108_864))]
    pub max_scalar_pairs: u64,
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

/// The same closed exact-scalar vocabulary used by portable text-search
/// equality filters. Null and composite JSON values are not representable.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(untagged)]
pub enum VectorFilterValueV1 {
    String(String),
    Number(serde_json::Number),
    Boolean(bool),
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VectorFilterV1 {
    pub field: String,
    pub op: VectorFilterOpV1,
    pub value: VectorFilterValueV1,
}

/// Public invocation carrier. The operation-specific argument contract fixes
/// `vector` to the declared index dimension.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VectorRequestV1 {
    #[schemars(schema_with = "vector_components_schema")]
    pub vector: Vec<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(range(min = 1, max = 64))]
    pub k: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(length(max = 8))]
    pub filters: Option<Vec<VectorFilterV1>>,
}

fn vector_components_schema(_generator: &mut schemars::SchemaGenerator) -> schemars::Schema {
    schemars::json_schema!({
        "type": "array",
        "items": {
            "type": "number",
            "format": "double",
            "minimum": -VECTOR_COMPONENT_ABS_MAX,
            "maximum": VECTOR_COMPONENT_ABS_MAX
        },
        "minItems": VECTOR_PROFILE_DIMENSIONS_MIN,
        "maxItems": VECTOR_PROFILE_DIMENSIONS_MAX
    })
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VectorItemV1 {
    pub row_id: String,
    pub distance: f64,
    /// Operation-specific result contracts close this map over exactly the
    /// index's stored fields. The shared carrier cannot name app fields.
    pub fields: Map<String, Value>,
}

/// The complete public v1 result. Pagination members are intentionally absent.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VectorPageV1 {
    #[schemars(length(max = 64))]
    pub items: Vec<VectorItemV1>,
}

/// Closed facts vocabulary for a future qualified target. Every current
/// target leaves this block absent and reports the `vector_search_v1` GAP.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VectorSearchFactsV1 {
    pub capability_id: String,
    pub maturity: String,
    pub distance_profile: String,
    pub distance_profile_digest: String,
    pub ordering_profile: String,
    pub metrics: Vec<String>,
    pub dimension_min: u32,
    pub dimension_max: u32,
    pub k_default: u32,
    pub k_max: u32,
    pub corpus_max: u32,
    pub scalar_pairs_max: u64,
    pub equality_filters_max: u32,
    pub equality_filters: bool,
    pub stored_fields: bool,
    pub visibility_profiles: Vec<String>,
    pub maintenance: String,
    pub pagination: String,
    pub tie_breaks: Vec<String>,
    pub storage_class: String,
    pub corruption_posture: String,
    pub accelerator: String,
    pub storage_engines: Vec<String>,
    pub nonclaims: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn public_page_is_items_only_and_unknown_members_refuse() {
        let page = VectorPageV1 { items: Vec::new() };
        assert_eq!(serde_json::to_value(page).unwrap(), json!({ "items": [] }));
        assert!(
            serde_json::from_value::<VectorPageV1>(json!({ "items": [], "cursor": null })).is_err()
        );
    }

    #[test]
    fn request_filter_values_are_closed_and_ordering_id_is_pinned() {
        assert_eq!(
            crate::vector::profile::VECTOR_ORDERING_PROFILE_ID,
            "nearest-first-row-id.v1"
        );
        assert!(
            serde_json::from_value::<VectorRequestV1>(json!({
                "vector": [0.0],
                "filters": [{ "field": "tag", "op": "eq", "value": null }]
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<VectorRequestV1>(json!({
                "vector": [0.0],
                "unknown": true
            }))
            .is_err()
        );
    }
}
