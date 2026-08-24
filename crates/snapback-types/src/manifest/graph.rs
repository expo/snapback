//! Closed `graph_query_v1` wire, identity, and admission vocabulary.
//!
//! This module intentionally contains no executor. The graph carrier is an
//! additive manifest sibling whose host-side responsibilities in G0 are
//! canonicalization, proof/identity reconstruction, and fail-closed refusal.

use super::*;
use crate::storage::AuthorizationVersion;
use schemars::JsonSchema;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;
use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

pub const GRAPH_QUERY_CAPABILITY_ID: &str = "graph_query_v1";
pub const GRAPH_MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const SHA256_V1_PATTERN: &str = "^sha256:[0-9a-f]{64}$";
const CANONICAL_CLIENT_MAX_DEPTH: usize = 32;
const CANONICAL_CLIENT_MAX_NODES: usize = 4_096;
const CANONICAL_CLIENT_MAX_OBJECT_FIELDS: usize = 256;
const CANONICAL_CLIENT_MAX_ARRAY_ENTRIES: usize = 1_024;
const CANONICAL_CLIENT_MAX_STRING_BYTES: usize = 65_536;
const CANONICAL_CLIENT_MAX_JCS_BYTES: usize = 262_144;

fn deserialize_required_option<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

fn deserialize_optional_non_null<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}

fn nullable_string_vector_schema(generator: &mut schemars::SchemaGenerator) -> schemars::Schema {
    generator.subschema_for::<Option<Vec<String>>>()
}

fn nullable_graph_row_key_schema(generator: &mut schemars::SchemaGenerator) -> schemars::Schema {
    generator.subschema_for::<Option<GraphRowKeyV1>>()
}

fn nullable_u64_schema(generator: &mut schemars::SchemaGenerator) -> schemars::Schema {
    generator.subschema_for::<Option<u64>>()
}

fn nullable_keyset_key_schema(generator: &mut schemars::SchemaGenerator) -> schemars::Schema {
    generator.subschema_for::<Option<KeysetKeyV1>>()
}

fn nullable_string_schema(generator: &mut schemars::SchemaGenerator) -> schemars::Schema {
    generator.subschema_for::<Option<String>>()
}

fn nullable_authority_partition_schema(
    generator: &mut schemars::SchemaGenerator,
) -> schemars::Schema {
    generator.subschema_for::<Option<AuthorityPartitionV1>>()
}

fn filter_vector_schema(generator: &mut schemars::SchemaGenerator) -> schemars::Schema {
    generator.subschema_for::<Vec<FilterExpr>>()
}

fn principal_binding_schema(generator: &mut schemars::SchemaGenerator) -> schemars::Schema {
    generator.subschema_for::<GraphPrincipalBindingV1>()
}

fn string_schema(generator: &mut schemars::SchemaGenerator) -> schemars::Schema {
    generator.subschema_for::<String>()
}

fn string_vector_schema(generator: &mut schemars::SchemaGenerator) -> schemars::Schema {
    generator.subschema_for::<Vec<String>>()
}

fn u64_schema(generator: &mut schemars::SchemaGenerator) -> schemars::Schema {
    generator.subschema_for::<u64>()
}

fn sha256_schema(generator: &mut schemars::SchemaGenerator) -> schemars::Schema {
    generator.subschema_for::<Sha256V1>()
}

fn principal_authority_schema(generator: &mut schemars::SchemaGenerator) -> schemars::Schema {
    let _ = generator;
    serde_json::from_value(serde_json::json!({
        "type": "object",
        "properties": {
            "declaredClass": {"type":"integer", "const":3},
            "proof": {"type":"null"}
        },
        "required": ["declaredClass", "proof"],
        "additionalProperties": false
    }))
    .expect("principal authority is valid JSON Schema")
}

/// A lowercase, prefixed SHA-256 digest. Deserialization enforces the same
/// shape emitted into JSON Schema, so a malformed digest never becomes an
/// admitted graph fact.
#[derive(Clone, Debug, Eq, Hash, JsonSchema, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(transparent)]
pub struct Sha256V1(#[schemars(pattern(SHA256_V1_PATTERN))] pub String);

impl Sha256V1 {
    pub fn new(value: impl Into<String>) -> Result<Self, &'static str> {
        let value = value.into();
        if value.len() == 71
            && value.starts_with("sha256:")
            && value[7..]
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
        {
            Ok(Self(value))
        } else {
            Err("expected sha256: followed by 64 lowercase hexadecimal digits")
        }
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl<'de> Deserialize<'de> for Sha256V1 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Self::new(value).map_err(serde::de::Error::custom)
    }
}

impl fmt::Display for Sha256V1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

/// The closed numerical authority classes: independent, partition-scoped,
/// and principal-scoped.
#[derive(Clone, Copy, Debug, Eq, JsonSchema, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(transparent)]
pub struct GraphAuthorityClassV1(#[schemars(range(min = 1, max = 3))] pub u8);

impl GraphAuthorityClassV1 {
    pub const INDEPENDENT: Self = Self(1);
    pub const PARTITION_SCOPED: Self = Self(2);
    pub const PRINCIPAL_SCOPED: Self = Self(3);
}

impl<'de> Deserialize<'de> for GraphAuthorityClassV1 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = u8::deserialize(deserializer)?;
        if (1..=3).contains(&value) {
            Ok(Self(value))
        } else {
            Err(serde::de::Error::custom(
                "graph authority class must be 1, 2, or 3",
            ))
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum GraphDirectionV1 {
    Forward,
    Backward,
}

/// Existing canonical client JSON value vocabulary, reused rather than
/// wrapped in a graph-only JSON shape.
pub type CanonicalClientValueV1 = Value;

/// Wire-identical counterpart of the kernel's storage-native `KeysetAfter`.
/// `_id` is always carried separately in `id`.
#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KeysetKeyV1 {
    pub entries: Vec<(String, CanonicalClientValueV1)>,
    pub id: String,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphArgumentV1 {
    pub argument_id: String,
    pub name: String,
    pub contract: ArgumentBindingContractV1,
    pub contract_hash: Sha256V1,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum GraphIntervalEndV1 {
    Unbounded,
    Inclusive { key: KeysetKeyV1 },
    Exclusive { key: KeysetKeyV1 },
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum GraphDemandPageV1 {
    Demand,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphLiteralPageV1 {
    pub kind: GraphLiteralPageKindV1,
    pub direction: GraphDirectionV1,
    pub lower: GraphIntervalEndV1,
    pub upper: GraphIntervalEndV1,
    pub take: u64,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
pub enum GraphLiteralPageKindV1 {
    #[serde(rename = "literal")]
    Literal,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(untagged)]
pub enum GraphChildPageV1 {
    Demand(GraphDemandPageV1),
    Literal(GraphLiteralPageV1),
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DirectEdgeV1 {
    pub table: String,
    pub visibility: TableVisibilityV1,
    pub join_on: Vec<JoinEquality>,
    pub access_index: String,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ThroughEdgeV1 {
    pub table: String,
    pub visibility: TableVisibilityV1,
    pub parent_join: Vec<JoinEquality>,
    pub target_table: String,
    pub target_visibility: TableVisibilityV1,
    pub target_join: Vec<JoinEquality>,
    pub parent_index: String,
    pub target_index: String,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(untagged)]
pub enum GraphEdgeV1 {
    Direct(DirectEdgeV1),
    Through(ThroughEdgeV1),
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphPrincipalBindingV1 {
    pub table: String,
    pub visibility: TableVisibilityV1,
    pub principal_field: String,
    pub value_field: String,
    pub unique_index: String,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum GraphSearchScopeSourceV1 {
    Argument {
        #[serde(rename = "argumentId")]
        argument_id: String,
    },
    ParentField {
        #[serde(rename = "nodeId")]
        node_id: String,
        field: String,
    },
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphSearchScopeBindingV1 {
    pub provider_scope_field: String,
    pub source: GraphSearchScopeSourceV1,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
pub enum GraphProviderCompletenessClassV1 {
    #[serde(rename = "complete-membership-v1")]
    CompleteMembershipV1,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphSearchMembershipIdentityV1 {
    #[schemars(extend("const" = "snapback.graph-search-membership-identity.v1"))]
    pub format: String,
    pub provider_plan_hash: Sha256V1,
    pub argument_contract_hash: Sha256V1,
    pub scope_contract_hash: Sha256V1,
    pub authority_class: GraphAuthorityClassV1,
    pub provider_version: String,
    pub provider_completeness_class: GraphProviderCompletenessClassV1,
    pub membership_hash: Sha256V1,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum GraphProofDeclaredClassV1 {
    Class2,
}

impl Serialize for GraphProofDeclaredClassV1 {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_u8(2)
    }
}

impl<'de> Deserialize<'de> for GraphProofDeclaredClassV1 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        match u8::deserialize(deserializer)? {
            2 => Ok(Self::Class2),
            _ => Err(serde::de::Error::custom(
                "graph partition proof declaredClass must be the number 2",
            )),
        }
    }
}

impl JsonSchema for GraphProofDeclaredClassV1 {
    fn schema_name() -> std::borrow::Cow<'static, str> {
        "GraphProofDeclaredClassV1".into()
    }

    fn inline_schema() -> bool {
        true
    }

    fn json_schema(_: &mut schemars::SchemaGenerator) -> schemars::Schema {
        serde_json::from_value(serde_json::json!({
            "type": "integer",
            "const": 2
        }))
        .expect("class-2 literal is valid JSON Schema")
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
pub enum GraphEquivalenceWitnessV1 {
    #[serde(rename = "declared-inputs-only")]
    DeclaredInputsOnly,
}

#[derive(
    Clone, Copy, Debug, Deserialize, Eq, JsonSchema, Ord, PartialEq, PartialOrd, Serialize,
)]
#[serde(rename_all = "kebab-case")]
pub enum GraphDataNodeKindV1 {
    RootWindow,
    EqualityToOne,
    BoundedToMany,
    ExistsSemiJoin,
    PrincipalBound,
    SearchMembership,
}

#[derive(
    Clone, Copy, Debug, Deserialize, Eq, JsonSchema, Ord, PartialEq, PartialOrd, Serialize,
)]
#[serde(rename_all = "kebab-case")]
pub enum GraphNodeKindV1 {
    RootWindow,
    EqualityToOne,
    BoundedToMany,
    ExistsSemiJoin,
    PrincipalBound,
    SearchMembership,
    ClosedProjection,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum GraphCompletenessLabelV1 {
    Unknown,
    Complete,
    Prefix,
    Window,
    Refused,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum GraphNodeCompletenessProofClassV1 {
    None,
    Refusal,
    WholeSource,
    UniquePoint,
    ParentRanges,
    CompleteMembership,
    PrincipalPoint,
    ProviderCertificate,
    OrderedPrefix,
    NamedWindow,
    ProjectionComposition,
}

macro_rules! graph_reason_enum {
    ($name:ident { $($variant:ident => $code:literal),+ $(,)? }) => {
        #[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, Ord, PartialEq, PartialOrd, Serialize)]
        pub enum $name {
            $(#[serde(rename = $code)] $variant),+
        }

        impl $name {
            pub const fn code(self) -> &'static str {
                match self { $(Self::$variant => $code),+ }
            }

            pub fn from_code(code: &str) -> Option<Self> {
                match code { $($code => Some(Self::$variant),)+ _ => None }
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str(self.code())
            }
        }
    };
}

graph_reason_enum!(GraphAdmissionRefusalReasonV1 {
    ClientAstForbidden => "SNAPBACK_GRAPH_CLIENT_AST_FORBIDDEN",
    CodeForbidden => "SNAPBACK_GRAPH_CODE_FORBIDDEN",
    RecursionForbidden => "SNAPBACK_GRAPH_RECURSION_FORBIDDEN",
    DynamicConstruction => "SNAPBACK_GRAPH_DYNAMIC_CONSTRUCTION",
    RootCountInvalid => "SNAPBACK_GRAPH_ROOT_COUNT_INVALID",
    ProjectionCountInvalid => "SNAPBACK_GRAPH_PROJECTION_COUNT_INVALID",
    NodeKindUnsupported => "SNAPBACK_GRAPH_NODE_KIND_UNSUPPORTED",
    UnknownField => "SNAPBACK_GRAPH_UNKNOWN_FIELD",
    ParentInvalid => "SNAPBACK_GRAPH_PARENT_INVALID",
    NodeInert => "SNAPBACK_GRAPH_NODE_INERT",
    Cycle => "SNAPBACK_GRAPH_CYCLE",
    UnboundedExpansion => "SNAPBACK_GRAPH_UNBOUNDED_EXPANSION",
    ThroughTableUndeclared => "SNAPBACK_GRAPH_THROUGH_TABLE_UNDECLARED",
    SchemaReferenceInvalid => "SNAPBACK_GRAPH_SCHEMA_REFERENCE_INVALID",
    IndexUnprovable => "SNAPBACK_GRAPH_INDEX_UNPROVABLE",
    IndexPrefixUnsupported => "SNAPBACK_GRAPH_INDEX_PREFIX_UNSUPPORTED",
    OrderNotTotal => "SNAPBACK_GRAPH_ORDER_NOT_TOTAL",
    ProjectionScopeInvalid => "SNAPBACK_GRAPH_PROJECTION_SCOPE_INVALID",
    ProjectionOpen => "SNAPBACK_GRAPH_PROJECTION_OPEN",
    PrincipalBindingUnprovable => "SNAPBACK_GRAPH_PRINCIPAL_BINDING_UNPROVABLE",
    SearchUnadmitted => "SNAPBACK_GRAPH_SEARCH_UNADMITTED",
    AuthorityUnprovable => "SNAPBACK_GRAPH_AUTHORITY_UNPROVABLE",
    BroadcastBaseClassInvalid => "SNAPBACK_GRAPH_BROADCAST_BASE_CLASS_INVALID",
    BroadcastSeparationUnprovable => "SNAPBACK_GRAPH_BROADCAST_SEPARATION_UNPROVABLE",
    BroadcastScopeUnbound => "SNAPBACK_GRAPH_BROADCAST_SCOPE_UNBOUND",
    BroadcastAudienceUnprovable => "SNAPBACK_GRAPH_BROADCAST_AUDIENCE_UNPROVABLE",
    BroadcastInvalidationIncomplete => "SNAPBACK_GRAPH_BROADCAST_INVALIDATION_INCOMPLETE",
    BoundInvalid => "SNAPBACK_GRAPH_BOUND_INVALID",
    ResultContractMismatch => "SNAPBACK_GRAPH_RESULT_CONTRACT_MISMATCH",
    PlanIdentityMismatch => "SNAPBACK_GRAPH_PLAN_IDENTITY_MISMATCH",
    ArgumentUnbound => "SNAPBACK_GRAPH_ARGUMENT_UNBOUND",
});

impl GraphAdmissionRefusalReasonV1 {
    /// One-based row in LLP 0209 §2.3's normative admission register.
    pub const fn row(self) -> u8 {
        match self {
            Self::ClientAstForbidden => 1,
            Self::CodeForbidden => 2,
            Self::RecursionForbidden => 3,
            Self::DynamicConstruction => 4,
            Self::RootCountInvalid => 5,
            Self::ProjectionCountInvalid => 6,
            Self::NodeKindUnsupported => 7,
            Self::UnknownField => 8,
            Self::ParentInvalid => 9,
            Self::NodeInert => 10,
            Self::Cycle => 11,
            Self::UnboundedExpansion => 12,
            Self::ThroughTableUndeclared => 13,
            Self::SchemaReferenceInvalid => 14,
            Self::IndexUnprovable => 15,
            Self::IndexPrefixUnsupported => 16,
            Self::OrderNotTotal => 17,
            Self::ProjectionScopeInvalid => 18,
            Self::ProjectionOpen => 19,
            Self::PrincipalBindingUnprovable => 20,
            Self::SearchUnadmitted => 21,
            Self::AuthorityUnprovable => 22,
            Self::BroadcastBaseClassInvalid => 23,
            Self::BroadcastSeparationUnprovable => 24,
            Self::BroadcastScopeUnbound => 25,
            Self::BroadcastAudienceUnprovable => 26,
            Self::BroadcastInvalidationIncomplete => 27,
            Self::BoundInvalid => 28,
            Self::ResultContractMismatch => 29,
            Self::PlanIdentityMismatch => 30,
            Self::ArgumentUnbound => 31,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct GraphAdmissionFaultV1 {
    pub row: u8,
    pub reason: GraphAdmissionRefusalReasonV1,
}

impl From<GraphAdmissionRefusalReasonV1> for GraphAdmissionFaultV1 {
    fn from(reason: GraphAdmissionRefusalReasonV1) -> Self {
        Self {
            row: reason.row(),
            reason,
        }
    }
}

graph_reason_enum!(GraphDemandTimeRefusalReasonV1 {
    ArgumentInvalid => "SNAPBACK_GRAPH_ARGUMENT_INVALID",
    WindowVectorInvalid => "SNAPBACK_GRAPH_WINDOW_VECTOR_INVALID",
    CursorUnbound => "SNAPBACK_GRAPH_CURSOR_UNBOUND",
    DemandIdentityMismatch => "SNAPBACK_GRAPH_DEMAND_IDENTITY_MISMATCH",
    QueryCostClientUnsupported => "SNAPBACK_QUERY_COST_CLIENT_UNSUPPORTED",
});

graph_reason_enum!(GraphEvaluationTimeRefusalReasonV1 {
    GraphRequiredEdgeMissing => "SNAPBACK_GRAPH_REQUIRED_EDGE_MISSING",
    QueryCostIndexRequired => "SNAPBACK_QUERY_COST_INDEX_REQUIRED",
    QueryCostPaginationRequired => "SNAPBACK_QUERY_COST_PAGINATION_REQUIRED",
    QueryCostBoundExceeded => "SNAPBACK_QUERY_COST_BOUND_EXCEEDED",
    QueryCostLiveTurnRefused => "SNAPBACK_QUERY_COST_LIVE_TURN_REFUSED",
    QueryCostEvidenceRequired => "SNAPBACK_QUERY_COST_EVIDENCE_REQUIRED",
    StorageVersionCorrupt => "SNAPBACK_STORAGE_VERSION_CORRUPT",
    AuthStaleResult => "SNAPBACK_AUTH_STALE_RESULT",
    LiveStageFenceRequired => "SNAPBACK_LIVE_STAGE_FENCE_REQUIRED",
    WatchAuthorityDead => "SNAPBACK_WATCH_AUTHORITY_DEAD",
    LiveEvaluationTimeout => "SNAPBACK_LIVE_EVALUATION_TIMEOUT",
});

graph_reason_enum!(GraphMaterializedRefusalReasonV1 {
    ArgumentInvalid => "SNAPBACK_GRAPH_ARGUMENT_INVALID",
    WindowVectorInvalid => "SNAPBACK_GRAPH_WINDOW_VECTOR_INVALID",
    CursorUnbound => "SNAPBACK_GRAPH_CURSOR_UNBOUND",
    DemandIdentityMismatch => "SNAPBACK_GRAPH_DEMAND_IDENTITY_MISMATCH",
    QueryCostClientUnsupported => "SNAPBACK_QUERY_COST_CLIENT_UNSUPPORTED",
    GraphRequiredEdgeMissing => "SNAPBACK_GRAPH_REQUIRED_EDGE_MISSING",
    QueryCostIndexRequired => "SNAPBACK_QUERY_COST_INDEX_REQUIRED",
    QueryCostPaginationRequired => "SNAPBACK_QUERY_COST_PAGINATION_REQUIRED",
    QueryCostBoundExceeded => "SNAPBACK_QUERY_COST_BOUND_EXCEEDED",
    QueryCostLiveTurnRefused => "SNAPBACK_QUERY_COST_LIVE_TURN_REFUSED",
    QueryCostEvidenceRequired => "SNAPBACK_QUERY_COST_EVIDENCE_REQUIRED",
    StorageVersionCorrupt => "SNAPBACK_STORAGE_VERSION_CORRUPT",
    AuthStaleResult => "SNAPBACK_AUTH_STALE_RESULT",
    LiveStageFenceRequired => "SNAPBACK_LIVE_STAGE_FENCE_REQUIRED",
    WatchAuthorityDead => "SNAPBACK_WATCH_AUTHORITY_DEAD",
    LiveEvaluationTimeout => "SNAPBACK_LIVE_EVALUATION_TIMEOUT",
});

graph_reason_enum!(GraphQualificationFailureReasonV1 {
    DerivationMissing => "SNAPBACK_GRAPH_QUALIFICATION_DERIVATION_MISSING",
    CorpusMismatch => "SNAPBACK_GRAPH_QUALIFICATION_CORPUS_MISMATCH",
});

#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum GraphCompletenessUnknownReasonV1 {
    ProofUnavailable,
    ParentRangeUnproved,
    ProviderIncomplete,
    ProviderProofInvalidated,
    ZeroTakeUnproved,
    MixedPrefixWindow,
}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
/// Physical storage identity used by demand windows and completeness proofs.
///
/// @ref LLP 0209#4-completeness-vocabulary — the id is always the row's
/// physical `_id`; application/source identities remain ordinary row fields.
pub struct GraphRowKeyV1 {
    pub table: String,
    pub id: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(transparent)]
pub struct GraphEvaluationCutV1(pub u64);

impl<'de> Deserialize<'de> for GraphEvaluationCutV1 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = u64::deserialize(deserializer)?;
        if value <= GRAPH_MAX_SAFE_INTEGER {
            Ok(Self(value))
        } else {
            Err(serde::de::Error::custom(
                "graph evaluation cut exceeds the non-negative safe-integer range",
            ))
        }
    }
}

impl JsonSchema for GraphEvaluationCutV1 {
    fn schema_name() -> std::borrow::Cow<'static, str> {
        "GraphEvaluationCutV1".into()
    }

    fn inline_schema() -> bool {
        true
    }

    fn json_schema(_: &mut schemars::SchemaGenerator) -> schemars::Schema {
        serde_json::from_value(serde_json::json!({
            "type": "integer",
            "minimum": 0
        }))
        .expect("evaluation cut is valid JSON Schema")
    }
}

macro_rules! graph_literal_bool {
    ($name:ident, $value:literal) => {
        #[derive(Clone, Copy, Debug, Eq, PartialEq)]
        pub struct $name;

        impl Serialize for $name {
            fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
            where
                S: Serializer,
            {
                serializer.serialize_bool($value)
            }
        }

        impl<'de> Deserialize<'de> for $name {
            fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
            where
                D: Deserializer<'de>,
            {
                let value = bool::deserialize(deserializer)?;
                if value == $value {
                    Ok(Self)
                } else {
                    Err(serde::de::Error::custom(concat!(
                        "expected literal boolean ",
                        stringify!($value)
                    )))
                }
            }
        }

        impl JsonSchema for $name {
            fn schema_name() -> std::borrow::Cow<'static, str> {
                stringify!($name).into()
            }

            fn inline_schema() -> bool {
                true
            }

            fn json_schema(_: &mut schemars::SchemaGenerator) -> schemars::Schema {
                serde_json::from_value(serde_json::json!({
                    "type": "boolean",
                    "const": $value
                }))
                .expect("literal boolean is valid JSON Schema")
            }
        }
    };
}

graph_literal_bool!(GraphTrueV1, true);
graph_literal_bool!(GraphFalseV1, false);

#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
pub enum GraphStableOrderProofV1 {
    #[serde(rename = "declared-order-with-id-tiebreak")]
    DeclaredOrderWithIdTiebreak,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
pub enum GraphCompositionKindV1 {
    #[serde(rename = "graph-composition")]
    GraphComposition,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphCompletenessProofTupleV1 {
    pub materialization_hash: Sha256V1,
    pub partition_hash: Sha256V1,
    pub authorization_version: AuthorizationVersion,
    pub evaluation_cut: GraphEvaluationCutV1,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphPolicyInputV1 {
    pub declaration_id: String,
    pub kind: GraphPolicyInputKindV1,
    pub identity: Sha256V1,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GraphPolicyInputKindV1 {
    PermissionBacking,
    Membership,
    Role,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphPartitionEquivalenceProofV1 {
    #[schemars(extend("const" = "snapback.graph-partition-equivalence-proof.v1"))]
    pub format: String,
    pub node_id: String,
    pub declared_class: GraphProofDeclaredClassV1,
    pub policy_inputs: Vec<GraphPolicyInputV1>,
    pub partition_function: Sha256V1,
    pub equivalence_witness: GraphEquivalenceWitnessV1,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphNodeAuthorityV1 {
    pub declared_class: GraphAuthorityClassV1,
    #[serde(deserialize_with = "deserialize_required_option")]
    pub proof: Option<GraphPartitionEquivalenceProofV1>,
}

impl JsonSchema for GraphNodeAuthorityV1 {
    fn schema_name() -> std::borrow::Cow<'static, str> {
        "GraphNodeAuthorityV1".into()
    }

    fn json_schema(generator: &mut schemars::SchemaGenerator) -> schemars::Schema {
        let proof = generator.subschema_for::<GraphPartitionEquivalenceProofV1>();
        serde_json::from_value(serde_json::json!({
            "oneOf": [
                {
                    "type":"object",
                    "properties": {
                        "declaredClass":{"type":"integer", "enum":[1, 3]},
                        "proof":{"type":"null"}
                    },
                    "required":["declaredClass", "proof"],
                    "additionalProperties":false
                },
                {
                    "type":"object",
                    "properties": {
                        "declaredClass":{"type":"integer", "const":2},
                        "proof":proof
                    },
                    "required":["declaredClass", "proof"],
                    "additionalProperties":false
                }
            ]
        }))
        .expect("graph authority union is valid JSON Schema")
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum GraphQueryShapedReasonV1 {
    #[serde(rename = "base-not-class-1")]
    BaseNotClass1,
    SeparationUnprovable,
    ScopeUnbound,
    AudienceParityFailed,
    InvalidationIncomplete,
    DeclaredQueryShaped,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(untagged)]
pub enum GraphProjectionLiteralV1 {
    Null(()),
    Boolean(bool),
    String(String),
    Number(f64),
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphProjectionFieldV1 {
    pub name: String,
    pub value: GraphProjectionValueV1,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphProjectionObjectV1 {
    pub scope_node_id: String,
    pub fields: Vec<GraphProjectionFieldV1>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum GraphProjectionValueV1 {
    Field {
        #[serde(rename = "nodeId")]
        node_id: String,
        field: String,
    },
    Literal {
        value: GraphProjectionLiteralV1,
    },
    Object {
        #[serde(rename = "nodeId")]
        node_id: String,
        object: GraphProjectionObjectV1,
    },
    Array {
        #[serde(rename = "scopeNodeId")]
        scope_node_id: String,
        item: GraphProjectionObjectV1,
    },
    Exists {
        #[serde(rename = "nodeId")]
        node_id: String,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum GraphToOnePresenceV1 {
    Required,
    Optional,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum GraphExistsModeV1 {
    Exists,
    All,
}

/// The seven closed graph node kinds. Optional fields use omission on the
/// wire; validation below enforces the kind-conditional grammar.
///
/// @ref LLP 0209#2-the-graph-ir — G0 admits a finite closed data graph, never
/// callbacks or data-dependent construction.
/// @ref LLP 0209#21-the-normalized-carrier — exact G0 node union and wire
/// spellings.
#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum GraphNodeV1 {
    RootWindow {
        #[serde(rename = "nodeId")]
        node_id: String,
        #[serde(rename = "edgeName")]
        edge_name: String,
        authority: GraphNodeAuthorityV1,
        table: String,
        visibility: TableVisibilityV1,
        filters: Vec<FilterExpr>,
        #[serde(rename = "accessIndex")]
        access_index: String,
        order: Vec<OrderExpr>,
        page: GraphDemandPageV1,
    },
    EqualityToOne {
        #[serde(rename = "nodeId")]
        node_id: String,
        #[serde(rename = "edgeName")]
        edge_name: String,
        authority: GraphNodeAuthorityV1,
        #[serde(rename = "parentNodeId")]
        parent_node_id: String,
        table: String,
        visibility: TableVisibilityV1,
        #[serde(rename = "joinOn")]
        join_on: Vec<JoinEquality>,
        #[serde(rename = "accessIndex")]
        access_index: String,
        presence: GraphToOnePresenceV1,
        #[serde(
            default,
            deserialize_with = "deserialize_optional_non_null",
            skip_serializing_if = "Option::is_none"
        )]
        #[schemars(schema_with = "filter_vector_schema")]
        filters: Option<Vec<FilterExpr>>,
    },
    BoundedToMany {
        #[serde(rename = "nodeId")]
        node_id: String,
        #[serde(rename = "edgeName")]
        edge_name: String,
        authority: GraphNodeAuthorityV1,
        #[serde(rename = "parentNodeId")]
        parent_node_id: String,
        table: String,
        visibility: TableVisibilityV1,
        #[serde(rename = "joinOn")]
        join_on: Vec<JoinEquality>,
        #[serde(rename = "accessIndex")]
        access_index: String,
        order: Vec<OrderExpr>,
        page: GraphChildPageV1,
        #[serde(
            default,
            deserialize_with = "deserialize_optional_non_null",
            skip_serializing_if = "Option::is_none"
        )]
        #[schemars(schema_with = "filter_vector_schema")]
        filters: Option<Vec<FilterExpr>>,
    },
    ExistsSemiJoin {
        #[serde(rename = "nodeId")]
        node_id: String,
        #[serde(rename = "edgeName")]
        edge_name: String,
        authority: GraphNodeAuthorityV1,
        #[serde(rename = "parentNodeId")]
        parent_node_id: String,
        mode: GraphExistsModeV1,
        edge: GraphEdgeV1,
        #[serde(
            default,
            deserialize_with = "deserialize_optional_non_null",
            skip_serializing_if = "Option::is_none"
        )]
        #[schemars(schema_with = "filter_vector_schema")]
        filters: Option<Vec<FilterExpr>>,
        #[serde(
            default,
            deserialize_with = "deserialize_optional_non_null",
            rename = "argumentId",
            skip_serializing_if = "Option::is_none"
        )]
        #[schemars(schema_with = "string_schema")]
        argument_id: Option<String>,
    },
    PrincipalBound {
        #[serde(rename = "nodeId")]
        node_id: String,
        #[serde(rename = "edgeName")]
        edge_name: String,
        #[schemars(schema_with = "principal_authority_schema")]
        authority: GraphNodeAuthorityV1,
        #[serde(rename = "parentNodeId")]
        parent_node_id: String,
        table: String,
        visibility: TableVisibilityV1,
        #[serde(rename = "parentJoin")]
        parent_join: Vec<JoinEquality>,
        #[serde(rename = "principalField")]
        principal_field: String,
        #[serde(rename = "accessIndex")]
        access_index: String,
        #[serde(rename = "principalSource")]
        #[schemars(extend("const" = "auth.userId"))]
        principal_source: String,
        #[serde(
            default,
            deserialize_with = "deserialize_optional_non_null",
            skip_serializing_if = "Option::is_none"
        )]
        #[schemars(schema_with = "principal_binding_schema")]
        binding: Option<GraphPrincipalBindingV1>,
        #[serde(
            default,
            deserialize_with = "deserialize_optional_non_null",
            skip_serializing_if = "Option::is_none"
        )]
        #[schemars(schema_with = "filter_vector_schema")]
        filters: Option<Vec<FilterExpr>>,
    },
    SearchMembership {
        #[serde(rename = "nodeId")]
        node_id: String,
        #[serde(rename = "edgeName")]
        edge_name: String,
        authority: GraphNodeAuthorityV1,
        #[serde(rename = "parentNodeId")]
        parent_node_id: String,
        #[serde(rename = "providerCapabilityId")]
        provider_capability_id: String,
        #[serde(rename = "membershipIdentity")]
        membership_identity: GraphSearchMembershipIdentityV1,
        #[serde(rename = "memberField")]
        member_field: String,
        #[serde(rename = "scopeBindings")]
        scope_bindings: Vec<GraphSearchScopeBindingV1>,
        #[serde(rename = "invalidationTables")]
        invalidation_tables: Vec<String>,
        #[serde(rename = "providerCompletenessClass")]
        provider_completeness_class: GraphProviderCompletenessClassV1,
        #[serde(
            default,
            deserialize_with = "deserialize_optional_non_null",
            rename = "argumentIds",
            skip_serializing_if = "Option::is_none"
        )]
        #[schemars(schema_with = "string_vector_schema")]
        argument_ids: Option<Vec<String>>,
    },
    ClosedProjection {
        #[serde(rename = "nodeId")]
        node_id: String,
        #[serde(rename = "edgeName")]
        edge_name: String,
        authority: GraphNodeAuthorityV1,
        object: GraphProjectionObjectV1,
    },
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphNodeCostV1 {
    pub node_id: String,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    #[schemars(schema_with = "u64_schema")]
    pub max_root_rows_per_page: Option<u64>,
    pub max_examined_entries_per_execution: u64,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    #[schemars(schema_with = "u64_schema")]
    pub max_relationship_lookups_per_execution: Option<u64>,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    #[schemars(schema_with = "u64_schema")]
    pub max_children_per_parent: Option<u64>,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    #[schemars(schema_with = "u64_schema")]
    pub max_argument_expansion: Option<u64>,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    #[schemars(schema_with = "u64_schema")]
    pub max_window_pages: Option<u64>,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    #[schemars(schema_with = "u64_schema")]
    pub max_window_root_rows: Option<u64>,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    #[schemars(schema_with = "u64_schema")]
    pub max_window_scanned_rows: Option<u64>,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    #[schemars(schema_with = "u64_schema")]
    pub max_window_result_rows: Option<u64>,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    #[schemars(schema_with = "u64_schema")]
    pub max_window_result_bytes: Option<u64>,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    #[schemars(schema_with = "u64_schema")]
    pub max_window_index_ranges: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphArgumentCostV1 {
    pub argument_id: String,
    pub max_items: u64,
}

#[derive(Clone, Debug, Deserialize, Default, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphWindowRollupV1 {
    pub max_window_pages: u64,
    pub max_window_root_rows: u64,
    pub max_window_scanned_rows: u64,
    pub max_window_result_rows: u64,
    pub max_window_result_bytes: u64,
    pub max_window_index_ranges: u64,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphQueryCostV1 {
    pub nodes: Vec<GraphNodeCostV1>,
    pub arguments: Vec<GraphArgumentCostV1>,
    pub max_argument_items: u64,
    pub max_page_result_bytes: u64,
    pub window_rollup: GraphWindowRollupV1,
    pub max_maintained_writes_per_mutation: u64,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum GraphAuthorityEventSelectorV1 {
    PermissionBackingWrite {
        table: String,
        #[serde(rename = "permissionFields")]
        #[serde(deserialize_with = "deserialize_required_option")]
        #[schemars(required, schema_with = "nullable_string_vector_schema")]
        permission_fields: Option<Vec<String>>,
        scope: GraphAuthorityEventScopeV1,
    },
    AuthorizationMetadataActivation {
        #[serde(rename = "declarationId")]
        declaration_id: String,
    },
    AuthorizationIncarnationChange {
        cause: GraphAuthorizationIncarnationCauseV1,
    },
    OutOfBandPermissionRevocation {
        #[serde(rename = "declarationId")]
        declaration_id: String,
    },
    AuthorityTransition {
        cause: GraphAuthorityTransitionCauseV1,
    },
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum GraphAuthorityEventScopeV1 {
    Bindings {
        bindings: Vec<GraphAuthorityScopeBindingV1>,
    },
    AllDeclarationScopes,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphAuthorityScopeBindingV1 {
    pub row_field: String,
    pub scope_argument_id: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum GraphAuthorizationIncarnationCauseV1 {
    AppReset,
    LogicalImport,
    DeclaredPhysicalRestore,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum GraphAuthorityTransitionCauseV1 {
    Login,
    Logout,
    UserSwitch,
    SessionExpiry,
    AdminSessionRevocation,
    LeaseExpiry,
    GrantIssued,
    GrantEnded,
    CredentialIssued,
    CredentialEnded,
    TokenIssued,
    TokenEnded,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphAuthorityClass2InputV1 {
    pub node_id: String,
    pub declaration_id: String,
    pub scope_argument_ids: Vec<String>,
    pub policy_identity: Sha256V1,
    pub event_selectors: Vec<GraphAuthorityEventSelectorV1>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum GraphClass3PartitionV1 {
    None,
    PartitionOfOne,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphAuthorityPartitionRuleV1 {
    #[schemars(extend("const" = "snapback.graph-authority-partition-rule.v1"))]
    pub format: String,
    pub class2_inputs: Vec<GraphAuthorityClass2InputV1>,
    pub class3: GraphClass3PartitionV1,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphBroadcastResourceEqualityV1 {
    pub node_id: String,
    pub field: String,
    pub argument_id: String,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphBroadcastScopeV1 {
    pub argument_ids: Vec<String>,
    pub policy_identity: Sha256V1,
    pub resource_equalities: Vec<GraphBroadcastResourceEqualityV1>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphBroadcastAudienceV1 {
    pub strict_evaluator_identity: Sha256V1,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphBroadcastInvalidationV1 {
    pub declaration_id: String,
    pub event: GraphAuthorityEventSelectorV1,
    pub affected_scope_argument_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphBroadcastEstablishmentV1 {
    pub effect: GraphBroadcastEffectV1,
    pub predicate: TableVisibilityV1,
    pub overlay_projection: (),
    pub scope: GraphBroadcastScopeV1,
    pub audience: GraphBroadcastAudienceV1,
    pub invalidation: Vec<GraphBroadcastInvalidationV1>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
pub enum GraphBroadcastEffectV1 {
    #[serde(rename = "admit-only")]
    AdmitOnly,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(tag = "classification", rename_all = "kebab-case", deny_unknown_fields)]
pub enum GraphBroadcastAdmissionV1 {
    QueryShaped {
        #[schemars(extend("const" = "snapback.graph-broadcast-admission.v1"))]
        format: String,
        reason: GraphQueryShapedReasonV1,
    },
    Broadcast {
        #[schemars(extend("const" = "snapback.graph-broadcast-admission.v1"))]
        format: String,
        #[serde(rename = "baseNodeIds")]
        base_node_ids: Vec<String>,
        establishment: GraphBroadcastEstablishmentV1,
    },
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphQueryCostEnvelopeV1 {
    pub max_scanned_rows: u64,
    pub max_index_ranges: u64,
    pub max_result_rows: u64,
    pub max_result_bytes: u64,
    pub max_evaluation_turn_ms: u64,
    pub max_observers: u64,
    pub max_distinct_evaluation_groups: u64,
    pub max_estimated_live_fanout_ms: u64,
    pub graph: GraphQueryCostV1,
}

/// Complete normalized graph plan and all plan-hashed policy/bound facts.
///
/// @ref LLP 0209#2-the-graph-ir — this closed normalized graph IR executes in G2-A without callbacks or data-dependent shape.
/// @ref LLP 0209#21-the-normalized-carrier — the plan is finite, closed, and
/// uses preorder node ids plus canonical argument ids.
#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphQueryPlanV1 {
    #[schemars(extend("const" = "snapback.graph-query-plan.v1"))]
    pub format: String,
    #[schemars(extend("const" = "graph_query_v1"))]
    pub capability_id: String,
    #[schemars(extend("const" = "n0"))]
    pub root_node_id: String,
    pub nodes: Vec<GraphNodeV1>,
    pub arguments: Vec<GraphArgumentV1>,
    pub query_cost: GraphQueryCostEnvelopeV1,
    pub authority_partition_rule: GraphAuthorityPartitionRuleV1,
    pub broadcast: GraphBroadcastAdmissionV1,
    pub result_contract_hash: Sha256V1,
}

/// Exact payload of `HandlerPlan::GraphQuery`.
#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphQueryCarrierV1 {
    pub normalized_plan: GraphQueryPlanV1,
    pub plan_hash: Sha256V1,
}

pub type GraphPlanIdentityV1 = GraphQueryCarrierV1;

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphWindowIdentityV1 {
    pub order: Vec<OrderExpr>,
    pub direction: GraphDirectionV1,
    pub lower: GraphIntervalEndV1,
    pub upper: GraphIntervalEndV1,
    pub take: u64,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphParentWindowIdentityV1 {
    #[serde(deserialize_with = "deserialize_required_option")]
    #[schemars(required, schema_with = "nullable_graph_row_key_schema")]
    pub parent_key: Option<GraphRowKeyV1>,
    pub window: GraphWindowIdentityV1,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphNodeWindowIdentityV1 {
    pub node_id: String,
    pub intervals: Vec<GraphParentWindowIdentityV1>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphInstancePreimageV1 {
    #[schemars(extend("const" = "snapback.graph-instance.v1"))]
    pub format: String,
    pub graph_plan_hash: Sha256V1,
    pub args_digest: Sha256V1,
    pub windows: Vec<GraphNodeWindowIdentityV1>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphInstanceIdentityV1 {
    pub preimage: GraphInstancePreimageV1,
    pub instance_hash: Sha256V1,
}

pub type ExpectedGenerationV1 = ArtifactGeneration;

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphExportedFunctionIdentityV1 {
    pub artifact_kind: GraphExportedFunctionArtifactKindV1,
    pub schema_version: String,
    pub app_id: String,
    pub id: String,
    pub name: String,
    pub kind: GraphExportedFunctionKindV1,
    pub implementation_hash: Sha256V1,
    pub args_contract_hash: Sha256V1,
    pub result_contract_hash: Sha256V1,
    pub expected_generation: ExpectedGenerationV1,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
pub enum GraphExportedFunctionArtifactKindV1 {
    #[serde(rename = "functionReference")]
    FunctionReference,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
pub enum GraphExportedFunctionKindV1 {
    Query,
    LiveQuery,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphMaterializationPreimageV1 {
    #[schemars(extend("const" = "snapback.graph-materialization.v1"))]
    pub format: String,
    pub app_id: String,
    pub database_id: String,
    pub deployment_id: String,
    pub target_profile_id: String,
    pub activation_hash: Sha256V1,
    pub function: GraphExportedFunctionIdentityV1,
    pub graph_instance_hash: Sha256V1,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphMaterializationIdentityV1 {
    pub preimage: GraphMaterializationPreimageV1,
    pub materialization_hash: Sha256V1,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphIntervalV1 {
    pub lower: GraphIntervalEndV1,
    pub upper: GraphIntervalEndV1,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphCompleteIntervalV1 {
    pub lower: GraphUnboundedEndV1,
    pub upper: GraphUnboundedEndV1,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum GraphUnboundedEndV1 {
    Unbounded,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphFoundRowV1 {
    pub parent_key: GraphRowKeyV1,
    pub found: bool,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphCompleteParentRangeV1 {
    pub parent_key: GraphRowKeyV1,
    pub consumed: u64,
    pub cap: u64,
    pub has_more: GraphFalseV1,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphWindowParentRangeV1 {
    pub parent_key: GraphRowKeyV1,
    pub interval: GraphIntervalV1,
    pub consumed: u64,
    pub cap: u64,
    pub has_more: bool,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphPrefixParentRangeV1 {
    pub parent_key: GraphRowKeyV1,
    pub consumed: u64,
    pub cap: u64,
    pub has_more: GraphTrueV1,
    pub continuation: KeysetKeyV1,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphExistenceRowV1 {
    pub parent_key: GraphRowKeyV1,
    pub existence_bit: bool,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphPrincipalFoundRowV1 {
    pub parent_key: GraphRowKeyV1,
    pub binding_found: bool,
    pub target_found: bool,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(tag = "label", rename_all = "lowercase", deny_unknown_fields)]
pub enum GraphRootCompletenessEvidenceV1 {
    Unknown {
        reason: GraphCompletenessUnknownReasonV1,
    },
    Refused {
        reason: GraphMaterializedRefusalReasonV1,
    },
    Prefix {
        order: Vec<OrderExpr>,
        continuation: KeysetKeyV1,
        #[serde(rename = "stableOrderProof")]
        stable_order_proof: GraphStableOrderProofV1,
        take: u64,
        consumed: u64,
        #[serde(rename = "hasMore")]
        has_more: GraphTrueV1,
    },
    Window {
        interval: GraphIntervalV1,
        take: u64,
        consumed: u64,
        #[serde(rename = "hasMore")]
        has_more: GraphFalseV1,
    },
    Complete {
        interval: GraphCompleteIntervalV1,
        consumed: u64,
        #[serde(rename = "hasMore")]
        has_more: GraphFalseV1,
        #[serde(rename = "sourceExhausted")]
        source_exhausted: GraphTrueV1,
    },
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(tag = "label", rename_all = "lowercase", deny_unknown_fields)]
pub enum GraphToOneCompletenessEvidenceV1 {
    Unknown {
        reason: GraphCompletenessUnknownReasonV1,
    },
    Refused {
        reason: GraphMaterializedRefusalReasonV1,
    },
    Complete {
        rows: Vec<GraphFoundRowV1>,
    },
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(tag = "label", rename_all = "lowercase", deny_unknown_fields)]
pub enum GraphToManyCompletenessEvidenceV1 {
    Unknown {
        reason: GraphCompletenessUnknownReasonV1,
    },
    Refused {
        reason: GraphMaterializedRefusalReasonV1,
    },
    Complete {
        ranges: Vec<GraphCompleteParentRangeV1>,
    },
    Window {
        ranges: Vec<GraphWindowParentRangeV1>,
    },
    Prefix {
        order: Vec<OrderExpr>,
        #[serde(rename = "stableOrderProof")]
        stable_order_proof: GraphStableOrderProofV1,
        ranges: Vec<GraphPrefixParentRangeV1>,
    },
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(tag = "label", rename_all = "lowercase", deny_unknown_fields)]
pub enum GraphSemiJoinCompletenessEvidenceV1 {
    Unknown {
        reason: GraphCompletenessUnknownReasonV1,
    },
    Refused {
        reason: GraphMaterializedRefusalReasonV1,
    },
    Complete {
        rows: Vec<GraphExistenceRowV1>,
    },
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(tag = "label", rename_all = "lowercase", deny_unknown_fields)]
pub enum GraphPrincipalCompletenessEvidenceV1 {
    Unknown {
        reason: GraphCompletenessUnknownReasonV1,
    },
    Refused {
        reason: GraphMaterializedRefusalReasonV1,
    },
    Complete {
        rows: Vec<GraphPrincipalFoundRowV1>,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum GraphSearchUnknownReasonV1 {
    ProviderIncomplete,
    ProviderProofInvalidated,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(tag = "label", rename_all = "lowercase", deny_unknown_fields)]
pub enum GraphSearchCompletenessEvidenceV1 {
    Refused {
        reason: GraphMaterializedRefusalReasonV1,
    },
    Complete {
        #[serde(rename = "providerCompletenessClass")]
        provider_completeness_class: GraphProviderCompletenessClassV1,
        #[serde(rename = "providerCertificateHash")]
        provider_certificate_hash: Sha256V1,
    },
    Unknown {
        #[serde(rename = "providerCompletenessClass")]
        provider_completeness_class: GraphProviderCompletenessClassV1,
        reason: GraphSearchUnknownReasonV1,
    },
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(tag = "label", rename_all = "lowercase", deny_unknown_fields)]
pub enum GraphProjectionCompletenessEvidenceV1 {
    Unknown {
        composition: GraphCompositionProofV1,
    },
    Refused {
        reason: GraphMaterializedRefusalReasonV1,
        composition: GraphCompositionProofV1,
    },
    Complete {
        composition: GraphCompositionProofV1,
    },
    Prefix {
        composition: GraphCompositionProofV1,
    },
    Window {
        composition: GraphCompositionProofV1,
    },
}

/// Completeness evidence is discriminated by the exact `(kind, label)` pair;
/// there is no arbitrary payload escape hatch.
#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum GraphNodeCompletenessEvidenceV1 {
    RootWindow {
        #[serde(flatten)]
        evidence: GraphRootCompletenessEvidenceV1,
    },
    EqualityToOne {
        #[serde(flatten)]
        evidence: GraphToOneCompletenessEvidenceV1,
    },
    BoundedToMany {
        #[serde(flatten)]
        evidence: GraphToManyCompletenessEvidenceV1,
    },
    ExistsSemiJoin {
        #[serde(flatten)]
        evidence: GraphSemiJoinCompletenessEvidenceV1,
    },
    PrincipalBound {
        #[serde(flatten)]
        evidence: GraphPrincipalCompletenessEvidenceV1,
    },
    SearchMembership {
        #[serde(flatten)]
        evidence: GraphSearchCompletenessEvidenceV1,
    },
    ClosedProjection {
        #[serde(flatten)]
        evidence: GraphProjectionCompletenessEvidenceV1,
    },
}

#[derive(Clone, Debug, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphNodeCompletenessProofV1 {
    #[serde(flatten)]
    pub tuple: GraphCompletenessProofTupleV1,
    #[serde(flatten)]
    pub evidence: GraphNodeCompletenessEvidenceV1,
}

impl<'de> Deserialize<'de> for GraphNodeCompletenessProofV1 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = Value::deserialize(deserializer)?;
        let object = value.as_object().ok_or_else(|| {
            serde::de::Error::custom("graph completeness proof must be an object")
        })?;
        let kind = object
            .get("kind")
            .and_then(Value::as_str)
            .ok_or_else(|| serde::de::Error::missing_field("kind"))?;
        let label = object
            .get("label")
            .and_then(Value::as_str)
            .ok_or_else(|| serde::de::Error::missing_field("label"))?;
        let extras: &[&str] = match (kind, label) {
            ("root-window", "unknown") | ("root-window", "refused") => &["reason"],
            ("root-window", "prefix") => &[
                "order",
                "continuation",
                "stableOrderProof",
                "take",
                "consumed",
                "hasMore",
            ],
            ("root-window", "window") => &["interval", "take", "consumed", "hasMore"],
            ("root-window", "complete") => &["interval", "consumed", "hasMore", "sourceExhausted"],
            ("equality-to-one", "unknown")
            | ("equality-to-one", "refused")
            | ("exists-semi-join", "unknown")
            | ("exists-semi-join", "refused")
            | ("principal-bound", "unknown")
            | ("principal-bound", "refused")
            | ("search-membership", "refused") => &["reason"],
            ("equality-to-one", "complete")
            | ("exists-semi-join", "complete")
            | ("principal-bound", "complete") => &["rows"],
            ("bounded-to-many", "unknown") | ("bounded-to-many", "refused") => &["reason"],
            ("bounded-to-many", "complete") | ("bounded-to-many", "window") => &["ranges"],
            ("bounded-to-many", "prefix") => &["order", "stableOrderProof", "ranges"],
            ("search-membership", "complete") => {
                &["providerCompletenessClass", "providerCertificateHash"]
            }
            ("search-membership", "unknown") => &["providerCompletenessClass", "reason"],
            ("closed-projection", "unknown")
            | ("closed-projection", "complete")
            | ("closed-projection", "prefix")
            | ("closed-projection", "window") => &["composition"],
            ("closed-projection", "refused") => &["reason", "composition"],
            _ => {
                return Err(serde::de::Error::custom(format!(
                    "unsupported graph completeness pair ({kind}, {label})"
                )));
            }
        };
        let base = [
            "materializationHash",
            "partitionHash",
            "authorizationVersion",
            "evaluationCut",
            "kind",
            "label",
        ];
        let allowed = base
            .into_iter()
            .chain(extras.iter().copied())
            .collect::<BTreeSet<_>>();
        if object.keys().any(|key| !allowed.contains(key.as_str()))
            || allowed.iter().any(|key| !object.contains_key(*key))
        {
            return Err(serde::de::Error::custom(
                "graph completeness proof has missing or unknown fields",
            ));
        }
        let tuple_keys = [
            "materializationHash",
            "partitionHash",
            "authorizationVersion",
            "evaluationCut",
        ];
        let tuple = serde_json::from_value(Value::Object(
            object
                .iter()
                .filter(|(key, _)| tuple_keys.contains(&key.as_str()))
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect(),
        ))
        .map_err(serde::de::Error::custom)?;
        let evidence_value = Value::Object(
            object
                .iter()
                .filter(|(key, _)| key.as_str() == "label" || extras.contains(&key.as_str()))
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect(),
        );
        let evidence = match kind {
            "root-window" => GraphNodeCompletenessEvidenceV1::RootWindow {
                evidence: serde_json::from_value(evidence_value)
                    .map_err(serde::de::Error::custom)?,
            },
            "equality-to-one" => GraphNodeCompletenessEvidenceV1::EqualityToOne {
                evidence: serde_json::from_value(evidence_value)
                    .map_err(serde::de::Error::custom)?,
            },
            "bounded-to-many" => GraphNodeCompletenessEvidenceV1::BoundedToMany {
                evidence: serde_json::from_value(evidence_value)
                    .map_err(serde::de::Error::custom)?,
            },
            "exists-semi-join" => GraphNodeCompletenessEvidenceV1::ExistsSemiJoin {
                evidence: serde_json::from_value(evidence_value)
                    .map_err(serde::de::Error::custom)?,
            },
            "principal-bound" => GraphNodeCompletenessEvidenceV1::PrincipalBound {
                evidence: serde_json::from_value(evidence_value)
                    .map_err(serde::de::Error::custom)?,
            },
            "search-membership" => GraphNodeCompletenessEvidenceV1::SearchMembership {
                evidence: serde_json::from_value(evidence_value)
                    .map_err(serde::de::Error::custom)?,
            },
            "closed-projection" => GraphNodeCompletenessEvidenceV1::ClosedProjection {
                evidence: serde_json::from_value(evidence_value)
                    .map_err(serde::de::Error::custom)?,
            },
            _ => unreachable!("kind was checked above"),
        };
        Ok(Self { tuple, evidence })
    }
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphCompositionNodeCitationV1 {
    pub node_id: String,
    pub node_kind: GraphDataNodeKindV1,
    pub label: GraphCompletenessLabelV1,
    pub proof_hash: Sha256V1,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(tag = "label", rename_all = "lowercase", deny_unknown_fields)]
pub enum GraphCompositionEvidenceV1 {
    Refused {
        nodes: Vec<GraphCompositionNodeCitationV1>,
        #[serde(rename = "primaryReason")]
        primary_reason: GraphMaterializedRefusalReasonV1,
    },
    Unknown {
        nodes: Vec<GraphCompositionNodeCitationV1>,
        reason: GraphCompletenessUnknownReasonV1,
    },
    Complete {
        nodes: Vec<GraphCompositionNodeCitationV1>,
        #[serde(rename = "allComplete")]
        all_complete: GraphTrueV1,
    },
    Prefix {
        nodes: Vec<GraphCompositionNodeCitationV1>,
        #[serde(rename = "partialNodeIds")]
        partial_node_ids: Vec<String>,
    },
    Window {
        nodes: Vec<GraphCompositionNodeCitationV1>,
        #[serde(rename = "partialNodeIds")]
        partial_node_ids: Vec<String>,
    },
}

#[derive(Clone, Debug, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphCompositionProofV1 {
    #[serde(flatten)]
    pub tuple: GraphCompletenessProofTupleV1,
    pub kind: GraphCompositionKindV1,
    #[serde(flatten)]
    pub evidence: GraphCompositionEvidenceV1,
}

impl<'de> Deserialize<'de> for GraphCompositionProofV1 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = Value::deserialize(deserializer)?;
        let object = value
            .as_object()
            .ok_or_else(|| serde::de::Error::custom("graph composition proof must be an object"))?;
        let label = object
            .get("label")
            .and_then(Value::as_str)
            .ok_or_else(|| serde::de::Error::missing_field("label"))?;
        let extras: &[&str] = match label {
            "refused" => &["nodes", "primaryReason"],
            "unknown" => &["nodes", "reason"],
            "complete" => &["nodes", "allComplete"],
            "prefix" | "window" => &["nodes", "partialNodeIds"],
            _ => {
                return Err(serde::de::Error::custom(
                    "unsupported graph composition label",
                ));
            }
        };
        let base = [
            "materializationHash",
            "partitionHash",
            "authorizationVersion",
            "evaluationCut",
            "kind",
            "label",
        ];
        let allowed = base
            .into_iter()
            .chain(extras.iter().copied())
            .collect::<BTreeSet<_>>();
        if object.keys().any(|key| !allowed.contains(key.as_str()))
            || allowed.iter().any(|key| !object.contains_key(*key))
        {
            return Err(serde::de::Error::custom(
                "graph composition proof has missing or unknown fields",
            ));
        }
        let tuple_keys = [
            "materializationHash",
            "partitionHash",
            "authorizationVersion",
            "evaluationCut",
        ];
        let tuple = serde_json::from_value(Value::Object(
            object
                .iter()
                .filter(|(key, _)| tuple_keys.contains(&key.as_str()))
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect(),
        ))
        .map_err(serde::de::Error::custom)?;
        let kind = serde_json::from_value(
            object
                .get("kind")
                .cloned()
                .ok_or_else(|| serde::de::Error::missing_field("kind"))?,
        )
        .map_err(serde::de::Error::custom)?;
        let evidence = serde_json::from_value(Value::Object(
            object
                .iter()
                .filter(|(key, _)| key.as_str() == "label" || extras.contains(&key.as_str()))
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect(),
        ))
        .map_err(serde::de::Error::custom)?;
        Ok(Self {
            tuple,
            kind,
            evidence,
        })
    }
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum GraphParentEdgeDependencyV1 {
    ParentPoint {
        table: String,
        index: String,
        #[serde(rename = "parentKey")]
        parent_key: GraphRowKeyV1,
        #[serde(rename = "lookupKey")]
        lookup_key: Vec<Value>,
        #[serde(rename = "childKey")]
        #[serde(deserialize_with = "deserialize_required_option")]
        #[schemars(required, schema_with = "nullable_graph_row_key_schema")]
        child_key: Option<GraphRowKeyV1>,
        found: bool,
        #[serde(rename = "rowVersion")]
        #[serde(deserialize_with = "deserialize_required_option")]
        #[schemars(required, schema_with = "nullable_u64_schema")]
        row_version: Option<u64>,
    },
    ParentLookupSkipped {
        table: String,
        index: String,
        #[serde(rename = "parentKey")]
        parent_key: GraphRowKeyV1,
        reason: GraphParentLookupSkippedReasonV1,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
pub enum GraphParentLookupSkippedReasonV1 {
    #[serde(rename = "null-or-omitted-key")]
    NullOrOmittedKey,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schemars(extend(
    "allOf" = [{
        "if": {
            "properties": { "argumentId": { "type": "null" } },
            "required": ["argumentId"]
        },
        "then": { "not": { "required": ["argumentDigest"] } },
        "else": { "required": ["argumentDigest"] }
    }]
))]
pub struct GraphMembershipDependencyV1 {
    pub kind: GraphMembershipDependencyKindV1,
    pub tables: Vec<String>,
    pub indexes: Vec<String>,
    pub parent_key: GraphRowKeyV1,
    #[serde(deserialize_with = "deserialize_required_option")]
    #[schemars(required, schema_with = "nullable_string_schema")]
    pub argument_id: Option<String>,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    #[schemars(schema_with = "sha256_schema")]
    pub argument_digest: Option<Sha256V1>,
    pub matched_count: u64,
    pub complete: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
pub enum GraphMembershipDependencyKindV1 {
    #[serde(rename = "membership")]
    Membership,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum GraphCapturedDependencyV1 {
    RootRange {
        table: String,
        index: String,
        predicate: Vec<FilterExpr>,
        order: Vec<OrderExpr>,
        limit: u64,
        #[serde(rename = "resultCount")]
        result_count: u64,
        #[serde(deserialize_with = "deserialize_required_option")]
        #[schemars(required, schema_with = "nullable_keyset_key_schema")]
        boundary: Option<KeysetKeyV1>,
        complete: bool,
    },
    ParentPoint {
        table: String,
        index: String,
        #[serde(rename = "parentKey")]
        parent_key: GraphRowKeyV1,
        #[serde(rename = "lookupKey")]
        lookup_key: Vec<Value>,
        #[serde(rename = "childKey")]
        #[serde(deserialize_with = "deserialize_required_option")]
        #[schemars(required, schema_with = "nullable_graph_row_key_schema")]
        child_key: Option<GraphRowKeyV1>,
        found: bool,
        #[serde(rename = "rowVersion")]
        #[serde(deserialize_with = "deserialize_required_option")]
        #[schemars(required, schema_with = "nullable_u64_schema")]
        row_version: Option<u64>,
    },
    ParentLookupSkipped {
        table: String,
        index: String,
        #[serde(rename = "parentKey")]
        parent_key: GraphRowKeyV1,
        reason: GraphParentLookupSkippedReasonV1,
    },
    ParentRange {
        table: String,
        index: String,
        #[serde(rename = "parentKey")]
        parent_key: GraphRowKeyV1,
        predicate: Vec<FilterExpr>,
        order: Vec<OrderExpr>,
        limit: u64,
        #[serde(rename = "resultCount")]
        result_count: u64,
        #[serde(deserialize_with = "deserialize_required_option")]
        #[schemars(required, schema_with = "nullable_keyset_key_schema")]
        boundary: Option<KeysetKeyV1>,
        complete: bool,
    },
    #[schemars(extend(
        "allOf" = [{
            "if": {
                "properties": { "argumentId": { "type": "null" } },
                "required": ["argumentId"]
            },
            "then": { "not": { "required": ["argumentDigest"] } },
            "else": { "required": ["argumentDigest"] }
        }]
    ))]
    Membership {
        tables: Vec<String>,
        indexes: Vec<String>,
        #[serde(rename = "parentKey")]
        parent_key: GraphRowKeyV1,
        #[serde(rename = "argumentId")]
        #[serde(deserialize_with = "deserialize_required_option")]
        #[schemars(required, schema_with = "nullable_string_schema")]
        argument_id: Option<String>,
        #[serde(
            default,
            deserialize_with = "deserialize_optional_non_null",
            rename = "argumentDigest",
            skip_serializing_if = "Option::is_none"
        )]
        #[schemars(schema_with = "sha256_schema")]
        argument_digest: Option<Sha256V1>,
        #[serde(rename = "matchedCount")]
        matched_count: u64,
        complete: bool,
    },
    PrincipalField {
        table: String,
        index: String,
        #[serde(rename = "partitionHash")]
        partition_hash: Sha256V1,
        field: String,
        #[serde(rename = "valueDigest")]
        value_digest: Sha256V1,
        found: bool,
    },
    SearchTable {
        table: String,
        #[serde(rename = "membershipIdentity")]
        membership_identity: GraphSearchMembershipIdentityV1,
        #[serde(rename = "providerVersion")]
        provider_version: String,
    },
    Projection {
        #[serde(rename = "sourceNodeIds")]
        source_node_ids: Vec<String>,
    },
}

/// Additive graph-specific captured-read payload. It is carried only beside
/// `CapturedReadKind::GraphNode`; G0 registers and validates the vocabulary
/// but does not consume it in matching.
///
/// @ref LLP 0209#51-captured-vocabulary-by-normalized-node — one top-level
/// graph read kind contains the closed per-node dependency union.
#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphCapturedReadV1 {
    #[schemars(extend("const" = "snapback.graph-captured-read.v1"))]
    pub format: String,
    pub graph_plan_hash: Sha256V1,
    pub instance_hash: Sha256V1,
    pub node_id: String,
    pub node_kind: GraphNodeKindV1,
    pub authority_class: GraphAuthorityClassV1,
    pub dependency: GraphCapturedDependencyV1,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphResolvedPartitionInputV1 {
    pub node_id: String,
    pub declaration_id: String,
    pub scope_identity: Sha256V1,
    pub policy_identity: Sha256V1,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphAuthorityPartitionPreimageV1 {
    #[schemars(extend("const" = "snapback.graph-authority-partition.v1"))]
    pub format: String,
    pub graph_plan_hash: Sha256V1,
    pub class2: Vec<GraphResolvedPartitionInputV1>,
    #[serde(deserialize_with = "deserialize_required_option")]
    #[schemars(required, schema_with = "nullable_authority_partition_schema")]
    pub class3: Option<AuthorityPartitionV1>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphAuthorityPartitionIdentityV1 {
    pub preimage: GraphAuthorityPartitionPreimageV1,
    pub partition_hash: Sha256V1,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphBroadcastScopeArgumentV1 {
    pub argument_id: String,
    pub value: Value,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphBroadcastScopePreimageV1 {
    #[schemars(extend("const" = "snapback.graph-broadcast-scope.v1"))]
    pub format: String,
    pub graph_materialization_hash: Sha256V1,
    pub policy_identity: Sha256V1,
    pub arguments: Vec<GraphBroadcastScopeArgumentV1>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphBroadcastScopeIdentityV1 {
    pub preimage: GraphBroadcastScopePreimageV1,
    pub scope_hash: Sha256V1,
}

fn graph_domain_hash<T: Serialize>(domain: &[u8], value: &T) -> Result<Sha256V1, ()> {
    let value = serde_json::to_value(value).map_err(|_| ())?;
    let digest = super::types::domain_hash(domain, &value).map_err(|_| ())?;
    Sha256V1::new(digest).map_err(|_| ())
}

fn canonical_client_value_is_valid(value: &Value) -> bool {
    fn visit(value: &Value, depth: usize, nodes: &mut usize) -> bool {
        *nodes += 1;
        if *nodes > CANONICAL_CLIENT_MAX_NODES || depth > CANONICAL_CLIENT_MAX_DEPTH {
            return false;
        }
        match value {
            Value::Null | Value::Bool(_) | Value::Number(_) => true,
            Value::String(value) => value.len() <= CANONICAL_CLIENT_MAX_STRING_BYTES,
            Value::Array(values) => {
                values.len() <= CANONICAL_CLIENT_MAX_ARRAY_ENTRIES
                    && values.iter().all(|value| visit(value, depth + 1, nodes))
            }
            Value::Object(fields) => {
                fields.len() <= CANONICAL_CLIENT_MAX_OBJECT_FIELDS
                    && fields
                        .keys()
                        .all(|key| key.len() <= CANONICAL_CLIENT_MAX_STRING_BYTES)
                    && fields.values().all(|value| visit(value, depth + 1, nodes))
            }
        }
    }

    let mut nodes = 0;
    visit(value, 1, &mut nodes)
        && crate::rqs_contract::jcs(value)
            .is_ok_and(|canonical| canonical.len() <= CANONICAL_CLIENT_MAX_JCS_BYTES)
}

fn utf16_cmp(left: &str, right: &str) -> Ordering {
    left.encode_utf16().cmp(right.encode_utf16())
}

fn jcs_sort_key<T: Serialize>(value: &T) -> Option<String> {
    serde_json::to_value(value)
        .ok()
        .and_then(|value| crate::rqs_contract::jcs(&value).ok())
}

fn sort_by_jcs_key<T: Serialize, E>(values: &mut Vec<T>, refusal: E) -> Result<(), E> {
    let keys = values
        .iter()
        .map(jcs_sort_key)
        .collect::<Option<Vec<_>>>()
        .ok_or(refusal)?;
    let mut keyed = keys
        .into_iter()
        .zip(std::mem::take(values))
        .collect::<Vec<_>>();
    keyed.sort_by(|(left, _), (right, _)| left.cmp(right));
    values.extend(keyed.into_iter().map(|(_, value)| value));
    Ok(())
}

fn checked_add(left: u64, right: u64) -> Result<u64, GraphAdmissionRefusalReasonV1> {
    left.checked_add(right)
        .filter(|value| *value <= GRAPH_MAX_SAFE_INTEGER)
        .ok_or(GraphAdmissionRefusalReasonV1::BoundInvalid)
}

fn checked_mul(left: u64, right: u64) -> Result<u64, GraphAdmissionRefusalReasonV1> {
    left.checked_mul(right)
        .filter(|value| *value <= GRAPH_MAX_SAFE_INTEGER)
        .ok_or(GraphAdmissionRefusalReasonV1::BoundInvalid)
}

fn sort_dedup_utf16(values: &mut Vec<String>) {
    values.sort_by(|left, right| utf16_cmp(left, right));
    values.dedup();
}

fn normalize_visibility(
    visibility: &mut TableVisibilityV1,
) -> Result<(), GraphAdmissionRefusalReasonV1> {
    match visibility {
        TableVisibilityV1::Membership { roles, .. } => {
            if let Some(roles) = roles {
                sort_dedup_utf16(roles);
            }
        }
        TableVisibilityV1::AnyOf { arms } => {
            for arm in arms.iter_mut() {
                if let TableVisibilityArmV1::Membership { roles, .. } = arm
                    && let Some(roles) = roles
                {
                    sort_dedup_utf16(roles);
                }
            }
            sort_by_jcs_key(arms, GraphAdmissionRefusalReasonV1::ArgumentUnbound)?;
            arms.dedup();
        }
        TableVisibilityV1::PublicRead | TableVisibilityV1::Owner { .. } => {}
    }
    Ok(())
}

fn normalize_authority_event_selector(selector: &mut GraphAuthorityEventSelectorV1) {
    if let GraphAuthorityEventSelectorV1::PermissionBackingWrite {
        permission_fields, ..
    } = selector
        && let Some(permission_fields) = permission_fields
    {
        sort_dedup_utf16(permission_fields);
    }
}

impl GraphNodeV1 {
    pub fn node_id(&self) -> &str {
        match self {
            Self::RootWindow { node_id, .. }
            | Self::EqualityToOne { node_id, .. }
            | Self::BoundedToMany { node_id, .. }
            | Self::ExistsSemiJoin { node_id, .. }
            | Self::PrincipalBound { node_id, .. }
            | Self::SearchMembership { node_id, .. }
            | Self::ClosedProjection { node_id, .. } => node_id,
        }
    }

    fn set_node_id(&mut self, value: String) {
        match self {
            Self::RootWindow { node_id, .. }
            | Self::EqualityToOne { node_id, .. }
            | Self::BoundedToMany { node_id, .. }
            | Self::ExistsSemiJoin { node_id, .. }
            | Self::PrincipalBound { node_id, .. }
            | Self::SearchMembership { node_id, .. }
            | Self::ClosedProjection { node_id, .. } => *node_id = value,
        }
    }

    pub fn edge_name(&self) -> &str {
        match self {
            Self::RootWindow { edge_name, .. }
            | Self::EqualityToOne { edge_name, .. }
            | Self::BoundedToMany { edge_name, .. }
            | Self::ExistsSemiJoin { edge_name, .. }
            | Self::PrincipalBound { edge_name, .. }
            | Self::SearchMembership { edge_name, .. }
            | Self::ClosedProjection { edge_name, .. } => edge_name,
        }
    }

    pub fn parent_node_id(&self) -> Option<&str> {
        match self {
            Self::EqualityToOne { parent_node_id, .. }
            | Self::BoundedToMany { parent_node_id, .. }
            | Self::ExistsSemiJoin { parent_node_id, .. }
            | Self::PrincipalBound { parent_node_id, .. }
            | Self::SearchMembership { parent_node_id, .. } => Some(parent_node_id),
            Self::RootWindow { .. } | Self::ClosedProjection { .. } => None,
        }
    }

    fn parent_node_id_mut(&mut self) -> Option<&mut String> {
        match self {
            Self::EqualityToOne { parent_node_id, .. }
            | Self::BoundedToMany { parent_node_id, .. }
            | Self::ExistsSemiJoin { parent_node_id, .. }
            | Self::PrincipalBound { parent_node_id, .. }
            | Self::SearchMembership { parent_node_id, .. } => Some(parent_node_id),
            Self::RootWindow { .. } | Self::ClosedProjection { .. } => None,
        }
    }

    pub fn kind(&self) -> GraphNodeKindV1 {
        match self {
            Self::RootWindow { .. } => GraphNodeKindV1::RootWindow,
            Self::EqualityToOne { .. } => GraphNodeKindV1::EqualityToOne,
            Self::BoundedToMany { .. } => GraphNodeKindV1::BoundedToMany,
            Self::ExistsSemiJoin { .. } => GraphNodeKindV1::ExistsSemiJoin,
            Self::PrincipalBound { .. } => GraphNodeKindV1::PrincipalBound,
            Self::SearchMembership { .. } => GraphNodeKindV1::SearchMembership,
            Self::ClosedProjection { .. } => GraphNodeKindV1::ClosedProjection,
        }
    }

    pub fn authority(&self) -> &GraphNodeAuthorityV1 {
        match self {
            Self::RootWindow { authority, .. }
            | Self::EqualityToOne { authority, .. }
            | Self::BoundedToMany { authority, .. }
            | Self::ExistsSemiJoin { authority, .. }
            | Self::PrincipalBound { authority, .. }
            | Self::SearchMembership { authority, .. }
            | Self::ClosedProjection { authority, .. } => authority,
        }
    }

    fn authority_mut(&mut self) -> &mut GraphNodeAuthorityV1 {
        match self {
            Self::RootWindow { authority, .. }
            | Self::EqualityToOne { authority, .. }
            | Self::BoundedToMany { authority, .. }
            | Self::ExistsSemiJoin { authority, .. }
            | Self::PrincipalBound { authority, .. }
            | Self::SearchMembership { authority, .. }
            | Self::ClosedProjection { authority, .. } => authority,
        }
    }

    fn order(&self) -> Option<&[OrderExpr]> {
        match self {
            Self::RootWindow { order, .. } | Self::BoundedToMany { order, .. } => Some(order),
            _ => None,
        }
    }

    fn demand_paged(&self) -> bool {
        matches!(self, Self::RootWindow { .. })
            || matches!(
                self,
                Self::BoundedToMany {
                    page: GraphChildPageV1::Demand(_),
                    ..
                }
            )
    }
}

fn replace_id(
    value: &mut String,
    ids: &BTreeMap<String, String>,
) -> Result<(), GraphAdmissionRefusalReasonV1> {
    *value = ids
        .get(value)
        .cloned()
        .ok_or(GraphAdmissionRefusalReasonV1::ParentInvalid)?;
    Ok(())
}

fn rewrite_projection_ids(
    object: &mut GraphProjectionObjectV1,
    ids: &BTreeMap<String, String>,
) -> Result<(), GraphAdmissionRefusalReasonV1> {
    replace_id(&mut object.scope_node_id, ids)?;
    for field in &mut object.fields {
        match &mut field.value {
            GraphProjectionValueV1::Field { node_id, .. }
            | GraphProjectionValueV1::Exists { node_id } => replace_id(node_id, ids)?,
            GraphProjectionValueV1::Object { node_id, object } => {
                replace_id(node_id, ids)?;
                rewrite_projection_ids(object, ids)?;
            }
            GraphProjectionValueV1::Array {
                scope_node_id,
                item,
            } => {
                replace_id(scope_node_id, ids)?;
                rewrite_projection_ids(item, ids)?;
            }
            GraphProjectionValueV1::Literal { .. } => {}
        }
    }
    Ok(())
}

fn rewrite_filter_arguments(
    filter: &mut FilterExpr,
    argument_names: &BTreeMap<String, String>,
    argument_ids: &BTreeMap<String, String>,
) -> Result<(), GraphAdmissionRefusalReasonV1> {
    match &mut filter.value {
        ValueExpr::Arg(argument) => {
            *argument = argument_names
                .get(argument)
                .or_else(|| argument_ids.get(argument))
                .cloned()
                .ok_or(GraphAdmissionRefusalReasonV1::ArgumentUnbound)?;
            Ok(())
        }
        ValueExpr::Literal(value) if crate::rqs_contract::jcs(value).is_ok() => Ok(()),
        // The reused ValueExpr vocabulary is deliberately narrowed here.
        // Graph shape/operator positions are plan data, and graph filters may
        // contain only one normalized argument reference or a literal. Ambient
        // host values and executable expression trees are not graph plan data.
        _ => Err(GraphAdmissionRefusalReasonV1::CodeForbidden),
    }
}

fn normalize_filters(
    filters: &mut Vec<FilterExpr>,
    argument_names: &BTreeMap<String, String>,
    argument_ids: &BTreeMap<String, String>,
) -> Result<(), GraphAdmissionRefusalReasonV1> {
    for filter in filters.iter_mut() {
        rewrite_filter_arguments(filter, argument_names, argument_ids)?;
    }
    sort_by_jcs_key(filters, GraphAdmissionRefusalReasonV1::ArgumentUnbound)?;
    Ok(())
}

fn normalize_optional_filters(
    filters: &mut Option<Vec<FilterExpr>>,
    argument_names: &BTreeMap<String, String>,
    argument_ids: &BTreeMap<String, String>,
) -> Result<(), GraphAdmissionRefusalReasonV1> {
    if let Some(filters) = filters {
        if filters.is_empty() {
            return Err(GraphAdmissionRefusalReasonV1::UnknownField);
        }
        normalize_filters(filters, argument_names, argument_ids)?;
    }
    Ok(())
}

fn preorder_visit(
    node_id: &str,
    nodes: &BTreeMap<String, GraphNodeV1>,
    children: &BTreeMap<String, Vec<String>>,
    state: &mut BTreeMap<String, u8>,
    ordered: &mut Vec<String>,
) -> Result<(), GraphAdmissionRefusalReasonV1> {
    match state.get(node_id).copied().unwrap_or(0) {
        1 => return Err(GraphAdmissionRefusalReasonV1::Cycle),
        2 => return Ok(()),
        _ => {}
    }
    state.insert(node_id.to_owned(), 1);
    ordered.push(node_id.to_owned());
    if let Some(child_ids) = children.get(node_id) {
        let mut child_ids = child_ids.clone();
        child_ids
            .sort_by(|left, right| utf16_cmp(nodes[left].edge_name(), nodes[right].edge_name()));
        for child_id in child_ids {
            preorder_visit(&child_id, nodes, children, state, ordered)?;
        }
    }
    state.insert(node_id.to_owned(), 2);
    Ok(())
}

fn graph_has_parent_cycle(nodes: &BTreeMap<String, GraphNodeV1>) -> bool {
    for start in nodes.keys() {
        let mut path = BTreeSet::new();
        let mut cursor = Some(start.as_str());
        while let Some(node_id) = cursor {
            if !path.insert(node_id.to_owned()) {
                return true;
            }
            cursor = nodes
                .get(node_id)
                .and_then(GraphNodeV1::parent_node_id)
                .filter(|parent| nodes.contains_key(*parent));
        }
    }
    false
}

/// Reconstruct the one canonical preorder-DFS plan. Children sort by UTF-16
/// `edgeName`, arguments by UTF-16 name, filter conjunctions by JCS bytes,
/// and `_id` remains outside all declared order/key-entry vectors.
///
/// @ref LLP 0209#21-the-normalized-carrier — compiler-assigned dense preorder
/// ids make source declaration order irrelevant.
pub fn normalized_graph_plan(
    plan: &GraphQueryPlanV1,
) -> Result<GraphQueryPlanV1, GraphAdmissionRefusalReasonV1> {
    let mut data_nodes = BTreeMap::<String, GraphNodeV1>::new();
    let mut roots = Vec::new();
    let mut projections = Vec::new();
    for node in &plan.nodes {
        if node.node_id().is_empty() || data_nodes.contains_key(node.node_id()) {
            return Err(GraphAdmissionRefusalReasonV1::UnknownField);
        }
        match node {
            GraphNodeV1::RootWindow { .. } => roots.push(node.node_id().to_owned()),
            GraphNodeV1::ClosedProjection { .. } => {
                projections.push((node.node_id().to_owned(), node.clone()));
                continue;
            }
            _ => {}
        }
        data_nodes.insert(node.node_id().to_owned(), node.clone());
    }
    if roots.len() != 1 {
        return Err(GraphAdmissionRefusalReasonV1::RootCountInvalid);
    }
    if projections.len() != 1 {
        return Err(GraphAdmissionRefusalReasonV1::ProjectionCountInvalid);
    }

    let mut children = BTreeMap::<String, Vec<String>>::new();
    let mut sibling_names = BTreeSet::<(String, String)>::new();
    for node in data_nodes.values() {
        if let Some(parent) = node.parent_node_id() {
            if !data_nodes.contains_key(parent) {
                return Err(GraphAdmissionRefusalReasonV1::ParentInvalid);
            }
            if !sibling_names.insert((parent.to_owned(), node.edge_name().to_owned())) {
                return Err(GraphAdmissionRefusalReasonV1::UnknownField);
            }
            children
                .entry(parent.to_owned())
                .or_default()
                .push(node.node_id().to_owned());
        }
    }
    if graph_has_parent_cycle(&data_nodes) {
        return Err(GraphAdmissionRefusalReasonV1::Cycle);
    }
    let mut ordered_old_ids = Vec::new();
    preorder_visit(
        &roots[0],
        &data_nodes,
        &children,
        &mut BTreeMap::new(),
        &mut ordered_old_ids,
    )?;
    if ordered_old_ids.len() != data_nodes.len() {
        return Err(GraphAdmissionRefusalReasonV1::ParentInvalid);
    }

    let mut ids = ordered_old_ids
        .iter()
        .enumerate()
        .map(|(index, old)| (old.clone(), format!("n{index}")))
        .collect::<BTreeMap<_, _>>();
    ids.insert(
        projections[0].0.clone(),
        format!("n{}", ordered_old_ids.len()),
    );

    let mut arguments = plan.arguments.clone();
    arguments.sort_by(|left, right| utf16_cmp(&left.name, &right.name));
    let mut argument_ids = BTreeMap::new();
    let mut argument_names = BTreeMap::new();
    let generated_argument_ids = (0..arguments.len())
        .map(|index| format!("a{index}"))
        .collect::<BTreeSet<_>>();
    for (index, argument) in arguments.iter_mut().enumerate() {
        let normalized_id = format!("a{index}");
        if argument.name.is_empty()
            || generated_argument_ids.contains(&argument.name)
            || argument_names
                .insert(argument.name.clone(), normalized_id.clone())
                .is_some()
            || argument.argument_id.is_empty()
            || argument_ids
                .insert(argument.argument_id.clone(), normalized_id.clone())
                .is_some()
        {
            return Err(GraphAdmissionRefusalReasonV1::ArgumentUnbound);
        }
        argument.argument_id = normalized_id;
        argument.contract_hash = graph_domain_hash(
            b"snapback:argument-binding-contract:v1:",
            &argument.contract,
        )
        .map_err(|_| GraphAdmissionRefusalReasonV1::ArgumentUnbound)?;
    }
    let canonical_argument_order = arguments
        .iter()
        .enumerate()
        .map(|(index, argument)| (argument.argument_id.clone(), index))
        .collect::<BTreeMap<_, _>>();

    let mut nodes = Vec::with_capacity(plan.nodes.len());
    for old_id in &ordered_old_ids {
        let mut node = data_nodes[old_id].clone();
        node.set_node_id(ids[old_id].clone());
        if let Some(parent) = node.parent_node_id_mut() {
            replace_id(parent, &ids)?;
        }
        if let Some(proof) = &mut node.authority_mut().proof {
            replace_id(&mut proof.node_id, &ids)?;
            let rebuilt = recompute_graph_partition_equivalence_proof_v1(proof)?;
            if proof.partition_function != rebuilt.partition_function {
                return Err(GraphAdmissionRefusalReasonV1::AuthorityUnprovable);
            }
            *proof = rebuilt;
        }
        match &mut node {
            GraphNodeV1::RootWindow {
                visibility,
                filters,
                ..
            } => {
                normalize_visibility(visibility)?;
                normalize_filters(filters, &argument_names, &argument_ids)?;
            }
            GraphNodeV1::EqualityToOne {
                visibility,
                filters,
                ..
            }
            | GraphNodeV1::BoundedToMany {
                visibility,
                filters,
                ..
            } => {
                normalize_visibility(visibility)?;
                normalize_optional_filters(filters, &argument_names, &argument_ids)?;
            }
            GraphNodeV1::PrincipalBound {
                visibility,
                binding,
                filters,
                ..
            } => {
                normalize_visibility(visibility)?;
                if let Some(binding) = binding {
                    normalize_visibility(&mut binding.visibility)?;
                }
                normalize_optional_filters(filters, &argument_names, &argument_ids)?;
            }
            GraphNodeV1::ExistsSemiJoin {
                edge,
                filters,
                argument_id,
                ..
            } => {
                match edge {
                    GraphEdgeV1::Direct(edge) => normalize_visibility(&mut edge.visibility)?,
                    GraphEdgeV1::Through(edge) => {
                        normalize_visibility(&mut edge.visibility)?;
                        normalize_visibility(&mut edge.target_visibility)?;
                    }
                }
                normalize_optional_filters(filters, &argument_names, &argument_ids)?;
                if let Some(argument_id) = argument_id {
                    *argument_id = argument_ids
                        .get(argument_id)
                        .cloned()
                        .ok_or(GraphAdmissionRefusalReasonV1::ArgumentUnbound)?;
                }
            }
            GraphNodeV1::SearchMembership {
                scope_bindings,
                argument_ids: search_argument_ids,
                invalidation_tables,
                ..
            } => {
                for binding in scope_bindings {
                    match &mut binding.source {
                        GraphSearchScopeSourceV1::Argument { argument_id } => {
                            *argument_id = argument_ids
                                .get(argument_id)
                                .cloned()
                                .ok_or(GraphAdmissionRefusalReasonV1::ArgumentUnbound)?;
                        }
                        GraphSearchScopeSourceV1::ParentField { node_id, .. } => {
                            replace_id(node_id, &ids)?;
                        }
                    }
                }
                if let Some(search_argument_ids) = search_argument_ids {
                    for argument_id in search_argument_ids.iter_mut() {
                        *argument_id = argument_ids
                            .get(argument_id)
                            .cloned()
                            .ok_or(GraphAdmissionRefusalReasonV1::ArgumentUnbound)?;
                    }
                    search_argument_ids.sort_by_key(|argument_id| {
                        canonical_argument_order
                            .get(argument_id)
                            .copied()
                            .unwrap_or(usize::MAX)
                    });
                    search_argument_ids.dedup();
                }
                invalidation_tables.sort_by(|left, right| utf16_cmp(left, right));
                invalidation_tables.dedup();
            }
            GraphNodeV1::ClosedProjection { .. } => unreachable!(),
        }
        nodes.push(node);
    }

    let mut projection = projections[0].1.clone();
    projection.set_node_id(ids[&projections[0].0].clone());
    if let Some(proof) = &mut projection.authority_mut().proof {
        replace_id(&mut proof.node_id, &ids)?;
        let rebuilt = recompute_graph_partition_equivalence_proof_v1(proof)?;
        if proof.partition_function != rebuilt.partition_function {
            return Err(GraphAdmissionRefusalReasonV1::AuthorityUnprovable);
        }
        *proof = rebuilt;
    }
    let GraphNodeV1::ClosedProjection { object, .. } = &mut projection else {
        unreachable!()
    };
    rewrite_projection_ids(object, &ids)?;
    nodes.push(projection);

    let mut normalized = plan.clone();
    normalized.root_node_id = "n0".to_owned();
    normalized.nodes = nodes;
    normalized.arguments = arguments;

    let mut costs = plan
        .query_cost
        .graph
        .nodes
        .iter()
        .map(|cost| (cost.node_id.clone(), cost.clone()))
        .collect::<BTreeMap<_, _>>();
    normalized.query_cost.graph.nodes = ordered_old_ids
        .iter()
        .map(|old_id| {
            let mut cost = costs
                .remove(old_id)
                .ok_or(GraphAdmissionRefusalReasonV1::UnboundedExpansion)?;
            cost.node_id = ids[old_id].clone();
            Ok(cost)
        })
        .collect::<Result<Vec<_>, _>>()?;
    if !costs.is_empty() {
        return Err(GraphAdmissionRefusalReasonV1::BoundInvalid);
    }
    normalized.query_cost.graph.arguments = plan
        .query_cost
        .graph
        .arguments
        .iter()
        .map(|cost| {
            Ok(GraphArgumentCostV1 {
                argument_id: argument_ids
                    .get(&cost.argument_id)
                    .cloned()
                    .ok_or(GraphAdmissionRefusalReasonV1::ArgumentUnbound)?,
                max_items: cost.max_items,
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    normalized
        .query_cost
        .graph
        .arguments
        .sort_by_key(|argument| {
            canonical_argument_order
                .get(&argument.argument_id)
                .copied()
                .unwrap_or(usize::MAX)
        });

    for input in &mut normalized.authority_partition_rule.class2_inputs {
        replace_id(&mut input.node_id, &ids)?;
        for argument_id in &mut input.scope_argument_ids {
            *argument_id = argument_ids
                .get(argument_id)
                .cloned()
                .ok_or(GraphAdmissionRefusalReasonV1::ArgumentUnbound)?;
        }
        input
            .scope_argument_ids
            .sort_by(|left, right| utf16_cmp(left, right));
        input.scope_argument_ids.dedup();
        for selector in &mut input.event_selectors {
            normalize_authority_event_selector(selector);
        }
        sort_by_jcs_key(
            &mut input.event_selectors,
            GraphAdmissionRefusalReasonV1::ArgumentUnbound,
        )?;
    }
    normalized
        .authority_partition_rule
        .class2_inputs
        .sort_by(|left, right| {
            utf16_cmp(&left.node_id, &right.node_id)
                .then_with(|| utf16_cmp(&left.declaration_id, &right.declaration_id))
        });

    match &mut normalized.broadcast {
        GraphBroadcastAdmissionV1::QueryShaped { reason, .. } => {
            *reason = if normalized
                .nodes
                .iter()
                .filter(|node| !matches!(node, GraphNodeV1::ClosedProjection { .. }))
                .any(|node| node.authority().declared_class != GraphAuthorityClassV1::INDEPENDENT)
            {
                GraphQueryShapedReasonV1::BaseNotClass1
            } else {
                GraphQueryShapedReasonV1::DeclaredQueryShaped
            };
        }
        GraphBroadcastAdmissionV1::Broadcast {
            base_node_ids,
            establishment,
            ..
        } => {
            *base_node_ids = (0..ordered_old_ids.len())
                .map(|index| format!("n{index}"))
                .collect();
            normalize_visibility(&mut establishment.predicate)?;
            for argument_id in &mut establishment.scope.argument_ids {
                *argument_id = argument_ids
                    .get(argument_id)
                    .cloned()
                    .ok_or(GraphAdmissionRefusalReasonV1::ArgumentUnbound)?;
            }
            establishment.scope.argument_ids.sort_by_key(|argument_id| {
                canonical_argument_order
                    .get(argument_id)
                    .copied()
                    .unwrap_or(usize::MAX)
            });
            establishment.scope.argument_ids.dedup();
            for equality in &mut establishment.scope.resource_equalities {
                replace_id(&mut equality.node_id, &ids)?;
                equality.argument_id = argument_ids
                    .get(&equality.argument_id)
                    .cloned()
                    .ok_or(GraphAdmissionRefusalReasonV1::ArgumentUnbound)?;
            }
            for invalidation in &mut establishment.invalidation {
                normalize_authority_event_selector(&mut invalidation.event);
                for argument_id in &mut invalidation.affected_scope_argument_ids {
                    *argument_id = argument_ids
                        .get(argument_id)
                        .cloned()
                        .ok_or(GraphAdmissionRefusalReasonV1::ArgumentUnbound)?;
                }
                invalidation
                    .affected_scope_argument_ids
                    .sort_by(|left, right| utf16_cmp(left, right));
                invalidation.affected_scope_argument_ids.dedup();
            }
        }
    }

    Ok(normalized)
}

/// Recompute a class-2 proof's canonical declared-input vector and dedicated
/// partition-function digest.
///
/// @ref LLP 0209#31-class-enum-and-compiler-proofs — class-2 authority is
/// proved by an exact, ordered owner-declaration vector rather than trusted.
pub fn recompute_graph_partition_equivalence_proof_v1(
    proof: &GraphPartitionEquivalenceProofV1,
) -> Result<GraphPartitionEquivalenceProofV1, GraphAdmissionRefusalReasonV1> {
    if proof.format != "snapback.graph-partition-equivalence-proof.v1"
        || proof.policy_inputs.is_empty()
    {
        return Err(GraphAdmissionRefusalReasonV1::AuthorityUnprovable);
    }
    let policy_inputs = proof.policy_inputs.clone();
    let kind_keys = policy_inputs
        .iter()
        .map(|input| jcs_sort_key(&input.kind))
        .collect::<Option<Vec<_>>>()
        .ok_or(GraphAdmissionRefusalReasonV1::AuthorityUnprovable)?;
    let mut keyed_inputs = kind_keys.into_iter().zip(policy_inputs).collect::<Vec<_>>();
    keyed_inputs.sort_by(|(left_key, left), (right_key, right)| {
        utf16_cmp(&left.declaration_id, &right.declaration_id)
            .then_with(|| left_key.cmp(right_key))
            .then_with(|| utf16_cmp(left.identity.as_str(), right.identity.as_str()))
    });
    let policy_inputs = keyed_inputs
        .into_iter()
        .map(|(_, input)| input)
        .collect::<Vec<_>>();
    if policy_inputs.windows(2).any(|pair| pair[0] == pair[1]) {
        return Err(GraphAdmissionRefusalReasonV1::AuthorityUnprovable);
    }
    let partition_function =
        graph_domain_hash(b"snapback:graph-partition-function:v1:", &policy_inputs)
            .map_err(|_| GraphAdmissionRefusalReasonV1::AuthorityUnprovable)?;
    Ok(GraphPartitionEquivalenceProofV1 {
        format: "snapback.graph-partition-equivalence-proof.v1".to_owned(),
        node_id: proof.node_id.clone(),
        declared_class: GraphProofDeclaredClassV1::Class2,
        policy_inputs,
        partition_function,
        equivalence_witness: GraphEquivalenceWitnessV1::DeclaredInputsOnly,
    })
}

fn graph_window_fields(cost: &GraphNodeCostV1) -> [Option<u64>; 6] {
    [
        cost.max_window_pages,
        cost.max_window_root_rows,
        cost.max_window_scanned_rows,
        cost.max_window_result_rows,
        cost.max_window_result_bytes,
        cost.max_window_index_ranges,
    ]
}

fn require_positive(value: Option<u64>) -> bool {
    value.is_some_and(|value| (1..=GRAPH_MAX_SAFE_INTEGER).contains(&value))
}

fn validate_order(order: &[OrderExpr]) -> Result<(), GraphAdmissionRefusalReasonV1> {
    if order.is_empty()
        || order.iter().any(|entry| entry.field == "_id")
        || order
            .iter()
            .map(|entry| &entry.field)
            .collect::<BTreeSet<_>>()
            .len()
            != order.len()
    {
        return Err(GraphAdmissionRefusalReasonV1::OrderNotTotal);
    }
    Ok(())
}

fn validate_keyset_for_order(
    key: &KeysetKeyV1,
    order: &[OrderExpr],
) -> Result<(), GraphDemandTimeRefusalReasonV1> {
    if key.id.is_empty()
        || key.entries.len() != order.len()
        || key
            .entries
            .iter()
            .zip(order)
            .any(|((field, _), ordered)| field == "_id" || field != &ordered.field)
    {
        return Err(GraphDemandTimeRefusalReasonV1::WindowVectorInvalid);
    }
    Ok(())
}

fn validate_authority(
    node: &GraphNodeV1,
    nodes: &BTreeMap<String, &GraphNodeV1>,
) -> Result<(), GraphAdmissionRefusalReasonV1> {
    let authority = node.authority();
    match authority.declared_class {
        GraphAuthorityClassV1::INDEPENDENT | GraphAuthorityClassV1::PRINCIPAL_SCOPED => {
            if authority.proof.is_some() {
                return Err(GraphAdmissionRefusalReasonV1::AuthorityUnprovable);
            }
        }
        GraphAuthorityClassV1::PARTITION_SCOPED => {
            let proof = authority
                .proof
                .as_ref()
                .ok_or(GraphAdmissionRefusalReasonV1::AuthorityUnprovable)?;
            if proof.node_id != node.node_id()
                || recompute_graph_partition_equivalence_proof_v1(proof)? != *proof
            {
                return Err(GraphAdmissionRefusalReasonV1::AuthorityUnprovable);
            }
        }
        _ => return Err(GraphAdmissionRefusalReasonV1::AuthorityUnprovable),
    }
    if matches!(node, GraphNodeV1::PrincipalBound { .. })
        && authority.declared_class != GraphAuthorityClassV1::PRINCIPAL_SCOPED
    {
        return Err(GraphAdmissionRefusalReasonV1::PrincipalBindingUnprovable);
    }
    let visibility_class = |visibility: &TableVisibilityV1| match visibility {
        TableVisibilityV1::PublicRead => GraphAuthorityClassV1::INDEPENDENT,
        TableVisibilityV1::Owner { .. } => GraphAuthorityClassV1::PRINCIPAL_SCOPED,
        // Raw membership visibility is principal-relative. It becomes class 2
        // only through the non-null, host-reconstructed equivalence proof
        // checked above; otherwise §3.1 conservatively derives class 3.
        TableVisibilityV1::Membership { .. } => {
            if authority.declared_class == GraphAuthorityClassV1::PARTITION_SCOPED {
                GraphAuthorityClassV1::PARTITION_SCOPED
            } else {
                GraphAuthorityClassV1::PRINCIPAL_SCOPED
            }
        }
        TableVisibilityV1::AnyOf { arms } => {
            if arms
                .iter()
                .any(|arm| matches!(arm, TableVisibilityArmV1::Owner { .. }))
            {
                GraphAuthorityClassV1::PRINCIPAL_SCOPED
            } else if authority.declared_class == GraphAuthorityClassV1::PARTITION_SCOPED {
                GraphAuthorityClassV1::PARTITION_SCOPED
            } else {
                GraphAuthorityClassV1::PRINCIPAL_SCOPED
            }
        }
    };
    let local_class = match node {
        GraphNodeV1::RootWindow { visibility, .. }
        | GraphNodeV1::EqualityToOne { visibility, .. }
        | GraphNodeV1::BoundedToMany { visibility, .. } => Some(visibility_class(visibility)),
        GraphNodeV1::ExistsSemiJoin { edge, .. } => Some(match edge {
            GraphEdgeV1::Direct(edge) => visibility_class(&edge.visibility),
            GraphEdgeV1::Through(edge) => std::cmp::max(
                visibility_class(&edge.visibility),
                visibility_class(&edge.target_visibility),
            ),
        }),
        GraphNodeV1::PrincipalBound { .. } => Some(GraphAuthorityClassV1::PRINCIPAL_SCOPED),
        GraphNodeV1::SearchMembership {
            membership_identity,
            ..
        } => Some(membership_identity.authority_class),
        GraphNodeV1::ClosedProjection { .. } => None,
    };
    let parent_class = node
        .parent_node_id()
        .and_then(|parent_id| nodes.get(parent_id))
        .map(|parent| parent.authority().declared_class);
    let derived_minimum = local_class
        .into_iter()
        .chain(parent_class)
        .max()
        .unwrap_or(GraphAuthorityClassV1::INDEPENDENT);
    if authority.declared_class < derived_minimum {
        return Err(GraphAdmissionRefusalReasonV1::AuthorityUnprovable);
    }
    Ok(())
}

fn validate_projection_scope(
    object: &GraphProjectionObjectV1,
    nodes: &BTreeMap<String, &GraphNodeV1>,
) -> Result<(), GraphAdmissionRefusalReasonV1> {
    validate_projection_scope_at(object, &object.scope_node_id, nodes)
}

fn projection_source_node_ids(object: &GraphProjectionObjectV1, source_ids: &mut BTreeSet<String>) {
    source_ids.insert(object.scope_node_id.clone());
    for field in &object.fields {
        match &field.value {
            GraphProjectionValueV1::Field { node_id, .. }
            | GraphProjectionValueV1::Exists { node_id } => {
                source_ids.insert(node_id.clone());
            }
            GraphProjectionValueV1::Object { node_id, object } => {
                source_ids.insert(node_id.clone());
                projection_source_node_ids(object, source_ids);
            }
            GraphProjectionValueV1::Array {
                scope_node_id,
                item,
            } => {
                source_ids.insert(scope_node_id.clone());
                projection_source_node_ids(item, source_ids);
            }
            GraphProjectionValueV1::Literal { .. } => {}
        }
    }
}

fn validate_projection_scope_at(
    object: &GraphProjectionObjectV1,
    effective_scope: &str,
    nodes: &BTreeMap<String, &GraphNodeV1>,
) -> Result<(), GraphAdmissionRefusalReasonV1> {
    if !nodes.contains_key(&object.scope_node_id) {
        return Err(GraphAdmissionRefusalReasonV1::ProjectionScopeInvalid);
    }
    let mut names = BTreeSet::new();
    for field in &object.fields {
        if field.name.is_empty() || !names.insert(&field.name) {
            return Err(GraphAdmissionRefusalReasonV1::UnknownField);
        }
        match &field.value {
            GraphProjectionValueV1::Field { node_id, field } => {
                if field.is_empty() || !is_scope_or_ancestor(node_id, effective_scope, nodes) {
                    return Err(GraphAdmissionRefusalReasonV1::ProjectionScopeInvalid);
                }
            }
            GraphProjectionValueV1::Literal { value } => {
                if matches!(value, GraphProjectionLiteralV1::Number(value) if !value.is_finite()) {
                    return Err(GraphAdmissionRefusalReasonV1::UnknownField);
                }
            }
            GraphProjectionValueV1::Object {
                node_id,
                object: child,
            } => {
                let Some(node) = nodes.get(node_id) else {
                    return Err(GraphAdmissionRefusalReasonV1::ProjectionScopeInvalid);
                };
                if child.scope_node_id != effective_scope
                    || node.parent_node_id() != Some(effective_scope)
                    || !matches!(
                        node,
                        GraphNodeV1::EqualityToOne { .. } | GraphNodeV1::PrincipalBound { .. }
                    )
                {
                    return Err(GraphAdmissionRefusalReasonV1::ProjectionScopeInvalid);
                }
                validate_projection_scope_at(child, node_id, nodes)?;
            }
            GraphProjectionValueV1::Array {
                scope_node_id,
                item,
            } => {
                let Some(node) = nodes.get(scope_node_id) else {
                    return Err(GraphAdmissionRefusalReasonV1::ProjectionScopeInvalid);
                };
                if item.scope_node_id != *scope_node_id
                    || node.parent_node_id() != Some(effective_scope)
                    || !matches!(node, GraphNodeV1::BoundedToMany { .. })
                {
                    return Err(GraphAdmissionRefusalReasonV1::ProjectionScopeInvalid);
                }
                validate_projection_scope_at(item, scope_node_id, nodes)?;
            }
            GraphProjectionValueV1::Exists { node_id } => {
                let Some(node) = nodes.get(node_id) else {
                    return Err(GraphAdmissionRefusalReasonV1::ProjectionScopeInvalid);
                };
                if node.parent_node_id() != Some(effective_scope)
                    || !matches!(node, GraphNodeV1::ExistsSemiJoin { .. })
                {
                    return Err(GraphAdmissionRefusalReasonV1::ProjectionScopeInvalid);
                }
            }
        }
    }
    Ok(())
}

fn is_scope_or_ancestor(
    candidate: &str,
    scope: &str,
    nodes: &BTreeMap<String, &GraphNodeV1>,
) -> bool {
    let mut cursor = Some(scope);
    while let Some(node_id) = cursor {
        if node_id == candidate {
            return true;
        }
        cursor = nodes.get(node_id).and_then(|node| node.parent_node_id());
    }
    false
}

fn graph_filter_multiplicative_inputs(
    filters: &[FilterExpr],
) -> Result<(BTreeSet<String>, u64), GraphAdmissionRefusalReasonV1> {
    let mut arguments = BTreeSet::new();
    let mut literal_factor = 1_u64;
    for filter in filters {
        if filter.op != FilterOp::In {
            continue;
        }
        match &filter.value {
            ValueExpr::Arg(argument_id) => {
                arguments.insert(argument_id.clone());
            }
            ValueExpr::Literal(Value::Array(items)) if !items.is_empty() => {
                literal_factor = checked_mul(
                    literal_factor,
                    u64::try_from(items.len())
                        .map_err(|_| GraphAdmissionRefusalReasonV1::BoundInvalid)?,
                )?;
            }
            _ => return Err(GraphAdmissionRefusalReasonV1::BoundInvalid),
        }
    }
    Ok((arguments, literal_factor))
}

fn graph_node_filter_slice(node: &GraphNodeV1) -> &[FilterExpr] {
    match node {
        GraphNodeV1::RootWindow { filters, .. } => filters,
        GraphNodeV1::EqualityToOne { filters, .. }
        | GraphNodeV1::BoundedToMany { filters, .. }
        | GraphNodeV1::ExistsSemiJoin { filters, .. }
        | GraphNodeV1::PrincipalBound { filters, .. } => filters.as_deref().unwrap_or_default(),
        GraphNodeV1::SearchMembership { .. } | GraphNodeV1::ClosedProjection { .. } => &[],
    }
}

fn graph_node_multiplicative_argument_ids(
    node: &GraphNodeV1,
) -> Result<BTreeSet<String>, GraphAdmissionRefusalReasonV1> {
    let (mut arguments, _) = graph_filter_multiplicative_inputs(graph_node_filter_slice(node))?;
    match node {
        GraphNodeV1::ExistsSemiJoin {
            mode: GraphExistsModeV1::All,
            argument_id: Some(argument_id),
            ..
        } => {
            arguments.insert(argument_id.clone());
        }
        GraphNodeV1::SearchMembership {
            argument_ids: Some(argument_ids),
            ..
        } => arguments.extend(argument_ids.iter().cloned()),
        _ => {}
    }
    Ok(arguments)
}

fn graph_cost_record_is_malformed(node: &GraphNodeV1, cost: &GraphNodeCostV1) -> bool {
    if !require_positive(Some(cost.max_examined_entries_per_execution))
        || cost
            .max_argument_expansion
            .is_some_and(|value| !(1..=GRAPH_MAX_SAFE_INTEGER).contains(&value))
    {
        return true;
    }

    let window = graph_window_fields(cost);
    let has_all_windows = window.iter().all(Option::is_some);
    let has_no_windows = window.iter().all(Option::is_none);
    let valid_windows = !has_all_windows
        || (require_positive(cost.max_window_pages)
            && cost
                .max_window_root_rows
                .is_some_and(|value| value <= GRAPH_MAX_SAFE_INTEGER)
            && require_positive(cost.max_window_scanned_rows)
            && cost
                .max_window_result_rows
                .is_some_and(|value| value <= GRAPH_MAX_SAFE_INTEGER)
            && cost
                .max_window_result_bytes
                .is_some_and(|value| value <= GRAPH_MAX_SAFE_INTEGER)
            && require_positive(cost.max_window_index_ranges));
    if !valid_windows {
        return true;
    }

    match node {
        GraphNodeV1::RootWindow { .. } => {
            !require_positive(cost.max_root_rows_per_page)
                || cost.max_relationship_lookups_per_execution.is_some()
                || cost.max_children_per_parent.is_some()
                || !has_all_windows
                || !require_positive(cost.max_window_root_rows)
        }
        GraphNodeV1::EqualityToOne { .. } | GraphNodeV1::PrincipalBound { .. } => {
            cost.max_root_rows_per_page.is_some()
                || !require_positive(cost.max_relationship_lookups_per_execution)
                || cost.max_children_per_parent.is_some()
                || !has_no_windows
        }
        GraphNodeV1::BoundedToMany { page, .. } => {
            cost.max_root_rows_per_page.is_some()
                || !require_positive(cost.max_relationship_lookups_per_execution)
                || !require_positive(cost.max_children_per_parent)
                || if matches!(page, GraphChildPageV1::Demand(_)) {
                    !has_all_windows || cost.max_window_root_rows != Some(0)
                } else {
                    !has_no_windows
                        || !matches!(page, GraphChildPageV1::Literal(page)
                            if (1..=GRAPH_MAX_SAFE_INTEGER).contains(&page.take)
                                && cost.max_children_per_parent == Some(page.take))
                }
        }
        GraphNodeV1::ExistsSemiJoin { mode, .. } => {
            cost.max_root_rows_per_page.is_some()
                || !require_positive(cost.max_relationship_lookups_per_execution)
                || !require_positive(cost.max_children_per_parent)
                || !has_no_windows
                || (matches!(mode, GraphExistsModeV1::All)
                    && !require_positive(cost.max_argument_expansion))
        }
        GraphNodeV1::SearchMembership { argument_ids, .. } => {
            cost.max_root_rows_per_page.is_some()
                || !require_positive(cost.max_relationship_lookups_per_execution)
                || cost.max_children_per_parent.is_some()
                || !has_no_windows
                || (argument_ids.is_some() && !require_positive(cost.max_argument_expansion))
        }
        GraphNodeV1::ClosedProjection { .. } => true,
    }
}

fn graph_cost_faults(plan: &GraphQueryPlanV1) -> BTreeSet<GraphAdmissionRefusalReasonV1> {
    let data_node_ids = plan
        .nodes
        .iter()
        .filter(|node| !matches!(node, GraphNodeV1::ClosedProjection { .. }))
        .map(GraphNodeV1::node_id)
        .collect::<BTreeSet<_>>();
    let mut cost_counts = BTreeMap::<&str, usize>::new();
    for cost in &plan.query_cost.graph.nodes {
        *cost_counts.entry(&cost.node_id).or_default() += 1;
    }

    let mut faults = BTreeSet::new();
    if data_node_ids
        .iter()
        .any(|node_id| !cost_counts.contains_key(node_id))
    {
        faults.insert(GraphAdmissionRefusalReasonV1::UnboundedExpansion);
    }
    if cost_counts
        .iter()
        .any(|(node_id, count)| *count != 1 || !data_node_ids.contains(node_id))
    {
        faults.insert(GraphAdmissionRefusalReasonV1::BoundInvalid);
    }
    if plan.query_cost.graph.nodes.iter().any(|cost| {
        plan.nodes
            .iter()
            .find(|node| node.node_id() == cost.node_id)
            .is_some_and(|node| graph_cost_record_is_malformed(node, cost))
    }) {
        faults.insert(GraphAdmissionRefusalReasonV1::BoundInvalid);
    }
    if let Err(reason) = validate_graph_costs(plan) {
        faults.insert(reason);
    }
    faults
}

fn validate_graph_costs(plan: &GraphQueryPlanV1) -> Result<(), GraphAdmissionRefusalReasonV1> {
    let whole_query_limits = [
        plan.query_cost.max_scanned_rows,
        plan.query_cost.max_index_ranges,
        plan.query_cost.max_result_rows,
        plan.query_cost.max_result_bytes,
        plan.query_cost.max_evaluation_turn_ms,
        plan.query_cost.max_observers,
        plan.query_cost.max_distinct_evaluation_groups,
        plan.query_cost.max_estimated_live_fanout_ms,
    ];
    if whole_query_limits
        .iter()
        .any(|value| !(1..=GRAPH_MAX_SAFE_INTEGER).contains(value))
    {
        return Err(GraphAdmissionRefusalReasonV1::BoundInvalid);
    }

    let mut collection_bounds = BTreeMap::<String, u64>::new();
    let mut expected_argument_items = 0_u64;
    let mut argument_cost_index = 0_usize;
    for argument in &plan.arguments {
        let argument_items = match &argument.contract.value {
            ResultValueContract::Array { max_items, .. } => {
                let contract_max = u64::try_from(*max_items)
                    .map_err(|_| GraphAdmissionRefusalReasonV1::BoundInvalid)?;
                let cost = plan
                    .query_cost
                    .graph
                    .arguments
                    .get(argument_cost_index)
                    .ok_or(GraphAdmissionRefusalReasonV1::BoundInvalid)?;
                if cost.argument_id != argument.argument_id
                    || !(1..=GRAPH_MAX_SAFE_INTEGER).contains(&cost.max_items)
                    || cost.max_items > contract_max
                {
                    return Err(GraphAdmissionRefusalReasonV1::BoundInvalid);
                }
                collection_bounds.insert(argument.argument_id.clone(), cost.max_items);
                argument_cost_index += 1;
                cost.max_items
            }
            _ => 1,
        };
        expected_argument_items = checked_add(expected_argument_items, argument_items)?;
    }
    if argument_cost_index != plan.query_cost.graph.arguments.len()
        || plan.query_cost.graph.max_argument_items != expected_argument_items
        || !(1..=GRAPH_MAX_SAFE_INTEGER).contains(&plan.query_cost.graph.max_page_result_bytes)
        || plan.query_cost.graph.max_page_result_bytes > plan.query_cost.max_result_bytes
        || plan.query_cost.graph.max_maintained_writes_per_mutation != 0
    {
        return Err(GraphAdmissionRefusalReasonV1::BoundInvalid);
    }

    let data_nodes = plan
        .nodes
        .iter()
        .filter(|node| !matches!(node, GraphNodeV1::ClosedProjection { .. }))
        .collect::<Vec<_>>();
    let node_by_id = data_nodes
        .iter()
        .map(|node| (node.node_id(), *node))
        .collect::<BTreeMap<_, _>>();
    let cost_by_id = plan
        .query_cost
        .graph
        .nodes
        .iter()
        .map(|cost| (cost.node_id.as_str(), cost))
        .collect::<BTreeMap<_, _>>();
    let missing_cost = data_nodes
        .iter()
        .any(|node| !cost_by_id.contains_key(node.node_id()));
    let expected_present_order = data_nodes
        .iter()
        .filter(|node| cost_by_id.contains_key(node.node_id()))
        .map(|node| node.node_id())
        .collect::<Vec<_>>();
    let actual_present_order = plan
        .query_cost
        .graph
        .nodes
        .iter()
        .filter(|cost| node_by_id.contains_key(cost.node_id.as_str()))
        .map(|cost| cost.node_id.as_str())
        .collect::<Vec<_>>();
    if cost_by_id.len() != plan.query_cost.graph.nodes.len()
        || cost_by_id
            .keys()
            .any(|node_id| !node_by_id.contains_key(node_id))
        || actual_present_order != expected_present_order
    {
        return Err(GraphAdmissionRefusalReasonV1::BoundInvalid);
    }

    let local_factors = data_nodes
        .iter()
        .map(|node| {
            let argument_ids = graph_node_multiplicative_argument_ids(node)?;
            let mut factor = 1_u64;
            for argument_id in &argument_ids {
                factor = checked_mul(
                    factor,
                    *collection_bounds
                        .get(argument_id)
                        .ok_or(GraphAdmissionRefusalReasonV1::BoundInvalid)?,
                )?;
            }
            let (_, literal_factor) =
                graph_filter_multiplicative_inputs(graph_node_filter_slice(node))?;
            Ok((node.node_id(), argument_ids, factor, literal_factor))
        })
        .collect::<Result<Vec<_>, GraphAdmissionRefusalReasonV1>>()?;
    let local_factor_by_id = local_factors
        .iter()
        .map(|(node_id, arguments, factor, literal)| (*node_id, (arguments, *factor, *literal)))
        .collect::<BTreeMap<_, _>>();

    let root = data_nodes
        .first()
        .filter(|node| matches!(node, GraphNodeV1::RootWindow { .. }))
        .ok_or(GraphAdmissionRefusalReasonV1::RootCountInvalid)?;
    let root_cost = cost_by_id
        .get(root.node_id())
        .copied()
        .ok_or(GraphAdmissionRefusalReasonV1::UnboundedExpansion)?;
    let root_rows = root_cost
        .max_root_rows_per_page
        .filter(|value| (1..=GRAPH_MAX_SAFE_INTEGER).contains(value))
        .ok_or(GraphAdmissionRefusalReasonV1::BoundInvalid)?;

    let parent_population = |node: &GraphNodeV1| {
        let mut path = Vec::new();
        let mut visited = BTreeSet::new();
        let mut cursor = Some(node);
        while let Some(current) = cursor {
            if !visited.insert(current.node_id()) {
                return Err(GraphAdmissionRefusalReasonV1::Cycle);
            }
            path.push(current);
            cursor = current
                .parent_node_id()
                .and_then(|parent_id| node_by_id.get(parent_id).copied());
        }
        path.reverse();
        if path.first().map(|entry| entry.node_id()) != Some(root.node_id()) {
            return Err(GraphAdmissionRefusalReasonV1::BoundInvalid);
        }
        let mut argument_ids = BTreeSet::new();
        let mut literal_factor = 1_u64;
        for path_node in &path {
            let (local_arguments, _, local_literal) = local_factor_by_id[path_node.node_id()];
            argument_ids.extend(local_arguments.iter().cloned());
            literal_factor = checked_mul(literal_factor, local_literal)?;
        }
        if let GraphNodeV1::ExistsSemiJoin {
            mode: GraphExistsModeV1::All,
            argument_id: Some(argument_id),
            ..
        } = node
        {
            argument_ids.remove(argument_id);
        }
        let mut population = if matches!(node, GraphNodeV1::RootWindow { .. }) {
            1
        } else {
            root_rows
        };
        for argument_id in argument_ids {
            population = checked_mul(
                population,
                *collection_bounds
                    .get(&argument_id)
                    .ok_or(GraphAdmissionRefusalReasonV1::BoundInvalid)?,
            )?;
        }
        population = checked_mul(population, literal_factor)?;
        if !matches!(node, GraphNodeV1::RootWindow { .. }) {
            for ancestor in path.iter().take(path.len().saturating_sub(1)) {
                if let GraphNodeV1::BoundedToMany { page, .. } = ancestor {
                    let children = cost_by_id
                        .get(ancestor.node_id())
                        .and_then(|cost| cost.max_children_per_parent)
                        .or_else(|| match page {
                            GraphChildPageV1::Literal(page) => Some(page.take),
                            GraphChildPageV1::Demand(_) => None,
                        })
                        .ok_or(GraphAdmissionRefusalReasonV1::UnboundedExpansion)?;
                    population = checked_mul(population, children)?;
                }
            }
        }
        Ok(population)
    };

    let mut scanned = 0_u64;
    let mut index_ranges = 0_u64;
    let mut examined_by_id = BTreeMap::<&str, u64>::new();
    let mut ranges_by_id = BTreeMap::<&str, u64>::new();
    for node in &data_nodes {
        let Some(cost) = cost_by_id.get(node.node_id()).copied() else {
            continue;
        };
        if !require_positive(Some(cost.max_examined_entries_per_execution)) {
            return Err(GraphAdmissionRefusalReasonV1::BoundInvalid);
        }
        let (local_arguments, local_factor, _) = local_factor_by_id[node.node_id()];
        let expected_argument_expansion = (!local_arguments.is_empty()).then_some(local_factor);
        if cost.max_argument_expansion != expected_argument_expansion {
            return Err(GraphAdmissionRefusalReasonV1::BoundInvalid);
        }
        let window = graph_window_fields(cost);
        let has_all_windows = window.iter().all(Option::is_some);
        let has_no_windows = window.iter().all(Option::is_none);
        let valid_presence = match node {
            GraphNodeV1::RootWindow { .. } => {
                require_positive(cost.max_root_rows_per_page)
                    && cost.max_relationship_lookups_per_execution.is_none()
                    && cost.max_children_per_parent.is_none()
                    && has_all_windows
            }
            GraphNodeV1::EqualityToOne { .. } | GraphNodeV1::PrincipalBound { .. } => {
                cost.max_root_rows_per_page.is_none()
                    && require_positive(cost.max_relationship_lookups_per_execution)
                    && cost.max_children_per_parent.is_none()
                    && has_no_windows
            }
            GraphNodeV1::BoundedToMany { page, .. } => {
                cost.max_root_rows_per_page.is_none()
                    && require_positive(cost.max_relationship_lookups_per_execution)
                    && require_positive(cost.max_children_per_parent)
                    && if matches!(page, GraphChildPageV1::Demand(_)) {
                        has_all_windows
                    } else {
                        has_no_windows
                            && matches!(page, GraphChildPageV1::Literal(page)
                                if (1..=GRAPH_MAX_SAFE_INTEGER).contains(&page.take)
                                    && cost.max_children_per_parent == Some(page.take))
                    }
            }
            GraphNodeV1::ExistsSemiJoin { mode, .. } => {
                cost.max_root_rows_per_page.is_none()
                    && require_positive(cost.max_relationship_lookups_per_execution)
                    && require_positive(cost.max_children_per_parent)
                    && has_no_windows
                    && (!matches!(mode, GraphExistsModeV1::All)
                        || require_positive(cost.max_argument_expansion))
            }
            GraphNodeV1::SearchMembership { argument_ids, .. } => {
                cost.max_root_rows_per_page.is_none()
                    && require_positive(cost.max_relationship_lookups_per_execution)
                    && cost.max_children_per_parent.is_none()
                    && has_no_windows
                    && (argument_ids.is_none() || require_positive(cost.max_argument_expansion))
            }
            GraphNodeV1::ClosedProjection { .. } => false,
        };
        if !valid_presence {
            return Err(GraphAdmissionRefusalReasonV1::BoundInvalid);
        }
        let population = parent_population(node)?;
        let (expected_examined, expected_relationships, expected_ranges) = match node {
            GraphNodeV1::RootWindow { .. } => {
                let examined = checked_mul(population, checked_add(root_rows, 1)?)?;
                (examined, None, population)
            }
            GraphNodeV1::EqualityToOne { .. } => (population, Some(population), population),
            GraphNodeV1::BoundedToMany { .. } => {
                let children = cost.max_children_per_parent.unwrap();
                (
                    checked_mul(population, checked_add(children, 1)?)?,
                    Some(population),
                    population,
                )
            }
            GraphNodeV1::ExistsSemiJoin {
                mode,
                edge,
                argument_id,
                ..
            } => {
                let probes = if matches!(mode, GraphExistsModeV1::All) {
                    *collection_bounds
                        .get(argument_id.as_deref().unwrap_or_default())
                        .ok_or(GraphAdmissionRefusalReasonV1::BoundInvalid)?
                } else {
                    1
                };
                let attempts = checked_mul(population, probes)?;
                match edge {
                    // Whether a direct edge is a unique point or a bounded
                    // range is an installed-schema fact. Rank 0 accepts only
                    // those two exact analytical spellings; the schema owner
                    // resolves which one applies before activation.
                    GraphEdgeV1::Direct(_) => {
                        let children = cost.max_children_per_parent.unwrap();
                        let bounded_range = checked_mul(attempts, checked_add(children, 1)?)?;
                        if cost.max_examined_entries_per_execution != attempts
                            && cost.max_examined_entries_per_execution != bounded_range
                        {
                            return Err(GraphAdmissionRefusalReasonV1::BoundInvalid);
                        }
                        (
                            cost.max_examined_entries_per_execution,
                            Some(attempts),
                            attempts,
                        )
                    }
                    GraphEdgeV1::Through(_) => {
                        let children = cost.max_children_per_parent.unwrap();
                        let per_probe = checked_add(checked_add(children, 1)?, children)?;
                        let examined = checked_mul(attempts, per_probe)?;
                        let ranges = checked_mul(attempts, checked_add(children, 1)?)?;
                        (examined, Some(ranges), ranges)
                    }
                }
            }
            GraphNodeV1::PrincipalBound { binding, .. } => {
                let consultations = checked_mul(population, 1 + u64::from(binding.is_some()))?;
                (consultations, Some(consultations), consultations)
            }
            GraphNodeV1::SearchMembership { .. } => (population, Some(population), population),
            GraphNodeV1::ClosedProjection { .. } => unreachable!(),
        };
        if cost.max_examined_entries_per_execution != expected_examined
            || cost.max_relationship_lookups_per_execution != expected_relationships
        {
            return Err(GraphAdmissionRefusalReasonV1::BoundInvalid);
        }
        scanned = checked_add(scanned, expected_examined)?;
        index_ranges = checked_add(index_ranges, expected_ranges)?;
        examined_by_id.insert(node.node_id(), expected_examined);
        ranges_by_id.insert(node.node_id(), expected_ranges);
    }

    for node in data_nodes
        .iter()
        .filter(|node| !cost_by_id.contains_key(node.node_id()))
    {
        let population = parent_population(node)?;
        let (expected_examined, expected_ranges) = match node {
            GraphNodeV1::EqualityToOne { .. } | GraphNodeV1::SearchMembership { .. } => {
                (population, population)
            }
            GraphNodeV1::BoundedToMany {
                page: GraphChildPageV1::Literal(page),
                ..
            } => (
                checked_mul(population, checked_add(page.take, 1)?)?,
                population,
            ),
            GraphNodeV1::PrincipalBound { binding, .. } => {
                let consultations = checked_mul(population, 1 + u64::from(binding.is_some()))?;
                (consultations, consultations)
            }
            GraphNodeV1::RootWindow { .. }
            | GraphNodeV1::BoundedToMany {
                page: GraphChildPageV1::Demand(_),
                ..
            }
            | GraphNodeV1::ExistsSemiJoin { .. }
            | GraphNodeV1::ClosedProjection { .. } => {
                return Err(GraphAdmissionRefusalReasonV1::UnboundedExpansion);
            }
        };
        scanned = checked_add(scanned, expected_examined)?;
        index_ranges = checked_add(index_ranges, expected_ranges)?;
        examined_by_id.insert(node.node_id(), expected_examined);
        ranges_by_id.insert(node.node_id(), expected_ranges);
    }

    // @ref LLP 0209#26-bounds-and-fixture-derivation — a missing record is
    // row 12, but it must not mask an analytically conflicting present record.
    let mut rollup = GraphWindowRollupV1::default();
    for node in &data_nodes {
        if !node.demand_paged() {
            continue;
        }
        let cost = cost_by_id
            .get(node.node_id())
            .copied()
            .ok_or(GraphAdmissionRefusalReasonV1::UnboundedExpansion)?;
        let pages = cost
            .max_window_pages
            .filter(|value| (1..=GRAPH_MAX_SAFE_INTEGER).contains(value))
            .ok_or(GraphAdmissionRefusalReasonV1::BoundInvalid)?;
        let is_in_subtree = |candidate: &GraphNodeV1| {
            let mut visited = BTreeSet::new();
            let mut cursor = Some(candidate);
            while let Some(current) = cursor {
                if current.node_id() == node.node_id() {
                    return Ok(true);
                }
                if !visited.insert(current.node_id()) {
                    return Err(GraphAdmissionRefusalReasonV1::Cycle);
                }
                cursor = current
                    .parent_node_id()
                    .and_then(|parent_id| node_by_id.get(parent_id).copied());
            }
            Ok(false)
        };
        let mut subtree_scanned = 0_u64;
        let mut subtree_ranges = 0_u64;
        for candidate in &data_nodes {
            if is_in_subtree(candidate)? {
                subtree_scanned =
                    checked_add(subtree_scanned, examined_by_id[candidate.node_id()])?;
                subtree_ranges = checked_add(subtree_ranges, ranges_by_id[candidate.node_id()])?;
            }
        }
        let expected_root_rows = if matches!(node, GraphNodeV1::RootWindow { .. }) {
            checked_mul(pages, root_rows)?
        } else {
            0
        };
        let expected_window_scanned = checked_mul(pages, subtree_scanned)?;
        let expected_window_ranges = checked_mul(pages, subtree_ranges)?;
        let result_rows = cost
            .max_window_result_rows
            .filter(|value| *value <= GRAPH_MAX_SAFE_INTEGER)
            .ok_or(GraphAdmissionRefusalReasonV1::BoundInvalid)?;
        let result_bytes = cost
            .max_window_result_bytes
            .filter(|value| *value <= GRAPH_MAX_SAFE_INTEGER)
            .ok_or(GraphAdmissionRefusalReasonV1::BoundInvalid)?;
        if cost.max_window_root_rows != Some(expected_root_rows)
            || cost.max_window_scanned_rows != Some(expected_window_scanned)
            || cost.max_window_index_ranges != Some(expected_window_ranges)
            || result_rows > checked_mul(pages, plan.query_cost.max_result_rows)?
            || result_bytes > checked_mul(pages, plan.query_cost.graph.max_page_result_bytes)?
        {
            return Err(GraphAdmissionRefusalReasonV1::BoundInvalid);
        }
        rollup.max_window_pages = checked_add(rollup.max_window_pages, pages)?;
        rollup.max_window_root_rows = checked_add(rollup.max_window_root_rows, expected_root_rows)?;
        rollup.max_window_scanned_rows =
            checked_add(rollup.max_window_scanned_rows, expected_window_scanned)?;
        rollup.max_window_result_rows = checked_add(rollup.max_window_result_rows, result_rows)?;
        rollup.max_window_result_bytes = checked_add(rollup.max_window_result_bytes, result_bytes)?;
        rollup.max_window_index_ranges =
            checked_add(rollup.max_window_index_ranges, expected_window_ranges)?;
    }
    if plan.query_cost.graph.window_rollup != rollup
        || plan.query_cost.max_scanned_rows != scanned
        || plan.query_cost.max_index_ranges != index_ranges
    {
        return Err(GraphAdmissionRefusalReasonV1::BoundInvalid);
    }
    if missing_cost {
        return Err(GraphAdmissionRefusalReasonV1::UnboundedExpansion);
    }
    Ok(())
}

/// Validate the closed, normalized graph record using only plan-decidable
/// facts. Installed schema/policy owner checks are performed by the manifest
/// admission wrapper before this function is called.
///
/// @ref LLP 0209#23-closure-admission-demand-time-evaluation-time-and-qualification-registers —
/// the ordered admission register is stable public behavior.
fn validate_graph_query_plan_v1_first_fault(
    plan: &GraphQueryPlanV1,
) -> Result<(), GraphAdmissionRefusalReasonV1> {
    if plan.format != "snapback.graph-query-plan.v1"
        || plan.capability_id != GRAPH_QUERY_CAPABILITY_ID
        || plan.root_node_id != "n0"
    {
        return Err(GraphAdmissionRefusalReasonV1::UnknownField);
    }
    if !matches!(
        plan.nodes.last(),
        Some(GraphNodeV1::ClosedProjection { .. })
    ) {
        return Err(GraphAdmissionRefusalReasonV1::ProjectionCountInvalid);
    }
    let normalized = normalized_graph_plan(plan)?;
    if normalized != *plan {
        return Err(GraphAdmissionRefusalReasonV1::PlanIdentityMismatch);
    }
    let nodes = plan
        .nodes
        .iter()
        .map(|node| (node.node_id().to_owned(), node))
        .collect::<BTreeMap<_, _>>();
    let projection = plan
        .nodes
        .last()
        .and_then(|node| match node {
            GraphNodeV1::ClosedProjection { object, .. } => Some(object),
            _ => None,
        })
        .ok_or(GraphAdmissionRefusalReasonV1::ProjectionCountInvalid)?;
    let mut projection_sources = BTreeSet::new();
    projection_source_node_ids(projection, &mut projection_sources);
    if plan.nodes.iter().any(|node| {
        matches!(
            node,
            GraphNodeV1::EqualityToOne { .. }
                | GraphNodeV1::BoundedToMany { .. }
                | GraphNodeV1::PrincipalBound { .. }
        ) && !projection_sources.contains(node.node_id())
    }) {
        return Err(GraphAdmissionRefusalReasonV1::NodeInert);
    }
    for (index, node) in plan.nodes.iter().enumerate() {
        if node.node_id() != format!("n{index}")
            || node.edge_name().is_empty()
            || node.edge_name().chars().any(char::is_control)
        {
            return Err(GraphAdmissionRefusalReasonV1::UnknownField);
        }
        validate_authority(node, &nodes)?;
        if let Some(order) = node.order() {
            validate_order(order)?;
        }
        if let GraphNodeV1::BoundedToMany {
            order,
            page: GraphChildPageV1::Literal(page),
            ..
        } = node
            && (validate_interval_end(&page.lower, order).is_err()
                || validate_interval_end(&page.upper, order).is_err())
        {
            return Err(GraphAdmissionRefusalReasonV1::BoundInvalid);
        }
        match node {
            GraphNodeV1::RootWindow {
                edge_name,
                table,
                access_index,
                ..
            } if edge_name != "$root" || table.is_empty() || access_index.is_empty() => {
                return Err(GraphAdmissionRefusalReasonV1::UnknownField);
            }
            GraphNodeV1::EqualityToOne {
                parent_node_id,
                table,
                join_on,
                access_index,
                ..
            }
            | GraphNodeV1::BoundedToMany {
                parent_node_id,
                table,
                join_on,
                access_index,
                ..
            } => {
                if !matches!(
                    nodes.get(parent_node_id),
                    Some(
                        GraphNodeV1::RootWindow { .. }
                            | GraphNodeV1::EqualityToOne { .. }
                            | GraphNodeV1::BoundedToMany { .. }
                            | GraphNodeV1::PrincipalBound { .. }
                    )
                ) {
                    return Err(GraphAdmissionRefusalReasonV1::ParentInvalid);
                }
                if table.is_empty() || join_on.is_empty() || access_index.is_empty() {
                    return Err(GraphAdmissionRefusalReasonV1::SchemaReferenceInvalid);
                }
            }
            GraphNodeV1::ExistsSemiJoin {
                parent_node_id,
                edge,
                mode,
                filters,
                argument_id,
                ..
            } => {
                if !matches!(
                    nodes.get(parent_node_id),
                    Some(
                        GraphNodeV1::RootWindow { .. }
                            | GraphNodeV1::EqualityToOne { .. }
                            | GraphNodeV1::BoundedToMany { .. }
                            | GraphNodeV1::PrincipalBound { .. }
                    )
                ) {
                    return Err(GraphAdmissionRefusalReasonV1::ParentInvalid);
                }
                let declared = match edge {
                    GraphEdgeV1::Direct(edge) => {
                        !edge.table.is_empty()
                            && !edge.join_on.is_empty()
                            && !edge.access_index.is_empty()
                    }
                    GraphEdgeV1::Through(edge) => {
                        !edge.table.is_empty()
                            && !edge.target_table.is_empty()
                            && !edge.parent_join.is_empty()
                            && !edge.target_join.is_empty()
                            && !edge.parent_index.is_empty()
                            && !edge.target_index.is_empty()
                    }
                };
                if !declared {
                    return Err(GraphAdmissionRefusalReasonV1::ThroughTableUndeclared);
                }
                if matches!(mode, GraphExistsModeV1::Exists) != argument_id.is_none() {
                    return Err(GraphAdmissionRefusalReasonV1::ArgumentUnbound);
                }
                if matches!(mode, GraphExistsModeV1::All)
                    && !argument_id.as_ref().is_some_and(|argument_id| {
                        all_semijoin_argument_is_bound(
                            plan,
                            filters.as_deref().unwrap_or_default(),
                            argument_id,
                        )
                    })
                {
                    return Err(GraphAdmissionRefusalReasonV1::ArgumentUnbound);
                }
            }
            GraphNodeV1::PrincipalBound {
                parent_node_id,
                table,
                parent_join,
                principal_field,
                access_index,
                binding,
                principal_source,
                ..
            } => {
                if !matches!(
                    nodes.get(parent_node_id),
                    Some(
                        GraphNodeV1::RootWindow { .. }
                            | GraphNodeV1::EqualityToOne { .. }
                            | GraphNodeV1::BoundedToMany { .. }
                    )
                ) {
                    return Err(GraphAdmissionRefusalReasonV1::ParentInvalid);
                }
                if table.is_empty()
                    || parent_join.is_empty()
                    || principal_field.is_empty()
                    || access_index.is_empty()
                    || binding.as_ref().is_some_and(|binding| {
                        binding.table.is_empty()
                            || binding.principal_field.is_empty()
                            || binding.value_field.is_empty()
                            || binding.unique_index.is_empty()
                    })
                {
                    return Err(GraphAdmissionRefusalReasonV1::SchemaReferenceInvalid);
                }
                if principal_source != "auth.userId" {
                    return Err(GraphAdmissionRefusalReasonV1::PrincipalBindingUnprovable);
                }
            }
            GraphNodeV1::ClosedProjection {
                edge_name, object, ..
            } => {
                if edge_name != "$result" || object.scope_node_id != plan.root_node_id {
                    return Err(GraphAdmissionRefusalReasonV1::ProjectionScopeInvalid);
                }
                validate_projection_scope(object, &nodes)?;
            }
            GraphNodeV1::SearchMembership {
                parent_node_id,
                authority,
                membership_identity,
                provider_completeness_class,
                scope_bindings,
                invalidation_tables,
                argument_ids,
                provider_capability_id,
                member_field,
                ..
            } => {
                if !matches!(
                    nodes.get(parent_node_id),
                    Some(GraphNodeV1::RootWindow { .. })
                ) {
                    return Err(GraphAdmissionRefusalReasonV1::ParentInvalid);
                }
                let _format_only_preimage = (
                    provider_capability_id,
                    member_field,
                    membership_identity,
                    authority,
                    provider_completeness_class,
                    scope_bindings,
                    invalidation_tables,
                    argument_ids,
                );
                // Provider-owned preimages do not exist until D6. The wire
                // shape is retained, but no authored search node is admitted
                // during G0 Stage B1.
                return Err(GraphAdmissionRefusalReasonV1::SearchUnadmitted);
            }
            _ => {}
        }
    }
    for argument in &plan.arguments {
        if argument.contract.format != "snapback.argument-binding-contract.v1" {
            return Err(GraphAdmissionRefusalReasonV1::SchemaReferenceInvalid);
        }
    }
    if plan.authority_partition_rule.format != "snapback.graph-authority-partition-rule.v1" {
        return Err(GraphAdmissionRefusalReasonV1::AuthorityUnprovable);
    }
    let has_class3 = plan
        .nodes
        .iter()
        .any(|node| node.authority().declared_class == GraphAuthorityClassV1::PRINCIPAL_SCOPED);
    if has_class3
        != matches!(
            plan.authority_partition_rule.class3,
            GraphClass3PartitionV1::PartitionOfOne
        )
    {
        return Err(GraphAdmissionRefusalReasonV1::AuthorityUnprovable);
    }
    let expected_class2 = plan
        .nodes
        .iter()
        .filter(|node| node.authority().declared_class == GraphAuthorityClassV1::PARTITION_SCOPED)
        .flat_map(|node| {
            node.authority().proof.iter().flat_map(move |proof| {
                proof.policy_inputs.iter().map(move |input| {
                    (
                        node.node_id(),
                        input.declaration_id.as_str(),
                        input.identity.as_str(),
                    )
                })
            })
        })
        .collect::<Vec<_>>();
    let actual_class2 = plan
        .authority_partition_rule
        .class2_inputs
        .iter()
        .map(|input| {
            (
                input.node_id.as_str(),
                input.declaration_id.as_str(),
                input.policy_identity.as_str(),
            )
        })
        .collect::<Vec<_>>();
    if actual_class2 != expected_class2 {
        return Err(GraphAdmissionRefusalReasonV1::AuthorityUnprovable);
    }
    let expected_base = plan
        .nodes
        .iter()
        .filter(|node| !matches!(node, GraphNodeV1::ClosedProjection { .. }))
        .map(|node| node.node_id().to_owned())
        .collect::<Vec<_>>();
    let expected_projection_class = plan
        .nodes
        .iter()
        .filter(|node| !matches!(node, GraphNodeV1::ClosedProjection { .. }))
        .map(|node| node.authority().declared_class)
        .max()
        .unwrap_or(GraphAuthorityClassV1::INDEPENDENT);
    if plan
        .nodes
        .last()
        .is_some_and(|node| node.authority().declared_class != expected_projection_class)
    {
        return Err(GraphAdmissionRefusalReasonV1::AuthorityUnprovable);
    }
    match &plan.broadcast {
        GraphBroadcastAdmissionV1::QueryShaped { format, .. } => {
            if format != "snapback.graph-broadcast-admission.v1" {
                return Err(GraphAdmissionRefusalReasonV1::UnknownField);
            }
        }
        GraphBroadcastAdmissionV1::Broadcast {
            format,
            base_node_ids,
            establishment,
        } => {
            if format != "snapback.graph-broadcast-admission.v1" {
                return Err(GraphAdmissionRefusalReasonV1::UnknownField);
            }
            if base_node_ids != &expected_base {
                return Err(GraphAdmissionRefusalReasonV1::PlanIdentityMismatch);
            }
            if expected_base.iter().any(|node_id| {
                nodes[node_id].authority().declared_class != GraphAuthorityClassV1::INDEPENDENT
            }) {
                return Err(GraphAdmissionRefusalReasonV1::BroadcastBaseClassInvalid);
            }
            let _b2_proof_carrier = establishment;
            return Err(GraphAdmissionRefusalReasonV1::BroadcastSeparationUnprovable);
        }
    }
    validate_graph_costs(plan)
}

fn graph_filter_faults(
    filters: &[FilterExpr],
    argument_names: &BTreeSet<&str>,
    argument_ids: &BTreeSet<&str>,
    faults: &mut BTreeSet<GraphAdmissionRefusalReasonV1>,
) {
    for filter in filters {
        match &filter.value {
            ValueExpr::Arg(argument)
                if argument_names.contains(argument.as_str())
                    || argument_ids.contains(argument.as_str()) => {}
            ValueExpr::Arg(_) => {
                faults.insert(GraphAdmissionRefusalReasonV1::ArgumentUnbound);
            }
            ValueExpr::Literal(value) if canonical_client_value_is_valid(value) => {}
            ValueExpr::Literal(_) => {
                faults.insert(GraphAdmissionRefusalReasonV1::ArgumentUnbound);
            }
            _ => {
                faults.insert(GraphAdmissionRefusalReasonV1::CodeForbidden);
            }
        }
    }
}

fn all_semijoin_argument_is_bound(
    plan: &GraphQueryPlanV1,
    filters: &[FilterExpr],
    argument_id: &str,
) -> bool {
    let collection_typed = plan.arguments.iter().any(|argument| {
        argument.argument_id == argument_id
            && matches!(argument.contract.value, ResultValueContract::Array { .. })
    });
    let matching_filters = filters
        .iter()
        .filter(|filter| {
            filter.op == FilterOp::In
                && matches!(&filter.value, ValueExpr::Arg(bound) if bound == argument_id)
        })
        .count();
    collection_typed && matching_filters == 1
}

/// Return every plan-local and normalization fault, ordered by the normative
/// admission row. Callers must report only the first row, but later phases use
/// this complete set when unioning installed-owner faults.
///
/// @ref LLP 0209#23-closure-admission-demand-time-evaluation-time-and-qualification-registers —
/// first-miss precedence is global across admission phases, not call order.
pub fn graph_query_plan_faults_v1(plan: &GraphQueryPlanV1) -> Vec<GraphAdmissionFaultV1> {
    let mut faults = BTreeSet::new();
    if plan.format != "snapback.graph-query-plan.v1"
        || plan.capability_id != GRAPH_QUERY_CAPABILITY_ID
        || plan.root_node_id != "n0"
    {
        faults.insert(GraphAdmissionRefusalReasonV1::UnknownField);
    }

    let roots = plan
        .nodes
        .iter()
        .filter(|node| matches!(node, GraphNodeV1::RootWindow { .. }))
        .count();
    let projections = plan
        .nodes
        .iter()
        .filter(|node| matches!(node, GraphNodeV1::ClosedProjection { .. }))
        .count();
    if roots != 1 {
        faults.insert(GraphAdmissionRefusalReasonV1::RootCountInvalid);
    }
    if projections != 1
        || !matches!(
            plan.nodes.last(),
            Some(GraphNodeV1::ClosedProjection { .. })
        )
    {
        faults.insert(GraphAdmissionRefusalReasonV1::ProjectionCountInvalid);
    }

    let mut node_ids = BTreeSet::new();
    let mut data_nodes = BTreeMap::new();
    let mut sibling_names = BTreeSet::new();
    for node in &plan.nodes {
        if node.node_id().is_empty() || !node_ids.insert(node.node_id()) {
            faults.insert(GraphAdmissionRefusalReasonV1::UnknownField);
        }
        if !matches!(node, GraphNodeV1::ClosedProjection { .. }) {
            data_nodes.insert(node.node_id().to_owned(), node.clone());
        }
    }
    for node in data_nodes.values() {
        if let Some(parent) = node.parent_node_id() {
            if !data_nodes.contains_key(parent) {
                faults.insert(GraphAdmissionRefusalReasonV1::ParentInvalid);
            }
            if !sibling_names.insert((parent.to_owned(), node.edge_name().to_owned())) {
                faults.insert(GraphAdmissionRefusalReasonV1::UnknownField);
            }
        }
    }
    if graph_has_parent_cycle(&data_nodes) {
        faults.insert(GraphAdmissionRefusalReasonV1::Cycle);
    }

    let mut argument_names = BTreeSet::new();
    let mut argument_ids = BTreeSet::new();
    let generated_ids = (0..plan.arguments.len())
        .map(|index| format!("a{index}"))
        .collect::<BTreeSet<_>>();
    for argument in &plan.arguments {
        if argument.name.is_empty()
            || generated_ids.contains(&argument.name)
            || !argument_names.insert(argument.name.as_str())
            || argument.argument_id.is_empty()
            || !argument_ids.insert(argument.argument_id.as_str())
        {
            faults.insert(GraphAdmissionRefusalReasonV1::ArgumentUnbound);
        }
        if argument.contract.format != "snapback.argument-binding-contract.v1" {
            faults.insert(GraphAdmissionRefusalReasonV1::SchemaReferenceInvalid);
        }
    }

    let nodes = plan
        .nodes
        .iter()
        .map(|node| (node.node_id().to_owned(), node))
        .collect::<BTreeMap<_, _>>();
    let mut projection_sources = BTreeSet::new();
    if let Some(object) = plan.nodes.iter().find_map(|node| match node {
        GraphNodeV1::ClosedProjection { object, .. } => Some(object),
        _ => None,
    }) {
        projection_source_node_ids(object, &mut projection_sources);
    }
    for (index, node) in plan.nodes.iter().enumerate() {
        if node.node_id() != format!("n{index}")
            || node.edge_name().is_empty()
            || node.edge_name().chars().any(char::is_control)
        {
            faults.insert(GraphAdmissionRefusalReasonV1::UnknownField);
        }
        if let Err(reason) = validate_authority(node, &nodes) {
            faults.insert(reason);
        }
        if let Some(order) = node.order()
            && let Err(reason) = validate_order(order)
        {
            faults.insert(reason);
        }
        match node {
            GraphNodeV1::RootWindow {
                edge_name,
                table,
                access_index,
                filters,
                ..
            } => {
                if edge_name != "$root" || table.is_empty() || access_index.is_empty() {
                    faults.insert(GraphAdmissionRefusalReasonV1::UnknownField);
                }
                graph_filter_faults(filters, &argument_names, &argument_ids, &mut faults);
            }
            GraphNodeV1::EqualityToOne {
                parent_node_id,
                table,
                join_on,
                access_index,
                filters,
                ..
            }
            | GraphNodeV1::BoundedToMany {
                parent_node_id,
                table,
                join_on,
                access_index,
                filters,
                ..
            } => {
                if !matches!(
                    nodes.get(parent_node_id),
                    Some(
                        GraphNodeV1::RootWindow { .. }
                            | GraphNodeV1::EqualityToOne { .. }
                            | GraphNodeV1::BoundedToMany { .. }
                            | GraphNodeV1::PrincipalBound { .. }
                    )
                ) {
                    faults.insert(GraphAdmissionRefusalReasonV1::ParentInvalid);
                }
                if table.is_empty() || join_on.is_empty() || access_index.is_empty() {
                    faults.insert(GraphAdmissionRefusalReasonV1::SchemaReferenceInvalid);
                }
                graph_filter_faults(
                    filters.as_deref().unwrap_or_default(),
                    &argument_names,
                    &argument_ids,
                    &mut faults,
                );
                if let GraphNodeV1::BoundedToMany {
                    order,
                    page: GraphChildPageV1::Literal(page),
                    ..
                } = node
                    && (validate_interval_end(&page.lower, order).is_err()
                        || validate_interval_end(&page.upper, order).is_err())
                {
                    faults.insert(GraphAdmissionRefusalReasonV1::BoundInvalid);
                }
            }
            GraphNodeV1::ExistsSemiJoin {
                parent_node_id,
                edge,
                mode,
                filters,
                argument_id,
                ..
            } => {
                if !matches!(
                    nodes.get(parent_node_id),
                    Some(
                        GraphNodeV1::RootWindow { .. }
                            | GraphNodeV1::EqualityToOne { .. }
                            | GraphNodeV1::BoundedToMany { .. }
                            | GraphNodeV1::PrincipalBound { .. }
                    )
                ) {
                    faults.insert(GraphAdmissionRefusalReasonV1::ParentInvalid);
                }
                let declared = match edge {
                    GraphEdgeV1::Direct(edge) => {
                        !edge.table.is_empty()
                            && !edge.join_on.is_empty()
                            && !edge.access_index.is_empty()
                    }
                    GraphEdgeV1::Through(edge) => {
                        !edge.table.is_empty()
                            && !edge.target_table.is_empty()
                            && !edge.parent_join.is_empty()
                            && !edge.target_join.is_empty()
                            && !edge.parent_index.is_empty()
                            && !edge.target_index.is_empty()
                    }
                };
                if !declared {
                    faults.insert(GraphAdmissionRefusalReasonV1::ThroughTableUndeclared);
                }
                if matches!(mode, GraphExistsModeV1::Exists) != argument_id.is_none() {
                    faults.insert(GraphAdmissionRefusalReasonV1::ArgumentUnbound);
                }
                if matches!(mode, GraphExistsModeV1::All)
                    && !argument_id.as_ref().is_some_and(|argument_id| {
                        all_semijoin_argument_is_bound(
                            plan,
                            filters.as_deref().unwrap_or_default(),
                            argument_id,
                        )
                    })
                {
                    faults.insert(GraphAdmissionRefusalReasonV1::ArgumentUnbound);
                }
                graph_filter_faults(
                    filters.as_deref().unwrap_or_default(),
                    &argument_names,
                    &argument_ids,
                    &mut faults,
                );
            }
            GraphNodeV1::PrincipalBound {
                parent_node_id,
                table,
                parent_join,
                principal_field,
                access_index,
                principal_source,
                binding,
                filters,
                ..
            } => {
                if !matches!(
                    nodes.get(parent_node_id),
                    Some(
                        GraphNodeV1::RootWindow { .. }
                            | GraphNodeV1::EqualityToOne { .. }
                            | GraphNodeV1::BoundedToMany { .. }
                    )
                ) {
                    faults.insert(GraphAdmissionRefusalReasonV1::ParentInvalid);
                }
                if table.is_empty()
                    || parent_join.is_empty()
                    || principal_field.is_empty()
                    || access_index.is_empty()
                    || binding.as_ref().is_some_and(|binding| {
                        binding.table.is_empty()
                            || binding.principal_field.is_empty()
                            || binding.value_field.is_empty()
                            || binding.unique_index.is_empty()
                    })
                {
                    faults.insert(GraphAdmissionRefusalReasonV1::SchemaReferenceInvalid);
                }
                if principal_source != "auth.userId" {
                    faults.insert(GraphAdmissionRefusalReasonV1::PrincipalBindingUnprovable);
                }
                graph_filter_faults(
                    filters.as_deref().unwrap_or_default(),
                    &argument_names,
                    &argument_ids,
                    &mut faults,
                );
            }
            GraphNodeV1::SearchMembership { parent_node_id, .. } => {
                if !matches!(
                    nodes.get(parent_node_id),
                    Some(GraphNodeV1::RootWindow { .. })
                ) {
                    faults.insert(GraphAdmissionRefusalReasonV1::ParentInvalid);
                }
                faults.insert(GraphAdmissionRefusalReasonV1::SearchUnadmitted);
            }
            GraphNodeV1::ClosedProjection {
                edge_name, object, ..
            } => {
                if edge_name != "$result" || object.scope_node_id != plan.root_node_id {
                    faults.insert(GraphAdmissionRefusalReasonV1::ProjectionScopeInvalid);
                }
                if let Err(reason) = validate_projection_scope(object, &nodes) {
                    faults.insert(reason);
                }
            }
        }
    }
    if plan.nodes.iter().any(|node| {
        matches!(
            node,
            GraphNodeV1::EqualityToOne { .. }
                | GraphNodeV1::BoundedToMany { .. }
                | GraphNodeV1::PrincipalBound { .. }
        ) && !projection_sources.contains(node.node_id())
    }) {
        faults.insert(GraphAdmissionRefusalReasonV1::NodeInert);
    }

    if plan.authority_partition_rule.format != "snapback.graph-authority-partition-rule.v1" {
        faults.insert(GraphAdmissionRefusalReasonV1::AuthorityUnprovable);
    }
    let has_class3 = plan
        .nodes
        .iter()
        .any(|node| node.authority().declared_class == GraphAuthorityClassV1::PRINCIPAL_SCOPED);
    if has_class3
        != matches!(
            plan.authority_partition_rule.class3,
            GraphClass3PartitionV1::PartitionOfOne
        )
    {
        faults.insert(GraphAdmissionRefusalReasonV1::AuthorityUnprovable);
    }
    let expected_class2 = plan
        .nodes
        .iter()
        .filter(|node| node.authority().declared_class == GraphAuthorityClassV1::PARTITION_SCOPED)
        .flat_map(|node| {
            node.authority().proof.iter().flat_map(move |proof| {
                proof.policy_inputs.iter().map(move |input| {
                    (
                        node.node_id(),
                        input.declaration_id.as_str(),
                        input.identity.as_str(),
                    )
                })
            })
        })
        .collect::<Vec<_>>();
    let actual_class2 = plan
        .authority_partition_rule
        .class2_inputs
        .iter()
        .map(|input| {
            (
                input.node_id.as_str(),
                input.declaration_id.as_str(),
                input.policy_identity.as_str(),
            )
        })
        .collect::<Vec<_>>();
    if actual_class2 != expected_class2 {
        faults.insert(GraphAdmissionRefusalReasonV1::AuthorityUnprovable);
    }
    let expected_projection_class = plan
        .nodes
        .iter()
        .filter(|node| !matches!(node, GraphNodeV1::ClosedProjection { .. }))
        .map(|node| node.authority().declared_class)
        .max()
        .unwrap_or(GraphAuthorityClassV1::INDEPENDENT);
    if plan
        .nodes
        .iter()
        .find(|node| matches!(node, GraphNodeV1::ClosedProjection { .. }))
        .is_some_and(|node| node.authority().declared_class != expected_projection_class)
    {
        faults.insert(GraphAdmissionRefusalReasonV1::AuthorityUnprovable);
    }

    let expected_base = plan
        .nodes
        .iter()
        .filter(|node| !matches!(node, GraphNodeV1::ClosedProjection { .. }))
        .map(|node| node.node_id().to_owned())
        .collect::<Vec<_>>();
    match &plan.broadcast {
        GraphBroadcastAdmissionV1::QueryShaped { format, .. } => {
            if format != "snapback.graph-broadcast-admission.v1" {
                faults.insert(GraphAdmissionRefusalReasonV1::UnknownField);
            }
        }
        GraphBroadcastAdmissionV1::Broadcast {
            format,
            base_node_ids,
            ..
        } => {
            if format != "snapback.graph-broadcast-admission.v1" {
                faults.insert(GraphAdmissionRefusalReasonV1::UnknownField);
            }
            if base_node_ids != &expected_base {
                faults.insert(GraphAdmissionRefusalReasonV1::PlanIdentityMismatch);
            }
            if expected_base.iter().any(|node_id| {
                nodes.get(node_id).is_some_and(|node| {
                    node.authority().declared_class != GraphAuthorityClassV1::INDEPENDENT
                })
            }) {
                faults.insert(GraphAdmissionRefusalReasonV1::BroadcastBaseClassInvalid);
            }
            faults.insert(GraphAdmissionRefusalReasonV1::BroadcastSeparationUnprovable);
        }
    }
    faults.extend(graph_cost_faults(plan));
    match normalized_graph_plan(plan) {
        Ok(normalized) if normalized != *plan => {
            faults.insert(GraphAdmissionRefusalReasonV1::PlanIdentityMismatch);
        }
        Err(reason) => {
            faults.insert(reason);
        }
        Ok(_) => {}
    }
    if let Err(reason) = validate_graph_query_plan_v1_first_fault(plan) {
        faults.insert(reason);
    }

    faults
        .into_iter()
        .map(GraphAdmissionFaultV1::from)
        .collect()
}

pub fn validate_graph_query_plan_v1(
    plan: &GraphQueryPlanV1,
) -> Result<(), GraphAdmissionRefusalReasonV1> {
    graph_query_plan_faults_v1(plan)
        .first()
        .map_or(Ok(()), |fault| Err(fault.reason))
}

/// Recompute and exact-match both graph carrier facts before admission.
///
/// @ref LLP 0209#24-plan-instance-and-contextual-materialization-identity —
/// normalized plan bytes and their domain hash are both host-owned.
pub fn graph_plan_identity_v1(
    candidate: &GraphQueryPlanV1,
) -> Result<GraphPlanIdentityV1, GraphAdmissionRefusalReasonV1> {
    let normalized_plan = normalized_graph_plan(candidate)?;
    validate_graph_query_plan_v1(&normalized_plan)?;
    let plan_hash = graph_domain_hash(b"snapback:graph-plan:v1:", &normalized_plan)
        .map_err(|_| GraphAdmissionRefusalReasonV1::PlanIdentityMismatch)?;
    Ok(GraphPlanIdentityV1 {
        normalized_plan,
        plan_hash,
    })
}

pub fn validate_graph_query_carrier_v1(
    carrier: &GraphQueryCarrierV1,
    expected_result_contract_hash: Option<&str>,
) -> Result<(), GraphAdmissionRefusalReasonV1> {
    if expected_result_contract_hash
        .is_some_and(|expected| carrier.normalized_plan.result_contract_hash.as_str() != expected)
    {
        return Err(GraphAdmissionRefusalReasonV1::ResultContractMismatch);
    }
    let rebuilt = graph_plan_identity_v1(&carrier.normalized_plan)?;
    if rebuilt != *carrier {
        return Err(GraphAdmissionRefusalReasonV1::PlanIdentityMismatch);
    }
    Ok(())
}

pub fn graph_args_digest_v1(
    args: &CanonicalClientValueV1,
) -> Result<Sha256V1, GraphDemandTimeRefusalReasonV1> {
    if !canonical_client_value_is_valid(args) {
        return Err(GraphDemandTimeRefusalReasonV1::ArgumentInvalid);
    }
    graph_domain_hash(b"snapback:materialization-args:v1:", args)
        .map_err(|_| GraphDemandTimeRefusalReasonV1::ArgumentInvalid)
}

/// Validate one request's exact graph arguments before minting demand
/// identity. Window/cursor values are intentionally absent from this object.
///
/// @ref LLP 0209#23-closure-admission-demand-time-evaluation-time-and-qualification-registers —
/// request values use the separate ordered demand-time refusal register.
pub fn validate_graph_arguments_v1(
    plan: &GraphQueryPlanV1,
    args: &CanonicalClientValueV1,
) -> Result<(), GraphDemandTimeRefusalReasonV1> {
    if !canonical_client_value_is_valid(args) {
        return Err(GraphDemandTimeRefusalReasonV1::ArgumentInvalid);
    }
    let object = args
        .as_object()
        .ok_or(GraphDemandTimeRefusalReasonV1::ArgumentInvalid)?;
    if object.len() > plan.arguments.len()
        || object
            .keys()
            .any(|name| !plan.arguments.iter().any(|argument| &argument.name == name))
    {
        return Err(GraphDemandTimeRefusalReasonV1::ArgumentInvalid);
    }
    let limits = plan
        .query_cost
        .graph
        .arguments
        .iter()
        .map(|argument| (argument.argument_id.as_str(), argument.max_items))
        .collect::<BTreeMap<_, _>>();
    let mut cardinality = 0_u64;
    for argument in &plan.arguments {
        let Some(value) = object.get(&argument.name) else {
            if argument.contract.required {
                return Err(GraphDemandTimeRefusalReasonV1::ArgumentInvalid);
            }
            continue;
        };
        crate::result_contract::validate_handler_result_contract(
            "graph-argument",
            Some(argument.contract_hash.as_str()),
            &FunctionResultContract::Value {
                value: argument.contract.value.clone(),
            },
            value,
        )
        .map_err(|_| GraphDemandTimeRefusalReasonV1::ArgumentInvalid)?;
        let count = match value {
            Value::Array(values) => {
                let declared = limits
                    .get(argument.argument_id.as_str())
                    .ok_or(GraphDemandTimeRefusalReasonV1::ArgumentInvalid)?;
                let count = u64::try_from(values.len())
                    .map_err(|_| GraphDemandTimeRefusalReasonV1::ArgumentInvalid)?;
                if count > *declared {
                    return Err(GraphDemandTimeRefusalReasonV1::ArgumentInvalid);
                }
                count
            }
            _ => 1,
        };
        cardinality = cardinality
            .checked_add(count)
            .filter(|value| *value <= plan.query_cost.graph.max_argument_items)
            .ok_or(GraphDemandTimeRefusalReasonV1::ArgumentInvalid)?;
    }
    Ok(())
}

fn validate_interval_end(
    end: &GraphIntervalEndV1,
    order: &[OrderExpr],
) -> Result<(), GraphDemandTimeRefusalReasonV1> {
    match end {
        GraphIntervalEndV1::Unbounded => Ok(()),
        GraphIntervalEndV1::Inclusive { key } | GraphIntervalEndV1::Exclusive { key } => {
            if key
                .entries
                .iter()
                .any(|(_, value)| !canonical_client_value_is_valid(value))
            {
                return Err(GraphDemandTimeRefusalReasonV1::WindowVectorInvalid);
            }
            validate_keyset_for_order(key, order)
        }
    }
}

fn parent_point_lookup_key_is_valid(lookup_key: &[Value], join_arity: usize) -> bool {
    lookup_key.len() == join_arity
        && lookup_key
            .iter()
            .all(|value| !value.is_null() && canonical_client_value_is_valid(value))
}

/// Validate the complete node-id keyed demand window vector. The caller
/// supplies the evaluated parent set because child windows cannot be checked
/// against storage rows at manifest admission.
///
/// @ref LLP 0209#24-plan-instance-and-contextual-materialization-identity —
/// demand identity contains exactly one canonical vector entry per
/// demand-paged node and no cursor ledger.
pub fn validate_graph_window_vector_v1(
    plan: &GraphQueryPlanV1,
    windows: &[GraphNodeWindowIdentityV1],
    evaluated_parents: &BTreeMap<String, Vec<GraphRowKeyV1>>,
) -> Result<(), GraphDemandTimeRefusalReasonV1> {
    let demand_nodes = plan
        .nodes
        .iter()
        .filter(|node| node.demand_paged())
        .collect::<Vec<_>>();
    if windows.len() != demand_nodes.len() {
        return Err(GraphDemandTimeRefusalReasonV1::WindowVectorInvalid);
    }
    for (entry, node) in windows.iter().zip(demand_nodes) {
        if entry.node_id != node.node_id() {
            return Err(GraphDemandTimeRefusalReasonV1::WindowVectorInvalid);
        }
        let order = node
            .order()
            .ok_or(GraphDemandTimeRefusalReasonV1::WindowVectorInvalid)?;
        let cost = plan
            .query_cost
            .graph
            .nodes
            .iter()
            .find(|cost| cost.node_id == node.node_id())
            .ok_or(GraphDemandTimeRefusalReasonV1::WindowVectorInvalid)?;
        let maximum_take = match node {
            GraphNodeV1::RootWindow { .. } => cost.max_root_rows_per_page,
            GraphNodeV1::BoundedToMany { .. } => cost.max_children_per_parent,
            _ => None,
        }
        .ok_or(GraphDemandTimeRefusalReasonV1::WindowVectorInvalid)?;
        let expected_parents = evaluated_parents.get(node.node_id());
        if matches!(node, GraphNodeV1::RootWindow { .. }) {
            if entry.intervals.len() != 1 || entry.intervals[0].parent_key.is_some() {
                return Err(GraphDemandTimeRefusalReasonV1::WindowVectorInvalid);
            }
        } else {
            // @ref LLP 0209#24-plan-instance-and-contextual-materialization-identity —
            // a demand-paged child records exactly the evaluated physical
            // parent set; an empty root result therefore has an empty, but
            // still present, child interval vector.
            let expected =
                expected_parents.ok_or(GraphDemandTimeRefusalReasonV1::WindowVectorInvalid)?;
            let actual = entry
                .intervals
                .iter()
                .map(|interval| interval.parent_key.clone())
                .collect::<Option<Vec<_>>>()
                .ok_or(GraphDemandTimeRefusalReasonV1::WindowVectorInvalid)?;
            let mut canonical = actual.clone();
            sort_by_jcs_key(
                &mut canonical,
                GraphDemandTimeRefusalReasonV1::ArgumentInvalid,
            )?;
            if actual != canonical || actual.windows(2).any(|pair| pair[0] == pair[1]) {
                return Err(GraphDemandTimeRefusalReasonV1::WindowVectorInvalid);
            }
            let mut expected = expected.clone();
            sort_by_jcs_key(
                &mut expected,
                GraphDemandTimeRefusalReasonV1::ArgumentInvalid,
            )?;
            if actual != expected {
                return Err(GraphDemandTimeRefusalReasonV1::WindowVectorInvalid);
            }
        }
        for interval in &entry.intervals {
            if interval.window.order != order {
                return Err(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch);
            }
            if interval.window.take > GRAPH_MAX_SAFE_INTEGER || interval.window.take > maximum_take
            {
                return Err(GraphDemandTimeRefusalReasonV1::WindowVectorInvalid);
            }
            validate_interval_end(&interval.window.lower, order)?;
            validate_interval_end(&interval.window.upper, order)?;
        }
    }
    Ok(())
}

/// Host-recompute graph plan × args × demand-window identity.
pub fn graph_instance_identity_v1(
    plan_identity: &GraphPlanIdentityV1,
    args: &CanonicalClientValueV1,
    windows: Vec<GraphNodeWindowIdentityV1>,
    evaluated_parents: &BTreeMap<String, Vec<GraphRowKeyV1>>,
) -> Result<GraphInstanceIdentityV1, GraphDemandTimeRefusalReasonV1> {
    validate_graph_arguments_v1(&plan_identity.normalized_plan, args)?;
    validate_graph_window_vector_v1(&plan_identity.normalized_plan, &windows, evaluated_parents)?;
    let preimage = GraphInstancePreimageV1 {
        format: "snapback.graph-instance.v1".to_owned(),
        graph_plan_hash: plan_identity.plan_hash.clone(),
        args_digest: graph_args_digest_v1(args)?,
        windows,
    };
    let instance_hash = graph_domain_hash(b"snapback:graph-instance:v1:", &preimage)
        .map_err(|_| GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch)?;
    Ok(GraphInstanceIdentityV1 {
        preimage,
        instance_hash,
    })
}

/// Host-recompute LLP 0157's contextual wrapper over a graph instance.
///
/// @ref LLP 0209#24-plan-instance-and-contextual-materialization-identity —
/// cross-process identity includes app/database/target/activation/function.
pub fn graph_materialization_identity_v1(
    mut preimage: GraphMaterializationPreimageV1,
) -> Result<GraphMaterializationIdentityV1, GraphDemandTimeRefusalReasonV1> {
    preimage.format = "snapback.graph-materialization.v1".to_owned();
    if preimage.app_id.is_empty()
        || preimage.database_id.is_empty()
        || preimage.deployment_id.is_empty()
        || preimage.target_profile_id.is_empty()
        || preimage.function.app_id != preimage.app_id
        || preimage.function.expected_generation.app_id != preimage.app_id
    {
        return Err(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch);
    }
    let materialization_hash = graph_domain_hash(b"snapback:graph-materialization:v1:", &preimage)
        .map_err(|_| GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch)?;
    Ok(GraphMaterializationIdentityV1 {
        preimage,
        materialization_hash,
    })
}

pub fn exact_match_graph_demand_identity_v1(
    supplied_instance: &GraphInstanceIdentityV1,
    rebuilt_instance: &GraphInstanceIdentityV1,
    supplied_materialization: &GraphMaterializationIdentityV1,
    rebuilt_materialization: &GraphMaterializationIdentityV1,
) -> Result<(), GraphDemandTimeRefusalReasonV1> {
    if supplied_instance != rebuilt_instance || supplied_materialization != rebuilt_materialization
    {
        return Err(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch);
    }
    Ok(())
}

/// Recompute the owner-resolved class-2/partition-of-one identity.
///
/// @ref LLP 0209#32-authority-partition-identity-and-versioning — partition
/// identity is adjacent to, and intentionally excludes, authorizationVersion.
pub fn graph_authority_partition_identity_v1(
    mut preimage: GraphAuthorityPartitionPreimageV1,
) -> Result<GraphAuthorityPartitionIdentityV1, GraphDemandTimeRefusalReasonV1> {
    preimage.format = "snapback.graph-authority-partition.v1".to_owned();
    if preimage.class3.as_ref().is_some_and(|partition| {
        partition.format != "snapback.authority-partition.v1"
            || partition.authority_instance_id.is_empty()
            || partition
                .principal_data_scope
                .authorization_stream_incarnation
                .is_empty()
            || partition.delegation.as_ref().is_some_and(|delegation| {
                delegation.grant_id.is_empty()
                    || delegation.actor_principal_id.is_empty()
                    || delegation.effective_principal_id.is_empty()
            })
    }) {
        return Err(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch);
    }
    preimage.class2.sort_by(|left, right| {
        utf16_cmp(&left.node_id, &right.node_id)
            .then_with(|| utf16_cmp(&left.declaration_id, &right.declaration_id))
    });
    if preimage
        .class2
        .iter()
        .any(|input| input.node_id.is_empty() || input.declaration_id.is_empty())
        || preimage.class2.windows(2).any(|pair| {
            pair[0].node_id == pair[1].node_id && pair[0].declaration_id == pair[1].declaration_id
        })
    {
        return Err(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch);
    }
    let partition_hash = graph_domain_hash(b"snapback:graph-authority-partition:v1:", &preimage)
        .map_err(|_| GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch)?;
    Ok(GraphAuthorityPartitionIdentityV1 {
        preimage,
        partition_hash,
    })
}

/// Recompute a broadcast establishment scope in canonical graph-argument
/// order.
///
/// @ref LLP 0209#33-the-nine-llp-0268-inputs-and-their-carriers — broadcast
/// scopes bind the outer materialization and canonical argument values.
pub fn graph_broadcast_scope_identity_v1(
    plan: &GraphQueryPlanV1,
    mut preimage: GraphBroadcastScopePreimageV1,
) -> Result<GraphBroadcastScopeIdentityV1, GraphDemandTimeRefusalReasonV1> {
    preimage.format = "snapback.graph-broadcast-scope.v1".to_owned();
    let GraphBroadcastAdmissionV1::Broadcast { establishment, .. } = &plan.broadcast else {
        return Err(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch);
    };
    if preimage.policy_identity != establishment.scope.policy_identity {
        return Err(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch);
    }
    let order = plan
        .arguments
        .iter()
        .enumerate()
        .map(|(index, argument)| (argument.argument_id.as_str(), index))
        .collect::<BTreeMap<_, _>>();
    if preimage
        .arguments
        .iter()
        .any(|argument| !order.contains_key(argument.argument_id.as_str()))
    {
        return Err(GraphDemandTimeRefusalReasonV1::ArgumentInvalid);
    }
    preimage
        .arguments
        .sort_by_key(|argument| order[argument.argument_id.as_str()]);
    if preimage
        .arguments
        .windows(2)
        .any(|pair| pair[0].argument_id == pair[1].argument_id)
    {
        return Err(GraphDemandTimeRefusalReasonV1::ArgumentInvalid);
    }
    let expected_argument_ids = establishment
        .scope
        .argument_ids
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>();
    if preimage
        .arguments
        .iter()
        .map(|argument| argument.argument_id.as_str())
        .collect::<Vec<_>>()
        != expected_argument_ids
    {
        return Err(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch);
    }
    let scope_hash = graph_domain_hash(b"snapback:graph-broadcast-scope:v1:", &preimage)
        .map_err(|_| GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch)?;
    Ok(GraphBroadcastScopeIdentityV1 {
        preimage,
        scope_hash,
    })
}

/// Validate the additive graph capture independently of matcher consumption.
pub fn validate_graph_captured_read_v1(
    capture: &GraphCapturedReadV1,
    plan: &GraphQueryPlanV1,
) -> Result<(), GraphDemandTimeRefusalReasonV1> {
    if capture.format != "snapback.graph-captured-read.v1" {
        return Err(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch);
    }
    let node = plan
        .nodes
        .iter()
        .find(|node| node.node_id() == capture.node_id)
        .ok_or(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch)?;
    let plan_hash_matches = graph_plan_identity_v1(plan)
        .is_ok_and(|identity| identity.plan_hash == capture.graph_plan_hash);
    if node.kind() != capture.node_kind
        || node.authority().declared_class != capture.authority_class
        || !plan_hash_matches
    {
        return Err(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch);
    }
    let safe_count = |value: u64| value <= GRAPH_MAX_SAFE_INTEGER;
    let valid = match (node, &capture.dependency) {
        (
            GraphNodeV1::RootWindow {
                table,
                access_index,
                filters,
                order: declared_order,
                ..
            },
            GraphCapturedDependencyV1::RootRange {
                table: captured_table,
                index,
                predicate,
                order,
                limit,
                result_count,
                boundary,
                ..
            },
        ) => {
            captured_table == table
                && index == access_index
                && predicate == filters
                && order == declared_order
                && *limit > 0
                && safe_count(*limit)
                && *result_count <= *limit
                && safe_count(*result_count)
                && boundary
                    .as_ref()
                    .is_none_or(|key| validate_keyset_for_order(key, order).is_ok())
        }
        (
            GraphNodeV1::EqualityToOne {
                table,
                access_index,
                join_on,
                ..
            },
            GraphCapturedDependencyV1::ParentPoint {
                table: captured_table,
                index,
                lookup_key,
                child_key,
                found,
                row_version,
                ..
            },
        ) => {
            captured_table == table
                && index == access_index
                && parent_point_lookup_key_is_valid(lookup_key, join_on.len())
                && ((*found && child_key.is_some() && row_version.is_some_and(safe_count))
                    || (!*found && child_key.is_none() && row_version.is_none()))
        }
        (
            GraphNodeV1::EqualityToOne {
                table,
                access_index,
                ..
            },
            GraphCapturedDependencyV1::ParentLookupSkipped {
                table: captured_table,
                index,
                ..
            },
        ) => captured_table == table && index == access_index,
        (
            GraphNodeV1::BoundedToMany {
                table,
                access_index,
                filters,
                order: declared_order,
                ..
            },
            GraphCapturedDependencyV1::ParentRange {
                table: captured_table,
                index,
                predicate,
                order,
                limit,
                result_count,
                boundary,
                ..
            },
        ) => {
            captured_table == table
                && index == access_index
                && predicate.as_slice() == filters.as_deref().unwrap_or_default()
                && order == declared_order
                && *limit > 0
                && safe_count(*limit)
                && *result_count <= *limit
                && safe_count(*result_count)
                && boundary
                    .as_ref()
                    .is_none_or(|key| validate_keyset_for_order(key, order).is_ok())
        }
        (
            GraphNodeV1::ExistsSemiJoin {
                mode,
                edge,
                argument_id: declared_argument_id,
                ..
            },
            GraphCapturedDependencyV1::Membership {
                tables,
                indexes,
                argument_id,
                argument_digest,
                matched_count,
                ..
            },
        ) => {
            let (expected_tables, expected_indexes) = match edge {
                GraphEdgeV1::Direct(edge) => (vec![&edge.table], vec![&edge.access_index]),
                GraphEdgeV1::Through(edge) => (
                    vec![&edge.table, &edge.target_table],
                    vec![&edge.parent_index, &edge.target_index],
                ),
            };
            tables.iter().eq(expected_tables)
                && indexes.iter().eq(expected_indexes)
                && safe_count(*matched_count)
                && match mode {
                    GraphExistsModeV1::Exists => argument_id.is_none() && argument_digest.is_none(),
                    GraphExistsModeV1::All => {
                        argument_id.as_ref() == declared_argument_id.as_ref()
                            && argument_digest.is_some()
                    }
                }
        }
        (
            GraphNodeV1::PrincipalBound {
                table,
                access_index,
                principal_field,
                binding,
                ..
            },
            GraphCapturedDependencyV1::PrincipalField {
                table: captured_table,
                index,
                field,
                ..
            },
        ) => {
            (captured_table == table && index == access_index && field == principal_field)
                || binding.as_ref().is_some_and(|binding| {
                    captured_table == &binding.table
                        && index == &binding.unique_index
                        && (field == &binding.principal_field || field == &binding.value_field)
                })
        }
        (
            GraphNodeV1::SearchMembership {
                membership_identity,
                invalidation_tables,
                ..
            },
            GraphCapturedDependencyV1::SearchTable {
                table,
                membership_identity: captured_identity,
                provider_version,
            },
        ) => {
            invalidation_tables.contains(table)
                && captured_identity == membership_identity
                && provider_version == &membership_identity.provider_version
        }
        (
            GraphNodeV1::ClosedProjection { .. },
            GraphCapturedDependencyV1::Projection { source_node_ids },
        ) => {
            let expected = plan
                .nodes
                .iter()
                .filter(|node| !matches!(node, GraphNodeV1::ClosedProjection { .. }))
                .map(|node| node.node_id().to_owned())
                .collect::<Vec<_>>();
            source_node_ids == &expected
        }
        _ => false,
    };
    if valid {
        Ok(())
    } else {
        Err(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn zero_hash() -> &'static str {
        "sha256:0000000000000000000000000000000000000000000000000000000000000000"
    }

    fn one_hash() -> &'static str {
        "sha256:1111111111111111111111111111111111111111111111111111111111111111"
    }

    fn authority(class: u8) -> Value {
        json!({"declaredClass": class, "proof": null})
    }

    fn root_node(node_id: &str) -> Value {
        json!({
            "nodeId": node_id,
            "kind": "root-window",
            "edgeName": "$root",
            "authority": authority(1),
            "table": "issues",
            "visibility": {"kind": "public-read"},
            "filters": [],
            "accessIndex": "by_updated",
            "order": [{"field": "updatedAt", "direction": "Desc"}],
            "page": {"kind": "demand"}
        })
    }

    fn projection_node(node_id: &str, root_id: &str) -> Value {
        json!({
            "nodeId": node_id,
            "kind": "closed-projection",
            "edgeName": "$result",
            "authority": authority(1),
            "object": {
                "scopeNodeId": root_id,
                "fields": [{
                    "name": "title",
                    "value": {"kind": "field", "nodeId": root_id, "field": "title"}
                }]
            }
        })
    }

    fn candidate_plan(root_id: &str, projection_id: &str) -> GraphQueryPlanV1 {
        serde_json::from_value(json!({
            "format": "snapback.graph-query-plan.v1",
            "capabilityId": "graph_query_v1",
            "rootNodeId": root_id,
            "nodes": [root_node(root_id), projection_node(projection_id, root_id)],
            "arguments": [],
            "queryCost": {
                "maxScannedRows": 3,
                "maxIndexRanges": 1,
                "maxResultRows": 2,
                "maxResultBytes": 100,
                "maxEvaluationTurnMs": 10,
                "maxObservers": 1,
                "maxDistinctEvaluationGroups": 1,
                "maxEstimatedLiveFanoutMs": 10,
                "graph": {
                    "nodes": [{
                        "nodeId": root_id,
                        "maxRootRowsPerPage": 2,
                        "maxExaminedEntriesPerExecution": 3,
                        "maxWindowPages": 2,
                        "maxWindowRootRows": 4,
                        "maxWindowScannedRows": 6,
                        "maxWindowResultRows": 4,
                        "maxWindowResultBytes": 200,
                        "maxWindowIndexRanges": 2
                    }],
                    "arguments": [],
                    "maxArgumentItems": 0,
                    "maxPageResultBytes": 100,
                    "windowRollup": {
                        "maxWindowPages": 2,
                        "maxWindowRootRows": 4,
                        "maxWindowScannedRows": 6,
                        "maxWindowResultRows": 4,
                        "maxWindowResultBytes": 200,
                        "maxWindowIndexRanges": 2
                    },
                    "maxMaintainedWritesPerMutation": 0
                }
            },
            "authorityPartitionRule": {
                "format": "snapback.graph-authority-partition-rule.v1",
                "class2Inputs": [],
                "class3": "none"
            },
            "broadcast": {
                "format": "snapback.graph-broadcast-admission.v1",
                "classification": "query-shaped",
                "reason": "declared-query-shaped"
            },
            "resultContractHash": zero_hash()
        }))
        .expect("valid graph fixture")
    }

    fn root_window(node_id: &str) -> GraphNodeWindowIdentityV1 {
        GraphNodeWindowIdentityV1 {
            node_id: node_id.to_owned(),
            intervals: vec![GraphParentWindowIdentityV1 {
                parent_key: None,
                window: GraphWindowIdentityV1 {
                    order: vec![OrderExpr {
                        field: "updatedAt".to_owned(),
                        direction: OrderDirection::Desc,
                        max_encoded_bytes: None,
                    }],
                    direction: GraphDirectionV1::Backward,
                    lower: GraphIntervalEndV1::Unbounded,
                    upper: GraphIntervalEndV1::Unbounded,
                    take: 2,
                },
            }],
        }
    }

    #[test]
    fn graph_query_v1_schema_round_trips_every_node_kind() {
        let nodes = vec![
            root_node("n0"),
            json!({
                "nodeId":"n1", "kind":"equality-to-one", "edgeName":"owner",
                "authority":authority(1), "parentNodeId":"n0", "table":"users",
                "visibility":{"kind":"public-read"},
                "joinOn":[{"rootField":"ownerId","joinedField":"id"}],
                "accessIndex":"by_id", "presence":"optional"
            }),
            json!({
                "nodeId":"n2", "kind":"bounded-to-many", "edgeName":"comments",
                "authority":authority(1), "parentNodeId":"n0", "table":"comments",
                "visibility":{"kind":"public-read"},
                "joinOn":[{"rootField":"id","joinedField":"issueId"}],
                "accessIndex":"by_issue", "order":[{"field":"createdAt","direction":"Asc"}],
                "page":{"kind":"literal","direction":"forward","lower":{"kind":"unbounded"},"upper":{"kind":"unbounded"},"take":10}
            }),
            json!({
                "nodeId":"n3", "kind":"exists-semi-join", "edgeName":"hasVotes",
                "authority":authority(1), "parentNodeId":"n0", "mode":"exists",
                "edge":{"table":"votes","visibility":{"kind":"public-read"},
                    "joinOn":[{"rootField":"id","joinedField":"issueId"}],"accessIndex":"by_issue"}
            }),
            json!({
                "nodeId":"n4", "kind":"principal-bound", "edgeName":"viewState",
                "authority":authority(3), "parentNodeId":"n0", "table":"viewState",
                "visibility":{"kind":"owner","field":"userId"},
                "parentJoin":[{"rootField":"id","joinedField":"issueId"}],
                "principalField":"userId", "accessIndex":"by_user_issue",
                "principalSource":"auth.userId"
            }),
            json!({
                "nodeId":"n5", "kind":"search-membership", "edgeName":"matches",
                "authority":authority(1), "parentNodeId":"n0", "providerCapabilityId":"search.v1",
                "membershipIdentity":{
                    "format":"snapback.graph-search-membership-identity.v1",
                    "providerPlanHash":zero_hash(), "argumentContractHash":zero_hash(),
                    "scopeContractHash":zero_hash(), "authorityClass":1,
                    "providerVersion":"v1", "providerCompletenessClass":"complete-membership-v1",
                    "membershipHash":zero_hash()
                },
                "memberField":"id", "scopeBindings":[{"providerScopeField":"projectId","source":{"kind":"parent-field","nodeId":"n0","field":"projectId"}}],
                "invalidationTables":["issues"], "providerCompletenessClass":"complete-membership-v1"
            }),
            projection_node("n6", "n0"),
        ];
        for node in nodes {
            let decoded: GraphNodeV1 = serde_json::from_value(node.clone()).expect("node decodes");
            assert_eq!(serde_json::to_value(decoded).expect("node encodes"), node);
        }
        let mut missing_required_null = root_node("n0");
        missing_required_null["authority"]
            .as_object_mut()
            .unwrap()
            .remove("proof");
        assert!(serde_json::from_value::<GraphNodeV1>(missing_required_null).is_err());

        let mut optional_null = json!({
            "nodeId":"n1", "kind":"equality-to-one", "edgeName":"owner",
            "authority":authority(1), "parentNodeId":"n0", "table":"users",
            "visibility":{"kind":"public-read"},
            "joinOn":[{"rootField":"ownerId","joinedField":"id"}],
            "accessIndex":"by_id", "presence":"optional", "filters":null
        });
        assert!(serde_json::from_value::<GraphNodeV1>(optional_null.clone()).is_err());
        optional_null.as_object_mut().unwrap().remove("filters");
        assert!(serde_json::from_value::<GraphNodeV1>(optional_null).is_ok());

        let numeric_class: GraphPartitionEquivalenceProofV1 = serde_json::from_value(json!({
            "format":"snapback.graph-partition-equivalence-proof.v1",
            "nodeId":"n0", "declaredClass":2,
            "policyInputs":[{"declarationId":"members","kind":"membership","identity":zero_hash()}],
            "partitionFunction":zero_hash(),
            "equivalenceWitness":"declared-inputs-only"
        }))
        .expect("class-2 literal is numeric");
        assert_eq!(
            serde_json::to_value(numeric_class).unwrap()["declaredClass"],
            2
        );
        assert!(
            serde_json::from_value::<GraphPartitionEquivalenceProofV1>(json!({
                "format":"snapback.graph-partition-equivalence-proof.v1",
                "nodeId":"n0", "declaredClass":"2",
                "policyInputs":[{"declarationId":"members","kind":"membership","identity":zero_hash()}],
                "partitionFunction":zero_hash(),
                "equivalenceWitness":"declared-inputs-only"
            }))
            .is_err()
        );

        let schema = serde_json::to_value(schemars::schema_for!(GraphQueryPlanV1)).unwrap();
        let schema_text = schema.to_string();
        for kind in [
            "root-window",
            "equality-to-one",
            "bounded-to-many",
            "exists-semi-join",
            "principal-bound",
            "search-membership",
            "closed-projection",
        ] {
            assert!(schema_text.contains(kind), "schema omits {kind}");
        }
    }

    #[test]
    fn graph_plan_identity_v1_frozen_positive_and_axis_rotations() {
        let vectors: Value = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../tests/conformance/graph/identity-vectors.v1.json"
        )))
        .unwrap();
        for vector in vectors["jcsBoundary"]
            .as_array()
            .expect("JCS boundary vectors are an array")
        {
            let name = vector["name"].as_str().expect("JCS vector has a name");
            if vector["javascript"] == "Infinity" {
                assert_eq!(
                    crate::rqs_contract::ecma_number_string(f64::INFINITY),
                    Err(crate::rqs_contract::MintRefusal::NonFiniteNumber),
                    "{name}"
                );
                continue;
            }
            let parsed = serde_json::from_str::<Value>(
                vector["json"].as_str().expect("JCS vector has JSON"),
            );
            if let Some(canonical) = vector["canonical"].as_str() {
                assert_eq!(
                    crate::rqs_contract::jcs(&parsed.expect("accepted JCS vector parses")),
                    Ok(canonical.to_owned()),
                    "{name}"
                );
            } else if name == "lone-surrogate" {
                assert!(
                    parsed.is_err(),
                    "{name} must be structurally refused by Rust"
                );
            } else {
                assert_eq!(
                    crate::rqs_contract::jcs(&parsed.expect("numeric refusal vector parses")),
                    Err(crate::rqs_contract::MintRefusal::UnsafeInteger),
                    "{name}"
                );
            }
        }
        let candidate = candidate_plan("authored-root", "authored-result");
        let plan = graph_plan_identity_v1(&candidate).expect("plan identity");
        assert_eq!(plan.normalized_plan.root_node_id, "n0");
        assert_eq!(plan.normalized_plan.nodes[0].node_id(), "n0");
        assert_eq!(plan.normalized_plan.nodes[1].node_id(), "n1");
        assert_eq!(
            plan.plan_hash.as_str(),
            vectors["plan"]["hash"].as_str().unwrap()
        );
        let mut rotated_plan_candidate = candidate_plan("authored-root", "authored-result");
        let GraphNodeV1::RootWindow { table, .. } = &mut rotated_plan_candidate.nodes[0] else {
            unreachable!()
        };
        *table = "issues_rotated".to_owned();
        let rotated_plan = graph_plan_identity_v1(&rotated_plan_candidate).unwrap();
        assert_eq!(
            rotated_plan.plan_hash.as_str(),
            vectors["plan"]["rotatedHash"].as_str().unwrap()
        );
        assert_ne!(plan.plan_hash, rotated_plan.plan_hash);

        let instance = graph_instance_identity_v1(
            &plan,
            &json!({}),
            vec![root_window("n0")],
            &BTreeMap::new(),
        )
        .expect("instance identity");
        assert_eq!(
            instance.instance_hash.as_str(),
            vectors["instance"]["hash"].as_str().unwrap()
        );
        let mut rotated_window = root_window("n0");
        rotated_window.intervals[0].window.take = 1;
        let rotated_instance =
            graph_instance_identity_v1(&plan, &json!({}), vec![rotated_window], &BTreeMap::new())
                .expect("rotated instance");
        assert_eq!(
            rotated_instance.instance_hash.as_str(),
            vectors["instance"]["rotatedHash"].as_str().unwrap()
        );
        assert_ne!(instance.instance_hash, rotated_instance.instance_hash);
        assert_eq!(
            graph_instance_identity_v1(
                &plan,
                &json!({"extra": true}),
                vec![root_window("n0")],
                &BTreeMap::new(),
            ),
            Err(GraphDemandTimeRefusalReasonV1::ArgumentInvalid)
        );
        assert_eq!(
            graph_instance_identity_v1(&plan, &json!({}), Vec::new(), &BTreeMap::new()),
            Err(GraphDemandTimeRefusalReasonV1::WindowVectorInvalid)
        );
        let mut wrong_order = root_window("n0");
        wrong_order.intervals[0].window.order[0].direction = OrderDirection::Asc;
        assert_eq!(
            graph_instance_identity_v1(&plan, &json!({}), vec![wrong_order], &BTreeMap::new(),),
            Err(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch)
        );

        let preimage: GraphMaterializationPreimageV1 = serde_json::from_value(json!({
            "format":"snapback.graph-materialization.v1", "appId":"app", "databaseId":"db",
            "deploymentId":"deployment-a", "targetProfileId":"local", "activationHash":zero_hash(),
            "function":{
                "artifactKind":"functionReference", "schemaVersion":"snapback.v1", "appId":"app",
                "id":"fn-id", "name":"issues", "kind":"LiveQuery",
                "implementationHash":zero_hash(), "argsContractHash":zero_hash(),
                "resultContractHash":zero_hash(),
                "expectedGeneration":{"schemaVersion":"snapback.v1","appId":"app","schemaHash":"schema","bundleHash":"bundle","inputsHash":"inputs"}
            },
            "graphInstanceHash":instance.instance_hash
        })).expect("materialization preimage");
        let materialization = graph_materialization_identity_v1(preimage.clone()).unwrap();
        assert_eq!(
            materialization.materialization_hash.as_str(),
            vectors["materialization"]["hash"].as_str().unwrap()
        );
        let mut rotated_preimage = preimage;
        rotated_preimage.deployment_id = "deployment-b".to_owned();
        let rotated_materialization = graph_materialization_identity_v1(rotated_preimage).unwrap();
        assert_eq!(
            rotated_materialization.materialization_hash.as_str(),
            vectors["materialization"]["rotatedHash"].as_str().unwrap()
        );
        assert_ne!(
            materialization.materialization_hash,
            rotated_materialization.materialization_hash
        );
        assert_eq!(
            exact_match_graph_demand_identity_v1(
                &rotated_instance,
                &instance,
                &materialization,
                &materialization,
            ),
            Err(GraphDemandTimeRefusalReasonV1::DemandIdentityMismatch)
        );

        let proof =
            recompute_graph_partition_equivalence_proof_v1(&GraphPartitionEquivalenceProofV1 {
                format: "snapback.graph-partition-equivalence-proof.v1".to_owned(),
                node_id: "n0".to_owned(),
                declared_class: GraphProofDeclaredClassV1::Class2,
                policy_inputs: vec![
                    GraphPolicyInputV1 {
                        declaration_id: "z-policy".to_owned(),
                        kind: GraphPolicyInputKindV1::Role,
                        identity: Sha256V1::new(one_hash()).unwrap(),
                    },
                    GraphPolicyInputV1 {
                        declaration_id: "a-policy".to_owned(),
                        kind: GraphPolicyInputKindV1::Membership,
                        identity: Sha256V1::new(zero_hash()).unwrap(),
                    },
                ],
                partition_function: Sha256V1::new(zero_hash()).unwrap(),
                equivalence_witness: GraphEquivalenceWitnessV1::DeclaredInputsOnly,
            })
            .unwrap();
        assert_eq!(
            proof.partition_function.as_str(),
            vectors["partitionFunction"]["hash"].as_str().unwrap()
        );
        let mut rotated_proof = proof.clone();
        rotated_proof.policy_inputs[0].identity = Sha256V1::new(one_hash()).unwrap();
        let rotated_proof = recompute_graph_partition_equivalence_proof_v1(&rotated_proof).unwrap();
        assert_eq!(
            rotated_proof.partition_function.as_str(),
            vectors["partitionFunction"]["rotatedHash"]
                .as_str()
                .unwrap()
        );
        assert_ne!(proof.partition_function, rotated_proof.partition_function);

        let partition = graph_authority_partition_identity_v1(GraphAuthorityPartitionPreimageV1 {
            format: "snapback.graph-authority-partition.v1".to_owned(),
            graph_plan_hash: plan.plan_hash.clone(),
            class2: vec![GraphResolvedPartitionInputV1 {
                node_id: "n0".to_owned(),
                declaration_id: "a-policy".to_owned(),
                scope_identity: Sha256V1::new(zero_hash()).unwrap(),
                policy_identity: Sha256V1::new(one_hash()).unwrap(),
            }],
            class3: None,
        })
        .unwrap();
        assert_eq!(
            partition.partition_hash.as_str(),
            vectors["authorityPartition"]["hash"].as_str().unwrap()
        );
        let mut rotated_partition_preimage = partition.preimage.clone();
        rotated_partition_preimage.class2[0].scope_identity = Sha256V1::new(one_hash()).unwrap();
        let rotated_partition =
            graph_authority_partition_identity_v1(rotated_partition_preimage).unwrap();
        assert_eq!(
            rotated_partition.partition_hash.as_str(),
            vectors["authorityPartition"]["rotatedHash"]
                .as_str()
                .unwrap()
        );
        assert_ne!(partition.partition_hash, rotated_partition.partition_hash);

        let mut scope_plan = plan.normalized_plan.clone();
        scope_plan.broadcast = GraphBroadcastAdmissionV1::Broadcast {
            format: "snapback.graph-broadcast-admission.v1".to_owned(),
            base_node_ids: vec!["n0".to_owned()],
            establishment: GraphBroadcastEstablishmentV1 {
                effect: GraphBroadcastEffectV1::AdmitOnly,
                predicate: TableVisibilityV1::PublicRead,
                overlay_projection: (),
                scope: GraphBroadcastScopeV1 {
                    argument_ids: Vec::new(),
                    policy_identity: Sha256V1::new(zero_hash()).unwrap(),
                    resource_equalities: Vec::new(),
                },
                audience: GraphBroadcastAudienceV1 {
                    strict_evaluator_identity: Sha256V1::new(zero_hash()).unwrap(),
                },
                invalidation: Vec::new(),
            },
        };
        let scope = graph_broadcast_scope_identity_v1(
            &scope_plan,
            GraphBroadcastScopePreimageV1 {
                format: "snapback.graph-broadcast-scope.v1".to_owned(),
                graph_materialization_hash: materialization.materialization_hash.clone(),
                policy_identity: Sha256V1::new(zero_hash()).unwrap(),
                arguments: Vec::new(),
            },
        )
        .unwrap();
        assert_eq!(
            scope.scope_hash.as_str(),
            vectors["broadcastScope"]["hash"].as_str().unwrap()
        );
        let mut rotated_scope_preimage = scope.preimage.clone();
        rotated_scope_preimage.policy_identity = Sha256V1::new(one_hash()).unwrap();
        scope_plan
            .broadcast
            .clone_from(&GraphBroadcastAdmissionV1::Broadcast {
                format: "snapback.graph-broadcast-admission.v1".to_owned(),
                base_node_ids: vec!["n0".to_owned()],
                establishment: GraphBroadcastEstablishmentV1 {
                    effect: GraphBroadcastEffectV1::AdmitOnly,
                    predicate: TableVisibilityV1::PublicRead,
                    overlay_projection: (),
                    scope: GraphBroadcastScopeV1 {
                        argument_ids: Vec::new(),
                        policy_identity: Sha256V1::new(one_hash()).unwrap(),
                        resource_equalities: Vec::new(),
                    },
                    audience: GraphBroadcastAudienceV1 {
                        strict_evaluator_identity: Sha256V1::new(zero_hash()).unwrap(),
                    },
                    invalidation: Vec::new(),
                },
            });
        let rotated_scope =
            graph_broadcast_scope_identity_v1(&scope_plan, rotated_scope_preimage).unwrap();
        assert_eq!(
            rotated_scope.scope_hash.as_str(),
            vectors["broadcastScope"]["rotatedHash"].as_str().unwrap()
        );
        assert_ne!(scope.scope_hash, rotated_scope.scope_hash);
    }

    #[test]
    fn graph_instance_identity_distinguishes_empty_and_one_physical_child_parent() {
        let mut normalized_plan = candidate_plan("n0", "n2");
        normalized_plan.nodes.insert(
            1,
            serde_json::from_value(json!({
                "nodeId":"n1", "kind":"bounded-to-many", "edgeName":"comments",
                "authority":authority(1), "parentNodeId":"n0", "table":"comments",
                "visibility":{"kind":"public-read"},
                "joinOn":[{"rootField":"id","joinedField":"issueId"}],
                "accessIndex":"by_issue", "order":[{"field":"updatedAt","direction":"Desc"}],
                "page":{"kind":"demand"}
            }))
            .unwrap(),
        );
        normalized_plan.query_cost.graph.nodes.insert(
            1,
            GraphNodeCostV1 {
                node_id: "n1".to_owned(),
                max_root_rows_per_page: None,
                max_examined_entries_per_execution: 3,
                max_relationship_lookups_per_execution: Some(1),
                max_children_per_parent: Some(2),
                max_argument_expansion: None,
                max_window_pages: Some(1),
                max_window_root_rows: Some(0),
                max_window_scanned_rows: Some(3),
                max_window_result_rows: Some(2),
                max_window_result_bytes: Some(100),
                max_window_index_ranges: Some(1),
            },
        );
        let plan = GraphPlanIdentityV1 {
            normalized_plan,
            plan_hash: Sha256V1::new(zero_hash()).unwrap(),
        };
        let child_window = |intervals| GraphNodeWindowIdentityV1 {
            node_id: "n1".to_owned(),
            intervals,
        };
        let empty_windows = vec![root_window("n0"), child_window(Vec::new())];
        let empty_parents = BTreeMap::from([("n1".to_owned(), Vec::new())]);
        let empty = graph_instance_identity_v1(&plan, &json!({}), empty_windows, &empty_parents)
            .expect("empty evaluated child parent set is represented exactly");

        let physical_parent = GraphRowKeyV1 {
            table: "issues".to_owned(),
            id: "physical_issue_1".to_owned(),
        };
        let one_windows = vec![
            root_window("n0"),
            child_window(vec![GraphParentWindowIdentityV1 {
                parent_key: Some(physical_parent.clone()),
                window: GraphWindowIdentityV1 {
                    order: vec![OrderExpr {
                        field: "updatedAt".to_owned(),
                        direction: OrderDirection::Desc,
                        max_encoded_bytes: None,
                    }],
                    direction: GraphDirectionV1::Forward,
                    lower: GraphIntervalEndV1::Unbounded,
                    upper: GraphIntervalEndV1::Unbounded,
                    take: 2,
                },
            }]),
        ];
        let one_parents = BTreeMap::from([("n1".to_owned(), vec![physical_parent])]);
        let one = graph_instance_identity_v1(&plan, &json!({}), one_windows, &one_parents)
            .expect("one evaluated physical child parent is represented exactly");
        assert_ne!(empty.instance_hash, one.instance_hash);
    }

    #[test]
    fn normalized_graph_plan_preorder_example_is_pinned() {
        let mut plan = candidate_plan("root", "result");
        let child = |node_id: &str, edge_name: &str| {
            serde_json::from_value::<GraphNodeV1>(json!({
                "nodeId":node_id, "kind":"equality-to-one", "edgeName":edge_name,
                "authority":authority(1), "parentNodeId":"root", "table":edge_name,
                "visibility":{"kind":"public-read"},
                "joinOn":[{"rootField":"id","joinedField":"issueId"}],
                "accessIndex":"by_issue", "presence":"optional"
            }))
            .unwrap()
        };
        plan.nodes.insert(1, child("labels", "labels"));
        plan.nodes.insert(2, child("comments", "comments"));
        plan.query_cost.graph.nodes.extend([
            GraphNodeCostV1 {
                node_id: "labels".to_owned(),
                max_root_rows_per_page: None,
                max_examined_entries_per_execution: 1,
                max_relationship_lookups_per_execution: Some(1),
                max_children_per_parent: None,
                max_argument_expansion: None,
                max_window_pages: None,
                max_window_root_rows: None,
                max_window_scanned_rows: None,
                max_window_result_rows: None,
                max_window_result_bytes: None,
                max_window_index_ranges: None,
            },
            GraphNodeCostV1 {
                node_id: "comments".to_owned(),
                max_examined_entries_per_execution: 1,
                max_relationship_lookups_per_execution: Some(1),
                max_root_rows_per_page: None,
                max_children_per_parent: None,
                max_argument_expansion: None,
                max_window_pages: None,
                max_window_root_rows: None,
                max_window_scanned_rows: None,
                max_window_result_rows: None,
                max_window_result_bytes: None,
                max_window_index_ranges: None,
            },
        ]);
        plan.query_cost.max_scanned_rows = 5;
        let normalized = normalized_graph_plan(&plan).unwrap();
        let actual = normalized
            .nodes
            .iter()
            .map(|node| json!([node.node_id(), node.edge_name()]))
            .collect::<Vec<_>>();
        let vector: Value = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../tests/conformance/graph/normalized-preorder.v1.json"
        )))
        .unwrap();
        assert_eq!(actual, vector["normalized"].as_array().unwrap().clone());
    }

    #[test]
    fn graph_keyset_kernel_round_trip_rejects_bad_wire_shapes() {
        let vectors: Value = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../tests/conformance/graph/keyset-vectors.v1.json"
        )))
        .unwrap();
        let positive: KeysetKeyV1 =
            serde_json::from_value(vectors["positive"].clone()).expect("positive keyset");
        let order = vec![
            OrderExpr {
                field: "priority".to_owned(),
                direction: OrderDirection::Asc,
                max_encoded_bytes: None,
            },
            OrderExpr {
                field: "updatedAt".to_owned(),
                direction: OrderDirection::Desc,
                max_encoded_bytes: None,
            },
        ];
        validate_keyset_for_order(&positive, &order).unwrap();
        for vector in vectors["negative"].as_array().unwrap() {
            match vector["name"].as_str().unwrap() {
                "reserved-id-entry" | "wrong-field-order" => {
                    let key: KeysetKeyV1 = serde_json::from_value(json!({
                        "entries": vector["entries"], "id": vector["id"]
                    }))
                    .unwrap();
                    assert_eq!(
                        validate_keyset_for_order(&key, &order),
                        Err(GraphDemandTimeRefusalReasonV1::WindowVectorInvalid)
                    );
                }
                _ => assert!(
                    serde_json::from_value::<KeysetKeyV1>(json!({
                        "entries": vector["entries"], "id": vector["id"]
                    }))
                    .is_err()
                ),
            }
        }
        for vector in vectors["literalPageNegative"].as_array().unwrap() {
            let order: Vec<OrderExpr> = serde_json::from_value(vector["order"].clone()).unwrap();
            let mut end = vector["end"].clone();
            if vector["name"] == "literal-lower-oversized-canonical-value" {
                end["key"]["entries"][0][1] = json!("x".repeat(65_537));
            }
            let end: GraphIntervalEndV1 = serde_json::from_value(end).unwrap();
            let page = GraphLiteralPageV1 {
                kind: GraphLiteralPageKindV1::Literal,
                direction: GraphDirectionV1::Forward,
                lower: end,
                upper: GraphIntervalEndV1::Unbounded,
                take: 1,
            };
            let refused = validate_order(&order).is_err()
                || validate_interval_end(&page.lower, &order).is_err()
                || validate_interval_end(&page.upper, &order).is_err();
            assert!(refused, "{} must refuse", vector["name"]);
        }
    }

    #[test]
    fn graph_query_shaped_reason_hyphenated_vector_round_trips() {
        let vectors: Value = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../tests/conformance/graph/serde-vectors.v1.json"
        )))
        .unwrap();
        let encoded = vectors["queryShapedReason"].clone();
        let decoded: GraphQueryShapedReasonV1 = serde_json::from_value(encoded.clone()).unwrap();
        assert_eq!(decoded, GraphQueryShapedReasonV1::BaseNotClass1);
        assert_eq!(serde_json::to_value(decoded).unwrap(), encoded);
    }

    #[test]
    fn graph_normalization_selects_query_reason_and_separates_argument_names_from_ids() {
        let mut class3 = candidate_plan("root", "projection");
        for node in &mut class3.nodes {
            node.authority_mut().declared_class = GraphAuthorityClassV1::PRINCIPAL_SCOPED;
        }
        class3.authority_partition_rule.class3 = GraphClass3PartitionV1::PartitionOfOne;
        let mut normalized = normalized_graph_plan(&class3).unwrap();
        assert!(matches!(
            normalized.broadcast,
            GraphBroadcastAdmissionV1::QueryShaped {
                reason: GraphQueryShapedReasonV1::BaseNotClass1,
                ..
            }
        ));
        let GraphBroadcastAdmissionV1::QueryShaped { reason, .. } = &mut normalized.broadcast
        else {
            unreachable!()
        };
        *reason = GraphQueryShapedReasonV1::DeclaredQueryShaped;
        assert_eq!(
            validate_graph_query_plan_v1(&normalized),
            Err(GraphAdmissionRefusalReasonV1::PlanIdentityMismatch)
        );

        let mut collision = candidate_plan("root", "projection");
        collision.arguments = serde_json::from_value(json!([
            {
                "argumentId":"authored-A", "name":"A",
                "contract":{"format":"snapback.argument-binding-contract.v1","required":true,"value":{"kind":"boolean"}},
                "contractHash":zero_hash()
            },
            {
                "argumentId":"authored-a0", "name":"a0",
                "contract":{"format":"snapback.argument-binding-contract.v1","required":true,"value":{"kind":"boolean"}},
                "contractHash":zero_hash()
            }
        ])).unwrap();
        assert_eq!(
            normalized_graph_plan(&collision),
            Err(GraphAdmissionRefusalReasonV1::ArgumentUnbound)
        );
    }

    #[test]
    fn graph_collection_arguments_contribute_to_max_argument_items_once() {
        let mut candidate = candidate_plan("root", "projection");
        candidate.arguments = serde_json::from_value(json!([
            {
                "argumentId":"authored-labels", "name":"labels",
                "contract":{
                    "format":"snapback.argument-binding-contract.v1",
                    "required":true,
                    "value":{"kind":"array","element":{"kind":"string","maxBytes":32},"maxItems":3}
                },
                "contractHash":zero_hash()
            },
            {
                "argumentId":"authored-assignees", "name":"assignees",
                "contract":{
                    "format":"snapback.argument-binding-contract.v1",
                    "required":true,
                    "value":{"kind":"array","element":{"kind":"string","maxBytes":32},"maxItems":5}
                },
                "contractHash":zero_hash()
            }
        ]))
        .unwrap();
        candidate.query_cost.graph.arguments = serde_json::from_value(json!([
            {"argumentId":"authored-labels","maxItems":3},
            {"argumentId":"authored-assignees","maxItems":5}
        ]))
        .unwrap();
        candidate.query_cost.graph.max_argument_items = 8;

        let admitted = graph_plan_identity_v1(&candidate).expect("3 + 5 admits at eight");
        assert_eq!(
            validate_graph_query_plan_v1(&admitted.normalized_plan),
            Ok(())
        );

        let mut refused = admitted.normalized_plan;
        refused.query_cost.graph.max_argument_items = 7;
        assert_eq!(
            validate_graph_query_plan_v1(&refused),
            Err(GraphAdmissionRefusalReasonV1::BoundInvalid)
        );
    }

    #[test]
    fn graph_jcs_sort_refuses_fallible_keys_without_panicking() {
        struct SerializationRefusal;

        impl Serialize for SerializationRefusal {
            fn serialize<S>(&self, _serializer: S) -> Result<S::Ok, S::Error>
            where
                S: serde::Serializer,
            {
                Err(<S::Error as serde::ser::Error>::custom(
                    "deliberate graph JCS refusal",
                ))
            }
        }

        let mut values = vec![SerializationRefusal];
        assert_eq!(
            sort_by_jcs_key(&mut values, GraphAdmissionRefusalReasonV1::ArgumentUnbound),
            Err(GraphAdmissionRefusalReasonV1::ArgumentUnbound)
        );
    }

    #[test]
    fn graph_stage_b1_search_and_broadcast_are_fail_closed() {
        let mut search = candidate_plan("root", "projection");
        let search_node: GraphNodeV1 = serde_json::from_value(json!({
            "nodeId":"search", "kind":"search-membership", "edgeName":"matches",
            "authority":authority(1), "parentNodeId":"root", "providerCapabilityId":"search.v1",
            "membershipIdentity":{
                "format":"snapback.graph-search-membership-identity.v1",
                "providerPlanHash":zero_hash(), "argumentContractHash":zero_hash(),
                "scopeContractHash":zero_hash(), "authorityClass":1,
                "providerVersion":"v1", "providerCompletenessClass":"complete-membership-v1",
                "membershipHash":zero_hash()
            },
            "memberField":"id",
            "scopeBindings":[{"providerScopeField":"projectId","source":{"kind":"parent-field","nodeId":"root","field":"projectId"}}],
            "invalidationTables":["issues"],
            "providerCompletenessClass":"complete-membership-v1"
        })).unwrap();
        search.nodes.insert(1, search_node);
        assert!(
            graph_query_plan_faults_v1(&search)
                .iter()
                .any(|fault| fault.reason == GraphAdmissionRefusalReasonV1::SearchUnadmitted)
        );

        let mut class1 = graph_plan_identity_v1(&candidate_plan("root", "projection"))
            .unwrap()
            .normalized_plan;
        class1.broadcast = GraphBroadcastAdmissionV1::Broadcast {
            format: "snapback.graph-broadcast-admission.v1".to_owned(),
            base_node_ids: vec!["n0".to_owned()],
            establishment: GraphBroadcastEstablishmentV1 {
                effect: GraphBroadcastEffectV1::AdmitOnly,
                predicate: TableVisibilityV1::PublicRead,
                overlay_projection: (),
                scope: GraphBroadcastScopeV1 {
                    argument_ids: Vec::new(),
                    policy_identity: Sha256V1::new(zero_hash()).unwrap(),
                    resource_equalities: Vec::new(),
                },
                audience: GraphBroadcastAudienceV1 {
                    strict_evaluator_identity: Sha256V1::new(zero_hash()).unwrap(),
                },
                invalidation: Vec::new(),
            },
        };
        assert_eq!(
            validate_graph_query_plan_v1(&class1),
            Err(GraphAdmissionRefusalReasonV1::BroadcastSeparationUnprovable)
        );

        for node in &mut class1.nodes {
            node.authority_mut().declared_class = GraphAuthorityClassV1::PRINCIPAL_SCOPED;
        }
        class1.authority_partition_rule.class3 = GraphClass3PartitionV1::PartitionOfOne;
        assert_eq!(
            validate_graph_query_plan_v1(&class1),
            Err(GraphAdmissionRefusalReasonV1::BroadcastBaseClassInvalid)
        );
    }

    #[test]
    fn graph_parent_point_requires_complete_non_null_canonical_join_key() {
        assert!(parent_point_lookup_key_is_valid(&[json!("owner-1")], 1));
        for key in [
            Vec::new(),
            vec![Value::Null],
            vec![json!("owner-1"), json!("extra")],
            vec![json!("x".repeat(65_537))],
        ] {
            assert!(!parent_point_lookup_key_is_valid(&key, 1));
        }
    }

    #[test]
    fn graph_query_sibling_arm_is_external_and_support_false() {
        let carrier = graph_plan_identity_v1(&candidate_plan("root", "projection")).unwrap();
        let encoded = serde_json::to_value(HandlerPlan::GraphQuery(carrier.clone())).unwrap();
        assert_eq!(encoded, json!({"GraphQuery": carrier}));
        let decoded: HandlerPlan = serde_json::from_value(encoded).unwrap();
        assert!(matches!(decoded, HandlerPlan::GraphQuery(_)));
        assert_eq!(
            "graph_query_v1".parse::<TargetCapabilityId>(),
            Ok(TargetCapabilityId::GraphQueryV1)
        );
        assert_eq!(
            TargetCapabilityId::GraphQueryV1.maturity(),
            CapabilityMaturity::Experimental
        );
        assert!(
            serde_json::to_value(schemars::schema_for!(HandlerPlan))
                .unwrap()
                .to_string()
                .contains("GraphQuery")
        );
    }

    #[test]
    fn graph_captured_read_v1_round_trips_nullable_and_closed_variants() {
        let common = json!({
            "format":"snapback.graph-captured-read.v1", "graphPlanHash":zero_hash(),
            "instanceHash":zero_hash(), "nodeId":"n0", "nodeKind":"root-window",
            "authorityClass":1
        });
        let variants = vec![
            json!({"kind":"root-range","table":"issues","index":"by_updated","predicate":[],"order":[],"limit":2,"resultCount":0,"boundary":null,"complete":true}),
            json!({"kind":"parent-point","table":"users","index":"by_id","parentKey":{"table":"issues","id":"i1"},"lookupKey":["u1"],"childKey":null,"found":false,"rowVersion":null}),
            json!({"kind":"parent-lookup-skipped","table":"users","index":"by_id","parentKey":{"table":"issues","id":"i1"},"reason":"null-or-omitted-key"}),
            json!({"kind":"parent-range","table":"comments","index":"by_issue","parentKey":{"table":"issues","id":"i1"},"predicate":[],"order":[],"limit":2,"resultCount":0,"boundary":null,"complete":true}),
            json!({"kind":"membership","tables":["votes"],"indexes":["by_issue"],"parentKey":{"table":"issues","id":"i1"},"argumentId":null,"matchedCount":0,"complete":true}),
            json!({"kind":"principal-field","table":"views","index":"by_user","partitionHash":zero_hash(),"field":"userId","valueDigest":zero_hash(),"found":false}),
            json!({"kind":"search-table","table":"issues","membershipIdentity":{"format":"snapback.graph-search-membership-identity.v1","providerPlanHash":zero_hash(),"argumentContractHash":zero_hash(),"scopeContractHash":zero_hash(),"authorityClass":1,"providerVersion":"v1","providerCompletenessClass":"complete-membership-v1","membershipHash":zero_hash()},"providerVersion":"v1"}),
            json!({"kind":"projection","sourceNodeIds":["n0"]}),
        ];
        for dependency in variants {
            let mut record = common.as_object().unwrap().clone();
            record.insert("dependency".to_owned(), dependency);
            let value = Value::Object(record);
            let decoded: GraphCapturedReadV1 =
                serde_json::from_value(value.clone()).expect("capture decodes");
            assert_eq!(serde_json::to_value(decoded).unwrap(), value);
        }
        assert!(
            serde_json::from_value::<GraphCapturedDependencyV1>(json!({
                "kind":"membership", "tables":["votes"], "indexes":["by_issue"],
                "parentKey":{"table":"issues","id":"i1"},
                "matchedCount":0, "complete":true
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<GraphCapturedDependencyV1>(json!({
                "kind":"membership", "tables":["votes"], "indexes":["by_issue"],
                "parentKey":{"table":"issues","id":"i1"}, "argumentId":null,
                "argumentDigest":null, "matchedCount":0, "complete":true
            }))
            .is_err()
        );
    }

    #[test]
    fn graph_completeness_proofs_are_keyed_by_kind_and_label() {
        let value = json!({
            "materializationHash": zero_hash(),
            "partitionHash": zero_hash(),
            "authorizationVersion": {"incarnation":"inc-1","epoch":0},
            "evaluationCut": 0,
            "kind": "root-window",
            "label": "complete",
            "interval": {"lower":{"kind":"unbounded"},"upper":{"kind":"unbounded"}},
            "consumed": 0,
            "hasMore": false,
            "sourceExhausted": true
        });
        let proof: GraphNodeCompletenessProofV1 =
            serde_json::from_value(value.clone()).expect("proof decodes");
        assert_eq!(serde_json::to_value(proof).unwrap(), value);

        let mut wrong_literal = value.clone();
        wrong_literal["sourceExhausted"] = json!(false);
        assert!(serde_json::from_value::<GraphNodeCompletenessProofV1>(wrong_literal).is_err());

        let composition_value = json!({
            "materializationHash": zero_hash(),
            "partitionHash": zero_hash(),
            "authorizationVersion": {"incarnation":"inc-1","epoch":0},
            "evaluationCut": 0,
            "kind": "graph-composition",
            "label": "complete",
            "nodes": [],
            "allComplete": true
        });
        let composition: GraphCompositionProofV1 =
            serde_json::from_value(composition_value.clone()).expect("composition decodes");
        assert_eq!(
            serde_json::to_value(composition).unwrap(),
            composition_value
        );

        let schema = serde_json::to_value(schemars::schema_for!(GraphEvaluationCutV1)).unwrap();
        assert_eq!(schema["type"], "integer");
        assert_eq!(schema["minimum"], 0);
        assert!(schema.get("maximum").is_none());
    }

    #[test]
    fn graph_cost_faults_include_missing_and_malformed_present_records() {
        let mut value = serde_json::to_value(candidate_plan("n0", "n2")).unwrap();
        value["nodes"].as_array_mut().unwrap().insert(
            1,
            json!({
                "nodeId":"n1", "kind":"equality-to-one", "edgeName":"owner",
                "authority":authority(1), "parentNodeId":"n0", "table":"users",
                "visibility":{"kind":"public-read"},
                "joinOn":[{"rootField":"ownerId","joinedField":"id"}],
                "accessIndex":"by_id", "presence":"optional"
            }),
        );
        value["nodes"][2]["object"]["fields"]
            .as_array_mut()
            .unwrap()
            .push(json!({
                "name":"owner",
                "value":{
                    "kind":"object", "nodeId":"n1",
                    "object":{
                        "scopeNodeId":"n0",
                        "fields":[{
                            "name":"name",
                            "value":{"kind":"field","nodeId":"n1","field":"name"}
                        }]
                    }
                }
            }));
        value["queryCost"]["maxScannedRows"] = json!(5);
        value["queryCost"]["maxIndexRanges"] = json!(3);
        value["queryCost"]["graph"]["nodes"][0]["maxWindowScannedRows"] = json!(10);
        value["queryCost"]["graph"]["nodes"][0]["maxWindowIndexRanges"] = json!(6);
        value["queryCost"]["graph"]["nodes"]
            .as_array_mut()
            .unwrap()
            .push(json!({
                "nodeId":"n1",
                "maxExaminedEntriesPerExecution":2,
                "maxRelationshipLookupsPerExecution":2
            }));
        value["queryCost"]["graph"]["windowRollup"]["maxWindowScannedRows"] = json!(10);
        value["queryCost"]["graph"]["windowRollup"]["maxWindowIndexRanges"] = json!(6);

        let mut plan: GraphQueryPlanV1 = serde_json::from_value(value).unwrap();
        assert_eq!(validate_graph_query_plan_v1(&plan), Ok(()));

        plan.query_cost.graph.nodes.remove(1);
        plan.query_cost.graph.nodes[0].max_examined_entries_per_execution = 4;
        let faults = graph_query_plan_faults_v1(&plan);
        assert!(faults.contains(&GraphAdmissionFaultV1::from(
            GraphAdmissionRefusalReasonV1::UnboundedExpansion
        )));
        assert!(faults.contains(&GraphAdmissionFaultV1::from(
            GraphAdmissionRefusalReasonV1::BoundInvalid
        )));
        assert_eq!(
            validate_graph_query_plan_v1(&plan),
            Err(GraphAdmissionRefusalReasonV1::UnboundedExpansion)
        );
    }

    #[test]
    fn graph_codegen_parity_corpus_v1_matches_rank_zero_admission() {
        fn descend_mut<'a>(mut value: &'a mut Value, path: &[Value]) -> &'a mut Value {
            for segment in path {
                value = if let Some(field) = segment.as_str() {
                    value
                        .get_mut(field)
                        .unwrap_or_else(|| panic!("missing object path segment {field}"))
                } else {
                    let index = segment
                        .as_u64()
                        .and_then(|index| usize::try_from(index).ok())
                        .expect("array path segment is a non-negative index");
                    value
                        .get_mut(index)
                        .unwrap_or_else(|| panic!("missing array path segment {index}"))
                };
            }
            value
        }

        fn set_path(root: &mut Value, path: &[Value], value: Value) {
            let (last, parent_path) = path.split_last().expect("set path is non-empty");
            let parent = descend_mut(root, parent_path);
            if let Some(field) = last.as_str() {
                parent
                    .as_object_mut()
                    .expect("set parent is an object")
                    .insert(field.to_owned(), value);
            } else {
                let index = last
                    .as_u64()
                    .and_then(|index| usize::try_from(index).ok())
                    .expect("set array path segment is a non-negative index");
                parent.as_array_mut().expect("set parent is an array")[index] = value;
            }
        }

        fn remove_path(root: &mut Value, path: &[Value]) {
            let (last, parent_path) = path.split_last().expect("remove path is non-empty");
            let parent = descend_mut(root, parent_path);
            if let Some(field) = last.as_str() {
                parent
                    .as_object_mut()
                    .expect("remove parent is an object")
                    .remove(field);
            } else {
                let index = last
                    .as_u64()
                    .and_then(|index| usize::try_from(index).ok())
                    .expect("remove array path segment is a non-negative index");
                parent
                    .as_array_mut()
                    .expect("remove parent is an array")
                    .remove(index);
            }
        }

        let corpus: Value = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../tests/conformance/graph/codegen-parity-corpus.v1.json"
        )))
        .expect("graph codegen parity corpus decodes");
        let base: Value = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../tests/conformance/graph/minimal-carrier.v1.json"
        )))
        .expect("minimal graph carrier decodes");
        for case in corpus["cases"]
            .as_array()
            .expect("parity cases are an array")
        {
            if case["jsOnly"].as_bool() == Some(true) {
                continue;
            }
            let name = case["name"].as_str().expect("parity case has a name");
            let mut plan = base["normalizedPlan"].clone();
            for mutation in case["set"].as_array().into_iter().flatten() {
                set_path(
                    &mut plan,
                    mutation["path"]
                        .as_array()
                        .expect("set mutation has a path"),
                    mutation["value"].clone(),
                );
            }
            for path in case["remove"].as_array().into_iter().flatten() {
                remove_path(
                    &mut plan,
                    path.as_array().expect("remove mutation has a path"),
                );
            }

            let (actual_outcome, actual_reason) =
                match serde_json::from_value::<GraphQueryPlanV1>(plan) {
                    Ok(plan) => match validate_graph_query_plan_v1(&plan) {
                        Ok(()) => ("accept", None),
                        Err(reason) => ("refuse", Some(reason.code())),
                    },
                    Err(error) => {
                        assert!(
                            error.to_string().contains("unknown field"),
                            "{name}: unexpected manifest-deserialization error: {error}"
                        );
                        (
                            "refuse",
                            Some(GraphAdmissionRefusalReasonV1::UnknownField.code()),
                        )
                    }
                };
            assert_eq!(
                actual_outcome,
                case["expected"]["outcome"]
                    .as_str()
                    .expect("expected outcome is a string"),
                "{name}: outcome"
            );
            assert_eq!(
                actual_reason,
                case["expected"]["reason"].as_str(),
                "{name}: reason"
            );
        }
    }

    #[test]
    fn graph_admission_refusal_register_is_closed_and_ordered() {
        let codes = [
            GraphAdmissionRefusalReasonV1::ClientAstForbidden,
            GraphAdmissionRefusalReasonV1::CodeForbidden,
            GraphAdmissionRefusalReasonV1::RecursionForbidden,
            GraphAdmissionRefusalReasonV1::DynamicConstruction,
            GraphAdmissionRefusalReasonV1::RootCountInvalid,
            GraphAdmissionRefusalReasonV1::ProjectionCountInvalid,
            GraphAdmissionRefusalReasonV1::NodeKindUnsupported,
            GraphAdmissionRefusalReasonV1::UnknownField,
            GraphAdmissionRefusalReasonV1::ParentInvalid,
            GraphAdmissionRefusalReasonV1::NodeInert,
            GraphAdmissionRefusalReasonV1::Cycle,
            GraphAdmissionRefusalReasonV1::UnboundedExpansion,
            GraphAdmissionRefusalReasonV1::ThroughTableUndeclared,
            GraphAdmissionRefusalReasonV1::SchemaReferenceInvalid,
            GraphAdmissionRefusalReasonV1::IndexUnprovable,
            GraphAdmissionRefusalReasonV1::IndexPrefixUnsupported,
            GraphAdmissionRefusalReasonV1::OrderNotTotal,
            GraphAdmissionRefusalReasonV1::ProjectionScopeInvalid,
            GraphAdmissionRefusalReasonV1::ProjectionOpen,
            GraphAdmissionRefusalReasonV1::PrincipalBindingUnprovable,
            GraphAdmissionRefusalReasonV1::SearchUnadmitted,
            GraphAdmissionRefusalReasonV1::AuthorityUnprovable,
            GraphAdmissionRefusalReasonV1::BroadcastBaseClassInvalid,
            GraphAdmissionRefusalReasonV1::BroadcastSeparationUnprovable,
            GraphAdmissionRefusalReasonV1::BroadcastScopeUnbound,
            GraphAdmissionRefusalReasonV1::BroadcastAudienceUnprovable,
            GraphAdmissionRefusalReasonV1::BroadcastInvalidationIncomplete,
            GraphAdmissionRefusalReasonV1::BoundInvalid,
            GraphAdmissionRefusalReasonV1::ResultContractMismatch,
            GraphAdmissionRefusalReasonV1::PlanIdentityMismatch,
            GraphAdmissionRefusalReasonV1::ArgumentUnbound,
        ];
        assert_eq!(codes.len(), 31);
        for code in codes {
            let encoded = serde_json::to_value(code).unwrap();
            assert_eq!(encoded, Value::String(code.code().to_owned()));
            assert_eq!(
                serde_json::from_value::<GraphAdmissionRefusalReasonV1>(encoded).unwrap(),
                code
            );
        }
    }
}
