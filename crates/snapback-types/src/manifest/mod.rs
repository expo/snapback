use crate::auth::invocation::FunctionAttribution;
use crate::diagnostic::{Diagnostic, PublicDiagnostic, SnapbackError, SnapbackResult};
use crate::ephemeral::EphemeralCollection;
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::str::FromStr;

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

mod capability_registry;
mod identity;
mod types;
mod vector;

pub use types::*;
pub use vector::*;
pub use capability_registry::*;
pub use identity::*;

#[doc(hidden)]
pub fn capability_manifest_kind() -> String {
    "capabilityManifest".to_owned()
}

#[doc(hidden)]
pub fn snapback_schema_version() -> String {
    SNAPBACK_SCHEMA_VERSION.to_owned()
}

#[doc(hidden)]
pub fn sha256_prefixed(bytes: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(bytes))
}

#[doc(hidden)]
pub fn sha256_is_well_formed_nonzero(value: &str) -> bool {
    value.len() == 71
        && value.starts_with("sha256:")
        && value[7..].bytes().all(|byte| byte.is_ascii_hexdigit())
        && value[7..].bytes().any(|byte| byte != b'0')
}

#[doc(hidden)]
pub fn unsupported_capability_error(
    capability: &str,
    message: impl Into<String>,
) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_CAPABILITY_UNSUPPORTED",
        "capability",
        message.into(),
    )
    .with_details(serde_json::json!({ "capability": capability }))
}

#[doc(hidden)]
pub fn validate_known_v1_capabilities<'a>(
    required: impl IntoIterator<Item = &'a str>,
) -> SnapbackResult<()> {
    for capability in required {
        capability.parse::<TargetCapabilityId>().map_err(|()| {
            unsupported_capability_error(
                capability,
                format!("unknown required target capability {capability}"),
            )
        })?;
    }
    Ok(())
}

#[doc(hidden)]
pub fn vector_manifest_invalid(message: impl Into<String>) -> SnapbackError {
    SnapbackError::error("SNAPBACK_VECTOR_INDEX_INVALID", "vector", message)
}

#[doc(hidden)]
pub fn validate_artifact_header(
    subsystem: &str,
    expected_kind: &str,
    artifact_kind: &str,
    schema_version: &str,
    content_hash: Option<&str>,
    inputs_hash: Option<&str>,
) -> SnapbackResult<()> {
    if artifact_kind != expected_kind {
        return Err(SnapbackError::error(
            format!(
                "SNAPBACK_STALE_{}_ARTIFACT_KIND",
                subsystem.to_ascii_uppercase()
            ),
            subsystem,
            format!("expected {expected_kind} artifact but received {artifact_kind}"),
        )
        .with_artifact_details(
            expected_kind,
            artifact_kind,
            schema_version,
            content_hash,
            inputs_hash,
        ));
    }

    if !matches!(
        schema_version,
        SNAPBACK_SCHEMA_VERSION | SNAPBACK_SESSIONS_SCHEMA_VERSION
    ) {
        return Err(SnapbackError::error(
            format!(
                "SNAPBACK_STALE_{}_ARTIFACT_VERSION",
                subsystem.to_ascii_uppercase()
            ),
            subsystem,
            format!("unsupported {expected_kind} schema version {schema_version}"),
        )
        .with_artifact_details(
            expected_kind,
            artifact_kind,
            schema_version,
            content_hash,
            inputs_hash,
        ));
    }

    Ok(())
}

trait ArtifactDiagnosticExt {
    fn with_artifact_details(
        self,
        expected_kind: &str,
        artifact_kind: &str,
        schema_version: &str,
        content_hash: Option<&str>,
        inputs_hash: Option<&str>,
    ) -> Self;
}

impl ArtifactDiagnosticExt for SnapbackError {
    fn with_artifact_details(
        mut self,
        expected_kind: &str,
        artifact_kind: &str,
        schema_version: &str,
        content_hash: Option<&str>,
        inputs_hash: Option<&str>,
    ) -> Self {
        self.diagnostic.details = serde_json::json!({
            "expectedArtifactKind": expected_kind,
            "artifactKind": artifact_kind,
            "expectedSchemaVersion": SNAPBACK_SCHEMA_VERSION,
            "supportedSchemaVersions": [SNAPBACK_SCHEMA_VERSION, SNAPBACK_SESSIONS_SCHEMA_VERSION],
            "schemaVersion": schema_version,
            "contentHash": content_hash,
            "inputsHash": inputs_hash,
        });
        self
    }
}
