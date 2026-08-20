//! Schema registrations for carriers defined by the contract leaf.
//!
//! Each workspace owner registers the schemas for carriers it defines. The
//! rank-7 tooling crate only concatenates those downward-owned registries.
//!
//! @ref LLP 0037#decision-ratified-2026-07-02 — Rust serde types remain the
//!   single source of truth for generated, committed JSON Schemas.
//! @ref LLP 0283#f-5--named-exceptions-with-burn-down-tickets — registrations
//!   live with their carrier owner so rank-7 tooling can assemble downward.

use serde_json::Value;

use crate::auth::handshake::AuthSessionResponse;
use crate::auth::rehearsal::{
    AuthRehearsalGrantV1, AuthRehearsalLogicalExportArtifactV1, AuthRehearsalReachabilityV1,
    AuthRehearsalStoreMarkersV1, AuthRehearsalWindowV1, RehearsalExerciseRequestV1,
    RehearsalMintRequestV1, RehearsalMintResultV1, RehearsalRevokeRequestV1,
    RehearsalStatusRequestV1,
};
use crate::auth::wire::{
    CredentialResponse, EmptyAuthRequest, ExchangeRequest, FamilyAlarmResponse, MailboxQuery,
    MailboxResponse, MintSessionRequest, PasswordAttemptAdminRequest, PasswordAttemptAdminResponse,
    PasswordChangeRequest, PasswordCredentialRequest, PasswordResetRequest, PasswordUnlockRequest,
    PasswordUnlockResponse, RecoveryConsumeRequest, RequestCodeRequest, RequestCodeResponse,
    RescueCollidingTableRequest,
};
use crate::commit_envelope::{
    ClientIdentityRangeV1, CommitEnvelopeV1, IdentityEpochV1, OperationCoverageActivationRequestV1,
    OperationCoverageActivationResponseV1, OperationCoverageManifestV1,
    OperationExplanationRequestV1, OperationExplanationResponseV1, OperationExplanationV1,
    OperationIdentityRangeRequestV1, OperationIdentityRangeResponseV1,
    OperationIdentityTombstoneV1, OperationIdentityV1, OperationSuppressionRecordV1,
    PendingOperationLifecycleV1, PendingOperationTerminalSupplementV1,
};
use crate::diagnostic::Diagnostic;
use crate::ephemeral::{
    DeleteRequest, EphemeralMessage, PublishRequest, RealtimeEnvelope, SubscribeRequest,
};
use crate::handler_wire::{HandlerHostCallRequest, HandlerInvokeRequest, HandlerInvokeResponse};
use crate::host_ops_contract::{
    DryRunReport, HostOpsResult, HostReadyDescriptor, ManagedBranchCreateHostInputV1,
    ManagedBranchExecuteHostInputV1, ManagedBranchIdHostInputV1, ManagedBranchListHostInputV1,
};
use crate::live_wire::{
    KitSocketReplyFrame, KitSocketRequestFrame, LiveEnvelope, LiveSocketClientMessage,
    LiveSocketServerFrame, OutboxDrainOutput, Receipt, ResumeWire,
};
use crate::manifest::{
    CapabilityManifest, FiniteQueryOutput, FiniteQueryRequest, FunctionCallRequest,
    FunctionManifest, FunctionResponse, MutationAcknowledgementRequest,
    MutationAcknowledgementResponse, MutationRequest, SNAPBACK_SCHEMA_VERSION, SchemaManifest,
};
use crate::remediation::{
    REMEDIATION_APPLY_SCHEMA_VERSION, REMEDIATION_FIXTURE_FORMAT_VERSION,
    REMEDIATION_KIND_REGISTRY_VERSION, REMEDIATION_SET_MAX_ITEMS, REMEDIATION_SET_SCHEMA_VERSION,
    RemediationApplyInputV1, RemediationApplyResultV1, RemediationFixtureCorpusV1,
    RemediationSetV1,
};
use crate::result_transform::{ResultTransformCorpusCaseV1, ResultTransformCorpusManifestV1};
use crate::service_profile::{
    RemoteAuthCapabilityManifest, RemoteDataCapabilityManifest, RemoteServiceProfile,
};

/// One generated schema or public artifact instance.
pub struct SchemaArtifact {
    pub file: &'static str,
    pub schema: Value,
}

/// Schema artifacts whose generator lives outside Rust's schema registry.
pub const EXTERNALLY_MANAGED_SCHEMA_ARTIFACTS: &[&str] = &[
    "../../../packages/snapback-codegen/handler-typescript-profile.schema.json",
    "normalized-definition.v1.schema.json",
    "cloudflare.deploy-receipt-v1.schema.json",
    "control-catalog-instance.v1.schema.json",
    "control-catalog.v1.schema.json",
    "remediation-kinds.v1.schema.json",
];

/// Derive, version-stamp, and canonicalize one Rust-owned JSON Schema.
pub fn finish(file: &'static str, schema: impl serde::Serialize) -> SchemaArtifact {
    let mut value = serde_json::to_value(&schema).expect("derived schema serializes to JSON");
    stamp_schema_version(&mut value, file);
    SchemaArtifact {
        file,
        schema: sorted_keys(value),
    }
}

/// Derive a schema for an owner-local carrier without requiring that owner to
/// invoke an item-producing macro in its source tree.
pub fn finish_type<T: schemars::JsonSchema>(file: &'static str) -> SchemaArtifact {
    finish(file, schemars::schema_for!(T))
}

/// Canonicalize one generated public artifact instance.
pub fn instance(file: &'static str, value: Value) -> SchemaArtifact {
    SchemaArtifact {
        file,
        schema: sorted_keys(value),
    }
}

/// Schemas for carriers whose defining authority is `snapback-types`.
pub fn schema_registrations() -> Vec<SchemaArtifact> {
    let mut artifacts = vec![
        finish(
            "schema.manifest.schema.json",
            schemars::schema_for!(SchemaManifest),
        ),
        finish(
            "functions.manifest.schema.json",
            schemars::schema_for!(FunctionManifest),
        ),
        finish(
            "result-transform-v1.corpus.schema.json",
            schemars::schema_for!(ResultTransformCorpusManifestV1),
        ),
        finish(
            "result-transform-v1.case.schema.json",
            schemars::schema_for!(ResultTransformCorpusCaseV1),
        ),
        finish(
            "capability.manifest.schema.json",
            schemars::schema_for!(CapabilityManifest),
        ),
        finish(
            "operation.identity-v1.schema.json",
            schemars::schema_for!(OperationIdentityV1),
        ),
        finish(
            "commit.envelope-v1.schema.json",
            schemars::schema_for!(CommitEnvelopeV1),
        ),
        finish(
            "operation.identity-range-v1.schema.json",
            schemars::schema_for!(ClientIdentityRangeV1),
        ),
        finish(
            "operation.identity-range-request-v1.schema.json",
            schemars::schema_for!(OperationIdentityRangeRequestV1),
        ),
        finish(
            "operation.identity-range-response-v1.schema.json",
            schemars::schema_for!(OperationIdentityRangeResponseV1),
        ),
        finish(
            "operation.coverage-activation-request-v1.schema.json",
            schemars::schema_for!(OperationCoverageActivationRequestV1),
        ),
        finish(
            "operation.coverage-activation-response-v1.schema.json",
            schemars::schema_for!(OperationCoverageActivationResponseV1),
        ),
        finish(
            "operation.identity-epoch-v1.schema.json",
            schemars::schema_for!(IdentityEpochV1),
        ),
        finish(
            "operation.suppression-v1.schema.json",
            schemars::schema_for!(OperationSuppressionRecordV1),
        ),
        finish(
            "operation.pending-lifecycle-v1.schema.json",
            schemars::schema_for!(PendingOperationLifecycleV1),
        ),
        finish(
            "operation.pending-terminal-supplement-v1.schema.json",
            schemars::schema_for!(PendingOperationTerminalSupplementV1),
        ),
        finish(
            "operation.identity-tombstone-v1.schema.json",
            schemars::schema_for!(OperationIdentityTombstoneV1),
        ),
        finish(
            "operation.explanation-v1.schema.json",
            schemars::schema_for!(OperationExplanationV1),
        ),
        finish(
            "operation.explanation-request-v1.schema.json",
            schemars::schema_for!(OperationExplanationRequestV1),
        ),
        finish(
            "operation.explanation-response-v1.schema.json",
            schemars::schema_for!(OperationExplanationResponseV1),
        ),
        finish(
            "operation.coverage-manifest-v1.schema.json",
            schemars::schema_for!(OperationCoverageManifestV1),
        ),
        finish(
            "branch.host-create-input-v1.schema.json",
            schemars::schema_for!(ManagedBranchCreateHostInputV1),
        ),
        finish(
            "branch.host-execute-input-v1.schema.json",
            schemars::schema_for!(ManagedBranchExecuteHostInputV1),
        ),
        finish(
            "branch.host-list-input-v1.schema.json",
            schemars::schema_for!(ManagedBranchListHostInputV1),
        ),
        finish(
            "branch.host-id-input-v1.schema.json",
            schemars::schema_for!(ManagedBranchIdHostInputV1),
        ),
        finish(
            "search.request.schema.json",
            schemars::schema_for!(crate::search::types::SearchRequestV1),
        ),
        finish(
            "vector.request.schema.json",
            schemars::schema_for!(crate::vector::VectorRequestV1),
        ),
        finish(
            "vector.item.schema.json",
            schemars::schema_for!(crate::vector::VectorItemV1),
        ),
        finish(
            "vector.page.schema.json",
            schemars::schema_for!(crate::vector::VectorPageV1),
        ),
        finish(
            "auth.hosted-capabilities.schema.json",
            schemars::schema_for!(crate::auth::deployment::HostedAuthCapabilities),
        ),
        finish(
            "hosted-admission-v2.schema.json",
            schemars::schema_for!(crate::auth::deployment::HostedAdmissionV2),
        ),
        finish(
            "remote-service.profile.schema.json",
            schemars::schema_for!(RemoteServiceProfile),
        ),
        finish(
            "remote-service.auth-capability.manifest.schema.json",
            schemars::schema_for!(RemoteAuthCapabilityManifest),
        ),
        finish(
            "remote-service.data-capability.manifest.schema.json",
            schemars::schema_for!(RemoteDataCapabilityManifest),
        ),
        finish("diagnostic.schema.json", schemars::schema_for!(Diagnostic)),
        finish_remediation_set(
            "remediation-set.v1.schema.json",
            schemars::schema_for!(RemediationSetV1),
        ),
        finish_remediation_apply(
            "remediation-apply.input.v1.schema.json",
            schemars::schema_for!(RemediationApplyInputV1),
        ),
        finish_remediation_apply(
            "remediation-apply.result.v1.schema.json",
            schemars::schema_for!(RemediationApplyResultV1),
        ),
        finish_remediation_fixtures(
            "remediation-fixtures.v1.schema.json",
            schemars::schema_for!(RemediationFixtureCorpusV1),
        ),
        finish(
            "host-ops.result.schema.json",
            schemars::schema_for!(HostOpsResult),
        ),
        finish(
            "host-ready.schema.json",
            schemars::schema_for!(HostReadyDescriptor),
        ),
        finish(
            "dry-run.report.schema.json",
            schemars::schema_for!(DryRunReport),
        ),
        finish(
            "live.envelope.schema.json",
            schemars::schema_for!(LiveEnvelope),
        ),
        finish(
            "live.socket-server.schema.json",
            schemars::schema_for!(LiveSocketServerFrame),
        ),
        finish(
            "live.socket-client.schema.json",
            schemars::schema_for!(LiveSocketClientMessage),
        ),
        finish("receipt.schema.json", schemars::schema_for!(Receipt)),
        finish(
            "realtime.envelope.schema.json",
            schemars::schema_for!(RealtimeEnvelope),
        ),
        finish(
            "auth.request-code.input.schema.json",
            schemars::schema_for!(RequestCodeRequest),
        ),
        finish(
            "auth.session.output.schema.json",
            schemars::schema_for!(AuthSessionResponse),
        ),
        finish(
            "auth.request-code.output.schema.json",
            schemars::schema_for!(RequestCodeResponse),
        ),
        finish(
            "auth.exchange.input.schema.json",
            schemars::schema_for!(ExchangeRequest),
        ),
        finish(
            "auth.password-credential.input.schema.json",
            schemars::schema_for!(PasswordCredentialRequest),
        ),
        finish(
            "auth.password-change.input.schema.json",
            schemars::schema_for!(PasswordChangeRequest),
        ),
        finish(
            "auth.password-reset.input.schema.json",
            schemars::schema_for!(PasswordResetRequest),
        ),
        finish(
            "auth.recovery-consume.input.schema.json",
            schemars::schema_for!(RecoveryConsumeRequest),
        ),
        finish(
            "auth.password-unlock.input.schema.json",
            schemars::schema_for!(PasswordUnlockRequest),
        ),
        finish(
            "auth.password-unlock.output.schema.json",
            schemars::schema_for!(PasswordUnlockResponse),
        ),
        finish(
            "auth.password-attempt-admin.input.schema.json",
            schemars::schema_for!(PasswordAttemptAdminRequest),
        ),
        finish(
            "auth.password-attempt-admin.output.schema.json",
            schemars::schema_for!(PasswordAttemptAdminResponse),
        ),
        finish(
            "auth.credential.output.schema.json",
            schemars::schema_for!(CredentialResponse),
        ),
        finish(
            "auth.empty.input.schema.json",
            schemars::schema_for!(EmptyAuthRequest),
        ),
        finish(
            "auth.family-alarm.output.schema.json",
            schemars::schema_for!(FamilyAlarmResponse),
        ),
        finish(
            "auth.mailbox.query.schema.json",
            schemars::schema_for!(MailboxQuery),
        ),
        finish(
            "auth.mailbox.output.schema.json",
            schemars::schema_for!(MailboxResponse),
        ),
        finish(
            "auth.mint-session.input.schema.json",
            schemars::schema_for!(MintSessionRequest),
        ),
        finish(
            "auth.rehearsal-grant.v1.schema.json",
            schemars::schema_for!(AuthRehearsalGrantV1),
        ),
        finish(
            "auth.rehearsal-window.v1.schema.json",
            schemars::schema_for!(AuthRehearsalWindowV1),
        ),
        finish(
            "auth.rehearsal-reachability.v1.schema.json",
            schemars::schema_for!(AuthRehearsalReachabilityV1),
        ),
        finish(
            "auth.rehearsal-store-markers.v1.schema.json",
            schemars::schema_for!(AuthRehearsalStoreMarkersV1),
        ),
        finish(
            "auth.rehearsal-logical-export.v1.schema.json",
            schemars::schema_for!(AuthRehearsalLogicalExportArtifactV1),
        ),
        finish(
            "auth.rehearsal-mint.input.v1.schema.json",
            schemars::schema_for!(RehearsalMintRequestV1),
        ),
        finish(
            "auth.rehearsal-mint.output.v1.schema.json",
            schemars::schema_for!(RehearsalMintResultV1),
        ),
        finish(
            "auth.rehearsal-exercise.input.v1.schema.json",
            schemars::schema_for!(RehearsalExerciseRequestV1),
        ),
        finish(
            "auth.rehearsal-revoke.input.v1.schema.json",
            schemars::schema_for!(RehearsalRevokeRequestV1),
        ),
        finish(
            "auth.rehearsal-status.input.v1.schema.json",
            schemars::schema_for!(RehearsalStatusRequestV1),
        ),
        finish(
            "auth.rescue-colliding-table.input.schema.json",
            schemars::schema_for!(RescueCollidingTableRequest),
        ),
        finish(
            "live.resume-token.schema.json",
            schemars::schema_for!(ResumeWire),
        ),
        finish(
            "query.input.schema.json",
            schemars::schema_for!(FiniteQueryRequest),
        ),
        finish(
            "action.input.schema.json",
            schemars::schema_for!(FunctionCallRequest),
        ),
        finish(
            "mutation.input.schema.json",
            schemars::schema_for!(MutationRequest),
        ),
        finish(
            "client-mutation.ack.input.schema.json",
            schemars::schema_for!(MutationAcknowledgementRequest),
        ),
        finish(
            "client-mutation.ack.output.schema.json",
            schemars::schema_for!(MutationAcknowledgementResponse),
        ),
        finish(
            "handler.invoke.input.schema.json",
            schemars::schema_for!(HandlerInvokeRequest),
        ),
        finish(
            "handler.invoke.output.schema.json",
            schemars::schema_for!(HandlerInvokeResponse),
        ),
        finish(
            "handler.host-call.input.schema.json",
            schemars::schema_for!(HandlerHostCallRequest),
        ),
        finish(
            "live.kit-socket-request.schema.json",
            schemars::schema_for!(KitSocketRequestFrame),
        ),
        finish(
            "live.kit-socket-reply.schema.json",
            schemars::schema_for!(KitSocketReplyFrame),
        ),
        finish(
            "live.outbox-drain.output.schema.json",
            schemars::schema_for!(OutboxDrainOutput),
        ),
        finish(
            "query.output.schema.json",
            schemars::schema_for!(FunctionResponse<FiniteQueryOutput>),
        ),
        finish(
            "ephemeral.publish.input.schema.json",
            schemars::schema_for!(PublishRequest),
        ),
        finish(
            "ephemeral.subscribe.input.schema.json",
            schemars::schema_for!(SubscribeRequest),
        ),
        finish(
            "ephemeral.delete.input.schema.json",
            schemars::schema_for!(DeleteRequest),
        ),
        finish(
            "ephemeral.subscribe.output.schema.json",
            schemars::schema_for!(EphemeralMessage),
        ),
        finish(
            "ephemeral.delete.output.schema.json",
            schemars::schema_for!(Option<EphemeralMessage>),
        ),
    ];
    artifacts.extend(
        crate::api_envelope::schema_registrations()
            .into_iter()
            .map(|(file, schema)| finish(file, schema)),
    );
    artifacts.extend(
        crate::app_data_result::schema_registrations()
            .into_iter()
            .map(|(file, schema)| finish(file, schema)),
    );
    artifacts
}

/// Generated instances owned by the contract leaf.
pub fn artifact_instances() -> Vec<SchemaArtifact> {
    vec![
        instance("id-registry.v1.json", crate::ids::id_registry_artifact()),
        instance(
            "remediation-kinds.v1.registry.json",
            crate::remediation::remediation_kind_registry_artifact(),
        ),
        instance(
            "remediation.wire-fixtures.v1.json",
            serde_json::to_value(crate::remediation::remediation_fixture_corpus())
                .expect("remediation fixtures serialize to JSON"),
        ),
        instance(
            crate::telemetry_contract::OPERATION_CLASS_REGISTRY_FILE,
            crate::telemetry_contract::operation_class_registry_artifact(),
        ),
        instance(
            crate::telemetry_contract::PROJECTION_FIXTURE_CORPUS_FILE,
            crate::telemetry_contract::projection_fixture_corpus(),
        ),
        instance(
            crate::wire_fixtures::WIRE_FIXTURES_FILE,
            crate::wire_fixtures::wire_fixture_corpus(),
        ),
    ]
}

fn finish_remediation_set(file: &'static str, schema: impl serde::Serialize) -> SchemaArtifact {
    let mut artifact = finish(file, schema);
    constrain_root_string(
        &mut artifact.schema,
        "schemaVersion",
        REMEDIATION_SET_SCHEMA_VERSION,
    );
    constrain_root_string(
        &mut artifact.schema,
        "registryVersion",
        REMEDIATION_KIND_REGISTRY_VERSION,
    );
    if let Some(items) = artifact
        .schema
        .pointer_mut("/properties/items")
        .and_then(Value::as_object_mut)
    {
        items.insert(
            "maxItems".to_owned(),
            Value::from(REMEDIATION_SET_MAX_ITEMS),
        );
    }
    constrain_artifact_hashes(&mut artifact.schema);
    artifact.schema = sorted_keys(artifact.schema);
    artifact
}

fn finish_remediation_apply(file: &'static str, schema: impl serde::Serialize) -> SchemaArtifact {
    let mut artifact = finish(file, schema);
    constrain_root_string(
        &mut artifact.schema,
        "schemaVersion",
        REMEDIATION_APPLY_SCHEMA_VERSION,
    );
    constrain_artifact_hashes(&mut artifact.schema);
    artifact.schema = sorted_keys(artifact.schema);
    artifact
}

fn finish_remediation_fixtures(
    file: &'static str,
    schema: impl serde::Serialize,
) -> SchemaArtifact {
    let mut artifact = finish(file, schema);
    constrain_root_string(
        &mut artifact.schema,
        "formatVersion",
        REMEDIATION_FIXTURE_FORMAT_VERSION,
    );
    artifact.schema = sorted_keys(artifact.schema);
    artifact
}

fn constrain_root_string(schema: &mut Value, name: &str, exact: &str) {
    if let Some(property) = schema
        .pointer_mut(&format!("/properties/{name}"))
        .and_then(Value::as_object_mut)
    {
        property.insert("const".to_owned(), Value::String(exact.to_owned()));
    }
}

fn constrain_artifact_hashes(value: &mut Value) {
    match value {
        Value::Object(object) => {
            if let Some(property) = object
                .get_mut("artifactHash")
                .and_then(Value::as_object_mut)
            {
                property.insert(
                    "pattern".to_owned(),
                    Value::String("^sha256:(?:[0-9a-f]{16}|[0-9a-f]{64})$".to_owned()),
                );
            }
            for child in object.values_mut() {
                constrain_artifact_hashes(child);
            }
        }
        Value::Array(array) => {
            for child in array {
                constrain_artifact_hashes(child);
            }
        }
        _ => {}
    }
}

fn stamp_schema_version(value: &mut Value, file: &str) {
    if let Value::Object(map) = value {
        let stem = file.strip_suffix(".schema.json").unwrap_or(file);
        map.insert(
            "$id".to_owned(),
            Value::String(format!(
                "https://schemas.snapback.dev/{SNAPBACK_SCHEMA_VERSION}/{stem}.schema.json"
            )),
        );
    }
}

pub fn sorted_keys(value: Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut entries: Vec<(String, Value)> = map.into_iter().collect();
            entries.sort_by(|(a, _), (b, _)| a.cmp(b));
            Value::Object(
                entries
                    .into_iter()
                    .map(|(key, inner)| (key, sorted_keys(inner)))
                    .collect(),
            )
        }
        Value::Array(items) => Value::Array(items.into_iter().map(sorted_keys).collect()),
        other => other,
    }
}
