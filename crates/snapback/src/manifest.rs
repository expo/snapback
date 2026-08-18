use crate::diagnostic::{SnapbackError, SnapbackResult};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::ffi::OsStr;
use std::sync::OnceLock;

pub use crate::contract_types::{
    AgentsManifest, AgentsMode, ApiAskBilling, ApiAskBudgets, ApiAskManifest, ApiAskModelManifest,
    ApiAskPerPrincipalDayBudget, ApiAskPerRequestBudget, ApiAskResultVolumeBudget,
    ApiAskTokenBudget, ApiBudgetsManifest, ApiDisclosure, ApiFunctionApproval, ApiFunctionExposure,
    ApiManifest, ApiOAuthBundle, ApiOAuthManifest, AppIdentity, AssetCollectionMutationPlanV1,
    AssetCollectionOperationV1, AuthManifest, AuthMode, AuthPasswordIdentifierMode,
    AuthRequirement, BoundedParentVisibility, BoundedProjectionField, DependencySummary,
    EffectCeiling, EffectCeilingRead, EffectCeilingWrite, FieldManifest, FieldType,
    FunctionArgsContract, FunctionKind, FunctionResultContract, IbexModule, IndexManifest,
    InvitedBy, JoinEquality, JoinKind, MediaKindV1, PermissionScopeExpr, ProjectionLeaf,
    ProjectionOutputKey, ProjectionSource, ProjectionVisibility, ResultObjectFieldContract,
    ResultRowsBound, ResultValueContract, STORED_STRUCTURED_CONTRACT_VERSION_V1,
    STORED_STRUCTURED_ENCODING_V1, SchemaRefAuthority, SequenceDeclaration,
    SequenceExistingOwnerAccess, SequenceScopeAccess, SourceSpan, StandardPatternIdentity,
    StandardPatternMembershipIdentity, StoredStructuredContractV1, WriteActivityProvenanceFields,
    WriteActivityRelation, WriteWithActivityEffectFormula, WriteWithActivityMode,
    WriteWithActivitySourceOperation,
};
pub use crate::search::types::{
    FullTextSearchFactsV1, SearchClauseV1, SearchCursorLimitsV1, SearchCursorV1,
    SearchFieldClassV1, SearchFilterV1, SearchHighlightV1, SearchIndexManifestV1, SearchItemV1,
    SearchLiveLimitsV1, SearchMaintenanceLimitsV1, SearchMatchAtomV1, SearchMatchRangeV1,
    SearchPageV1, SearchPhraseV1, SearchQueryAstV1, SearchQueryLimitsV1, SearchQueryPlanV1,
    SearchRequestV1, SearchSourceLimitsV1, SearchTermV1, SearchTextFieldV1, SearchVisibilityV1,
};
pub use crate::vector::types::{
    VectorFieldClassV1, VectorFilterOpV1, VectorFilterV1, VectorFilterValueV1,
    VectorIndexManifestV1, VectorItemV1, VectorMaintenanceLimitsV1, VectorMetricV1, VectorPageV1,
    VectorQueryPlanV1, VectorRequestV1, VectorSearchFactsV1, VectorTieBreakV1, VectorVisibilityV1,
};

// @ref LLP 0276#the-target-layout — owner-aligned manifest modules retain
// the legacy manifest surface through parent re-exports.
mod capabilities;
#[cfg(test)]
mod types_remainder_tests;

pub use capabilities::*;
pub use snapback_services::manifest::SchemaManifestValidationExt;
pub(crate) use snapback_services::manifest::ExpoPushSeamFactsLocalExt;
pub use snapback_types::manifest::*;

use snapback_types::manifest::{
    capability_manifest_kind, sha256_is_well_formed_nonzero, sha256_prefixed,
    snapback_schema_version, validate_artifact_header, validate_known_v1_capabilities,
};

fn unsupported_capability_error(
    capability: &str,
    message: impl Into<String>,
) -> SnapbackError {
    snapback_types::manifest::unsupported_capability_error(capability, message).into()
}

fn vector_manifest_invalid(message: impl Into<String>) -> SnapbackError {
    snapback_types::manifest::vector_manifest_invalid(message).into()
}
