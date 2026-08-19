//! Server compatibility namespace for engine-owned manifest behavior.

pub use snapback_engine::manifest::*;
pub use snapback_services::manifest::SchemaManifestValidationExt;
pub use snapback_types::contract_types::{
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
pub use snapback_types::manifest::*;
pub use snapback_types::search::types::{
    FullTextSearchFactsV1, SearchClauseV1, SearchCursorLimitsV1, SearchCursorV1,
    SearchFieldClassV1, SearchFilterV1, SearchHighlightV1, SearchIndexManifestV1, SearchItemV1,
    SearchLiveLimitsV1, SearchMaintenanceLimitsV1, SearchMatchAtomV1, SearchMatchRangeV1,
    SearchPageV1, SearchPhraseV1, SearchQueryAstV1, SearchQueryLimitsV1, SearchQueryPlanV1,
    SearchRequestV1, SearchSourceLimitsV1, SearchTermV1, SearchTextFieldV1, SearchVisibilityV1,
};
pub use snapback_types::vector::types::{
    VectorFieldClassV1, VectorFilterOpV1, VectorFilterV1, VectorFilterValueV1,
    VectorIndexManifestV1, VectorItemV1, VectorMaintenanceLimitsV1, VectorMetricV1, VectorPageV1,
    VectorQueryPlanV1, VectorRequestV1, VectorSearchFactsV1, VectorTieBreakV1, VectorVisibilityV1,
};
