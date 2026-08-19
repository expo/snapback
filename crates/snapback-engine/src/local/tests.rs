use super::*;
use super::{
    ASSET_RECORD_LIVE_FUNCTION, AssetFinalizeCrashPoint, AuthorizationBlastRadiusStats,
    AuthorizationInvalidationAckInput, AuthorizationInvalidationManualRetryInput,
    BEFORE_ACTION_RESULT_HANDOFF_HOOK, BEFORE_CONFIG_VERIFY_PUBLICATION_HOOK,
    BEFORE_MUTATION_POSTCOMMIT_HOOK, BEFORE_QUERY_RESULT_HANDOFF_HOOK, DetachedIbexMutation,
    DetachedMutationRead, DiagnosticBoundary, EnsureAppMode, FAIL_NEXT_ADDITIONAL_JOB_ADMISSION,
    FAIL_NEXT_LIVE_SCOPE_REGISTRATION, FAIL_NEXT_SCOPE_RETIREMENT_AUTH, FinalizePhaseAOutcomeV1,
    FinalizePreflightV1, INJECT_NEXT_PUBLICATION_WARNING, LiveInvalidationAdmission,
    LiveResumeInput, LiveSubscribeInput, LiveUnsubscribeInput, LocalSnapback,
    MAX_LIVE_SUBSCRIPTIONS, MAX_LIVE_SUBSCRIPTIONS_PER_CONNECTION, MY_MEMBERSHIPS_LIVE_FUNCTION,
    MaintenanceOperation, MutationDependencyCapture, PendingLiveFanout, PendingLiveLane,
    PendingLiveScheduler, PendingLiveWork, PublicInspect, QueryInvocation, RetryEpisodeKey,
    RetryReservationKind, SEARCH_ANALYZER, SEARCH_CAPABILITY, SEARCH_PARSER, SearchFieldClassV1,
    SearchIndexManifestV1, SearchQueryPlanV1, SearchTextFieldV1, SearchVisibilityV1, SnapbackError,
    SnapbackResult, StagedMutationExecution, StagedNestedMutation, StagedRecordedMutation,
    bounded_projection_result_contract, enforce_snapshot_batch_cursor_budget,
    next_secret_read_reset_generation, now_millis, order_field_bounds_from_functions,
    prepare_media_command_invocation, query_invocation_estimated_bytes, reserve_unique_generation,
    settlement_id_map, snapshot_batch_max_boundary, snapshot_batch_max_plaintext_len,
    telemetry_correlation, validate_bounded_children_node_schema_references,
    validate_bounded_children_schema_plan, validate_function_schema_references,
};
use crate::auth::admission::AdmissionController;
use crate::auth::crypto::{CryptoError, RandomSource};
use crate::auth::invalidation::{
    AuthorizationInvalidationConnection, InvalidationDisposition, LiveInvalidationIssuer,
    QueryNamespace, ResolutionKind, ScopeId,
};
use crate::auth::invocation::{
    InvocationGate, InvocationSource, PreparedAuthority, PreparedInvocation, ResolvedAppAuthority,
    ResolvedGrantScope, WireAuthorityFields,
};
use crate::auth::mode::{
    AuthModeStateRecord, AuthProgramReadiness, DeploymentIdentity, FUNCTION_V1_PREFIX,
    INPUTS_V1_PREFIX, SCHEMA_V1_PREFIX, STARTUP_ARTIFACT_FORMAT_VERSION, StartupArtifacts,
};
use crate::contract_types::ServerProfile;
use crate::live_wire::{Receipt, SettlementIdMapDisposition};
use crate::manifest::{
    ActionPlan, ActionStep, ArtifactGeneration, AuthInput, AuthManifest, AuthMode, AuthRequirement,
    AuthorityDescriptor, BoundedSkewDeclaration, CapabilityManifest, ConfigEntryDefinition,
    CronActivationPolicy, CronJitterPolicy, CronJobDefinition, CronOverlapPolicy, CronRetryMode,
    CronRetryPolicy, CronSchedule, CtxAnswerLedger, FieldManifest, FieldType, FilterExpr, FilterOp,
    FunctionArgsContract, FunctionDefinition, FunctionKind, FunctionManifest,
    FunctionResultContract, FunctionRuntime, HandlerInput, HandlerPlan, IbexModule, IndexManifest,
    MembershipManifest, MembershipPredicate, MembershipResourceRef, MembershipScope,
    MutationOutput, MutationPlan, MutationSettlement, MutationStep, OwnerWriteAbsentDispositionV1,
    OwnerWriteCheckV1, PermissionScopeExpr, QueryOutput, QueryPlan, ResultObjectFieldContract,
    ResultValueContract, ReturnValue, SchemaManifest, SchemaRefAuthority, SeedData,
    SettlementClaimSet, SettlementIdentityClaims, SettlementLane, SettlementMintClaim,
    SettlementMintObservation, SnapshotBatchPlanV1, TableManifest, TableVisibilityV1, ValueExpr,
    ctx_ledger_version,
};
use crate::runtime::{
    ExecutedIbexMutation, MediaProjectionClientMutationIdentityV1,
    MediaProjectionInvocationScopeV1, StagedMediaProjectionProofV1,
};
use crate::storage::auth_grants::{ExactGrantScope, ScopedFunctionKind};
use crate::storage::{
    BufferedWrite, CapturedReadDependency, CapturedReadKind, DbRead, MutationCommit,
};
use crate::vector::{
    VECTOR_CAPABILITY, VECTOR_DISTANCE_PROFILE_ID, VECTOR_ORDERING_PROFILE_ID,
    VECTOR_RESULT_PROJECTION, VectorFieldClassV1, VectorIndexManifestV1, VectorMaintenanceLimitsV1,
    VectorMetricV1, VectorQueryPlanV1, VectorTieBreakV1, VectorVisibilityV1,
};
use crate::visibility_governance::VisibilityGovernanceActivationV1;
use serde_json::{Map, Value, json};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU8, AtomicU64, Ordering};
use std::time::{Duration, Instant};

// This fixture genuinely spans the activation reopen/reload envelope and the
// engine tests, so it remains in their test parent rather than being duplicated.
fn reload_schema(hash: &str, include_extra: bool) -> SchemaManifest {
    let fields = vec![FieldManifest {
        name: "value".to_owned(),
        field_type: FieldType::String,
        optional: false,
    }];
    let mut tables = vec![TableManifest {
        name: "items".to_owned(),
        fields,
        indexes: Vec::new(),
        syncable: true,
        permission_backing: false,
        permission_fields: None,
        search_indexes: Vec::new(),
        vector_indexes: Vec::new(),
        search_live_limits: None,
        membership: None,
        authority_profile: None,
        asset_sharing: None,
        visibility: Some(crate::manifest::TableVisibilityV1::PublicRead),
        history: None,
    }];
    if include_extra {
        tables.push(TableManifest {
            name: "new_items".to_owned(),
            fields: vec![FieldManifest {
                name: "extra".to_owned(),
                field_type: FieldType::Boolean,
                optional: true,
            }],
            indexes: Vec::new(),
            syncable: true,
            permission_backing: false,
            permission_fields: None,
            search_indexes: Vec::new(),
            vector_indexes: Vec::new(),
            search_live_limits: None,
            membership: None,
            authority_profile: None,
            asset_sharing: None,
            visibility: Some(crate::manifest::TableVisibilityV1::PublicRead),
            history: None,
        });
    }
    SchemaManifest {
        schema_hash: Some(hash.to_owned()),
        tables,
        ..SchemaManifest::default()
    }
}

#[path = "tests/engine.rs"]
mod engine;
#[path = "tests/generation_activation.rs"]
mod generation_activation;

pub(crate) use engine::*;
