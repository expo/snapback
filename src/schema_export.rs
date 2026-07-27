//! Generated JSON Schemas for the Snapback-owned shared artifact shapes.
//!
//! The Rust serde types are the single source of truth (LLP 0037, Rust-first).
//! The JSON Schemas committed under `schemas/` are *generated* from those types
//! by [`artifact_schemas`]; nothing is hand-authored. There is exactly one
//! generator and two callers, so the committed files cannot diverge from the
//! checker: the `snapback-schemagen` bin writes the files, and
//! `tests/artifact_schemas_v0.rs` regenerates in-memory and fails on any diff
//! (the CI drift gate LLP 0012 §Versioning requires).
//!
//! Scope fence (LLP 0037): this governs Snapback-owned artifacts only. The
//! Exact-owned `ContractDataManifest` is not derived here.
//!
//! @ref LLP 0037#decision-ratified-2026-07-02 — Rust serde types are the source
//!   of truth; JSON Schemas are generated from them and drift-gated.
//! @ref LLP 0032#decision-docket — DK-7 / P3(c): schemars-derived, committed, drift-gated.

use serde_json::Value;

use crate::admin::AdminInspect;
use crate::auth::deployment::{
    HostedAdmission, HostedAdmissionEnvelope, HostedAdmissionKeyFile, HostedAuthCapabilities,
};
use crate::auth::handshake::AuthSessionResponse;
use crate::auth::lease::AuthorizedLease;
use crate::auth::wire::{
    CredentialResponse, EmptyAuthRequest, ExchangeRequest, FamilyAlarmResponse, MailboxQuery,
    MailboxResponse, MintSessionRequest, RequestCodeRequest, RequestCodeResponse,
    RescueCollidingTableRequest,
};
use crate::data_tier::{DataTierCorpusCase, DataTierCorpusManifest, DataTierProfile};
use crate::deploy::{
    AdapterLifecycleRequest, AdapterLifecycleResponse, AdapterQualificationManifest,
    AdapterQueryRequest, AdapterQueryResponse, AdapterRequest, AdapterResponse, BackupManifest,
    BackupPlan, ControlAuditEvent, DeployPlan, DeployReceipt, ExternalReplayFloorAdvanceReceipt,
    HostedAdmissionProjectionReceipt, HostedAdmissionRefreshReceipt, HostedAuthDrillReceipt,
    MaintenanceReceipt, PreparedReleaseManifest, ReleaseManifest, RemoteDrillPlan,
    RestoreActivationPlan, RestorePlan, RollbackPlan, TargetDescriptor,
};
use crate::diagnostic::Diagnostic;
use crate::ephemeral::{
    DeleteRequest, EphemeralMessage, PublishOutcome, PublishRequest, RealtimeEnvelope,
    SubscribeRequest,
};
use crate::handler_wire::{HandlerHostCallRequest, HandlerInvokeRequest, HandlerInvokeResponse};
use crate::host_ops::{DryRunReport, HostOpsResult, HostReadyDescriptor};
use crate::live_wire::{
    KitSocketRequestFrame, LiveEnvelope, LiveSocketClientMessage, LiveSocketServerFrame,
    OutboxDrainOutput, Receipt, ResumeWire,
};
use crate::local::{
    AuthorizationInvalidationAckInput, AuthorizationInvalidationAckOutput,
    AuthorizationInvalidationManualRetryInput, AuthorizationInvalidationManualRetryOutput,
    EnsureAppRequest, EnsureAppResponse, FunctionRunResult, InspectState, LiveResumeInput,
    LiveResumeOutput, LiveSubscribeInput, LiveSubscribeOutput, LiveUnsubscribeInput,
    LiveUnsubscribeOutput, PublicInspect,
};
use crate::manifest::{
    CapabilityManifest, FunctionManifest, HandlerInput, MutationAcknowledgementRequest,
    MutationAcknowledgementResponse, MutationRequest, QueryOutput, SNAPBACK_SCHEMA_VERSION,
    SchemaManifest,
};
use crate::migration::{
    MigrationAdmissionV1, MigrationApprovalV1, MigrationPlanArtifactV1,
    MigrationPreviewObservationV1, MigrationRehearsalPlanV1,
};
use crate::server::{
    AuthorizedLeaseQueryRequest, AuthorizedLeaseQueryResponse, ConnectionGrant, ErrorResponse,
    MutationResponse, OpenConnectionRequest, SessionLiveSocketClientMessage,
};
use crate::service_profile::{
    RemoteAuthCapabilityManifest, RemoteDataCapabilityManifest, RemoteServiceProfile,
};
use crate::storage::{SchemaTransitionEventBodyV1, StorageInfo};

/// A generated schema artifact: the committed file name (relative to the
/// repo-root `schemas/` directory) and the JSON Schema derived from a Rust type.
pub struct SchemaArtifact {
    /// File name under `schemas/`, e.g. `schema.manifest.schema.json`.
    pub file: &'static str,
    /// The generated JSON Schema, with sorted keys for a stable committed diff.
    pub schema: Value,
}

/// The single generator for every Snapback-owned committed schema.
///
/// Both the `snapback-schemagen` bin (which writes `schemas/`) and the drift
/// gate in `tests/artifact_schemas_v0.rs` (which compares) call this, so the
/// generated output and the gate can never diverge.
pub fn artifact_schemas() -> Vec<SchemaArtifact> {
    vec![
        finish(
            "schema.manifest.schema.json",
            schemars::schema_for!(SchemaManifest),
        ),
        finish(
            "functions.manifest.schema.json",
            schemars::schema_for!(FunctionManifest),
        ),
        finish(
            "data-tier.profile.schema.json",
            schemars::schema_for!(DataTierProfile),
        ),
        finish(
            "data-tier.corpus.schema.json",
            schemars::schema_for!(DataTierCorpusManifest),
        ),
        finish(
            "data-tier.case.schema.json",
            schemars::schema_for!(DataTierCorpusCase),
        ),
        finish(
            "capability.manifest.schema.json",
            schemars::schema_for!(CapabilityManifest),
        ),
        // LLP 0081 canonical migration artifacts (the Phase C wave-1 types).
        finish(
            "migration.plan.schema.json",
            schemars::schema_for!(MigrationPlanArtifactV1),
        ),
        finish(
            "migration.observation.schema.json",
            schemars::schema_for!(MigrationPreviewObservationV1),
        ),
        finish(
            "migration.approval.schema.json",
            schemars::schema_for!(MigrationApprovalV1),
        ),
        finish(
            "migration.admission.schema.json",
            schemars::schema_for!(MigrationAdmissionV1),
        ),
        // LLP 0081 §7: the restore-derived rehearsal plan.
        finish(
            "migration.rehearsal.schema.json",
            schemars::schema_for!(MigrationRehearsalPlanV1),
        ),
        finish(
            "migration.receipt.schema.json",
            schemars::schema_for!(crate::storage::migration_executor::MigrationReceiptV1),
        ),
        finish(
            "migration.rollback-receipt.schema.json",
            schemars::schema_for!(crate::storage::migration_executor::MigrationRollbackReceiptV1),
        ),
        finish(
            "migration.journal-entry.schema.json",
            schemars::schema_for!(crate::storage::migration_executor::MigrationJournalEntryV1),
        ),
        // The migration scan's journal-persisted batch checkpoint
        // (LLP 0081 §3/§5) — the Wave-2 executor's durable contract.
        finish(
            "migration.keyset-scan.checkpoint.schema.json",
            schemars::schema_for!(crate::storage::MigrationKeysetScanCheckpointV1),
        ),
        finish(
            "auth.hosted-capabilities.schema.json",
            schemars::schema_for!(HostedAuthCapabilities),
        ),
        finish(
            "auth.hosted-admission.schema.json",
            schemars::schema_for!(HostedAdmission),
        ),
        finish(
            "auth.hosted-admission-envelope.schema.json",
            schemars::schema_for!(HostedAdmissionEnvelope),
        ),
        finish(
            "auth.hosted-admission-key.schema.json",
            schemars::schema_for!(HostedAdmissionKeyFile),
        ),
        finish(
            "auth.external-replay-floor-advance.schema.json",
            schemars::schema_for!(ExternalReplayFloorAdvanceReceipt),
        ),
        finish(
            "auth.hosted-admission-projection.schema.json",
            schemars::schema_for!(HostedAdmissionProjectionReceipt),
        ),
        finish(
            "auth.hosted-admission-refresh.schema.json",
            schemars::schema_for!(HostedAdmissionRefreshReceipt),
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
        finish(
            "release.manifest.schema.json",
            schemars::schema_for!(ReleaseManifest),
        ),
        finish(
            "target.descriptor.schema.json",
            schemars::schema_for!(TargetDescriptor),
        ),
        finish(
            "remote-drill.plan.schema.json",
            schemars::schema_for!(RemoteDrillPlan),
        ),
        finish(
            "vm-adapter.request.schema.json",
            schemars::schema_for!(AdapterRequest),
        ),
        finish(
            "vm-adapter.response.schema.json",
            schemars::schema_for!(AdapterResponse),
        ),
        finish(
            "vm-adapter.lifecycle-request.schema.json",
            schemars::schema_for!(AdapterLifecycleRequest),
        ),
        finish(
            "vm-adapter.lifecycle-response.schema.json",
            schemars::schema_for!(AdapterLifecycleResponse),
        ),
        finish(
            "backup.manifest.schema.json",
            schemars::schema_for!(BackupManifest),
        ),
        finish("backup.plan.schema.json", schemars::schema_for!(BackupPlan)),
        finish(
            "control.audit-event.schema.json",
            schemars::schema_for!(ControlAuditEvent),
        ),
        finish(
            "adapter.qualification.schema.json",
            schemars::schema_for!(AdapterQualificationManifest),
        ),
        finish(
            "hosted-auth.drill-receipt.schema.json",
            schemars::schema_for!(HostedAuthDrillReceipt),
        ),
        finish(
            "prepared-release.manifest.schema.json",
            schemars::schema_for!(PreparedReleaseManifest),
        ),
        finish("deploy.plan.schema.json", schemars::schema_for!(DeployPlan)),
        finish(
            "deploy.receipt.schema.json",
            schemars::schema_for!(DeployReceipt),
        ),
        finish(
            "rollback.plan.schema.json",
            schemars::schema_for!(RollbackPlan),
        ),
        finish(
            "restore.plan.schema.json",
            schemars::schema_for!(RestorePlan),
        ),
        finish(
            "restore.activation-plan.schema.json",
            schemars::schema_for!(RestoreActivationPlan),
        ),
        finish(
            "maintenance.receipt.schema.json",
            schemars::schema_for!(MaintenanceReceipt),
        ),
        finish(
            "vm-adapter.query-request.schema.json",
            schemars::schema_for!(AdapterQueryRequest),
        ),
        finish(
            "vm-adapter.query-response.schema.json",
            schemars::schema_for!(AdapterQueryResponse),
        ),
        finish("inspect.schema.json", schemars::schema_for!(InspectState)),
        finish(
            "inspect.public.schema.json",
            schemars::schema_for!(PublicInspect),
        ),
        finish(
            "storage-info.schema.json",
            schemars::schema_for!(StorageInfo),
        ),
        // LLP 0081 §4's same-landing LLP 0007 amendment: the typed
        // schema-transition event payload (schema-resync / rollback-resync).
        finish(
            "schema-transition.event.schema.json",
            schemars::schema_for!(SchemaTransitionEventBodyV1),
        ),
        finish(
            "host-ops.result.schema.json",
            schemars::schema_for!(HostOpsResult),
        ),
        finish(
            "host-ready.schema.json",
            schemars::schema_for!(HostReadyDescriptor),
        ),
        // The mutationDryRun report (LLP 0051 D8 / Increment 4): the
        // function.explain result the Exact-side Acto dry-run wraps. Embeds
        // CtxAnswerLedger, putting the D1 ledger wire shape under the DK-7
        // gate (the ENG-23892 deferral).
        finish(
            "dry-run.report.schema.json",
            schemars::schema_for!(DryRunReport),
        ),
        finish(
            "inspect.admin.schema.json",
            schemars::schema_for!(AdminInspect),
        ),
        // The client-visible live wire (LLP 0051 D4 / ENG-23891): fan-out
        // envelopes, socket control frames both directions, receipts, the
        // HTTP polling wrapper, the connection grant, the error envelope,
        // and the live HTTP operation outputs.
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
            "connection.grant.schema.json",
            schemars::schema_for!(ConnectionGrant),
        ),
        finish(
            "connection.open.input.schema.json",
            schemars::schema_for!(OpenConnectionRequest),
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
            "authorized-lease.schema.json",
            schemars::schema_for!(AuthorizedLease),
        ),
        finish(
            "authorized-lease.query.input.schema.json",
            schemars::schema_for!(AuthorizedLeaseQueryRequest),
        ),
        finish(
            "authorized-lease.query.output.schema.json",
            schemars::schema_for!(AuthorizedLeaseQueryResponse),
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
            "auth.rescue-colliding-table.input.schema.json",
            schemars::schema_for!(RescueCollidingTableRequest),
        ),
        finish(
            "auth.rescue-colliding-table.output.schema.json",
            schemars::schema_for!(crate::auth::rescue::CollisionRescueResult),
        ),
        // The snapshot bundle endpoint (LLP 0092 §0D.1): request/response of
        // `POST /app/bundle`, exported through the LLP 0051 drift gates.
        finish(
            "app.bundle.input.schema.json",
            schemars::schema_for!(crate::bundle::BundleRequest),
        ),
        finish(
            "app.bundle.output.schema.json",
            schemars::schema_for!(crate::bundle::BundleResponse),
        ),
        // The route→query manifest artifact (LLP 0092 §0C.1): compiled by
        // codegen from `snapback/routes.mjs`, admitted through ensure, and
        // hashed into `generation` as `routeManifestHash`.
        finish(
            "routes.manifest.schema.json",
            schemars::schema_for!(crate::bundle::RoutesManifest),
        ),
        finish(
            "app.ensure.input.schema.json",
            schemars::schema_for!(EnsureAppRequest),
        ),
        finish(
            "app.ensure.output.schema.json",
            schemars::schema_for!(EnsureAppResponse),
        ),
        finish(
            "error.response.schema.json",
            schemars::schema_for!(ErrorResponse),
        ),
        finish(
            "mutation.output.schema.json",
            schemars::schema_for!(MutationResponse),
        ),
        finish(
            "live.subscribe.output.schema.json",
            schemars::schema_for!(LiveSubscribeOutput),
        ),
        finish(
            "live.subscribe.input.schema.json",
            schemars::schema_for!(LiveSubscribeInput),
        ),
        finish(
            "live.resume.output.schema.json",
            schemars::schema_for!(LiveResumeOutput),
        ),
        // The RQS token-resume resume object (LLP 0091 §0B.1). Named
        // `resume-token` so the token-resume vocabulary never collides with
        // the reattach operation's `live.resume.*` schemas above (§0B.4).
        finish(
            "live.resume-token.schema.json",
            schemars::schema_for!(ResumeWire),
        ),
        finish(
            "live.resume.input.schema.json",
            schemars::schema_for!(LiveResumeInput),
        ),
        finish(
            "live.unsubscribe.output.schema.json",
            schemars::schema_for!(LiveUnsubscribeOutput),
        ),
        finish(
            "live.unsubscribe.input.schema.json",
            schemars::schema_for!(LiveUnsubscribeInput),
        ),
        finish(
            "authorization-invalidation.ack.input.schema.json",
            schemars::schema_for!(AuthorizationInvalidationAckInput),
        ),
        finish(
            "authorization-invalidation.ack.output.schema.json",
            schemars::schema_for!(AuthorizationInvalidationAckOutput),
        ),
        finish(
            "authorization-invalidation.manual-retry.input.schema.json",
            schemars::schema_for!(AuthorizationInvalidationManualRetryInput),
        ),
        finish(
            "authorization-invalidation.manual-retry.output.schema.json",
            schemars::schema_for!(AuthorizationInvalidationManualRetryOutput),
        ),
        finish(
            "query.input.schema.json",
            schemars::schema_for!(HandlerInput),
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
        // The LLP 0060 D6 private marker envelopes (LLP 0094 §0F item 1 /
        // LLP 0051 §D4): the coordinator→handler invocation request, the
        // handler→coordinator response envelope, and the handler→host call
        // body. Private but not hand-mirror-exempt; semantics stay owned by
        // LLP 0060, these are the served-shape authorities.
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
        // The hosted kit-socket in-band REQUEST grammar (LLP 0094 §0A.1
        // WS-kinds row / §0F item 2). The in-band REPLY grammar is
        // deliberately absent until its §0C.6 item-6 kit-dialect convergence.
        finish(
            "live.kit-socket-request.schema.json",
            schemars::schema_for!(KitSocketRequestFrame),
        ),
        // The bare-array drain response (LLP 0094 §0A.5).
        finish(
            "live.outbox-drain.output.schema.json",
            schemars::schema_for!(OutboxDrainOutput),
        ),
        // Former §0C gap rows (LLP 0094 §0F item 4): families that were
        // serde-typed but not independently schema-committed.
        finish(
            "query.output.schema.json",
            schemars::schema_for!(QueryOutput),
        ),
        finish(
            "action.output.schema.json",
            schemars::schema_for!(FunctionRunResult),
        ),
        finish(
            "live.socket-client.sessions.schema.json",
            schemars::schema_for!(SessionLiveSocketClientMessage),
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
            "ephemeral.publish.output.schema.json",
            schemars::schema_for!(PublishOutcome),
        ),
        finish(
            "ephemeral.subscribe.output.schema.json",
            schemars::schema_for!(EphemeralMessage),
        ),
        // `/ephemeral/delete` answers the removed entry's final message, or
        // JSON `null` when nothing was present to delete.
        finish(
            "ephemeral.delete.output.schema.json",
            schemars::schema_for!(Option<EphemeralMessage>),
        ),
    ]
}

/// Generated public artifact instances owned by the Rust authority. These are
/// committed beside the schemas so a pinned git checkout is sufficient for a
/// non-Rust consumer.
pub fn artifact_instances() -> Vec<SchemaArtifact> {
    vec![
        SchemaArtifact {
            file: "data-tier.profile.json",
            schema: sorted_keys(
                serde_json::to_value(DataTierProfile::current())
                    .expect("data-tier profile serializes to JSON"),
            ),
        },
        // RelationalResultEncodingV1 golden vectors (LLP 0080 §2): the
        // committed vectors are generated through the encoder itself, so
        // this file, the drift gate, and the runtime cannot diverge.
        SchemaArtifact {
            file: "relational.result-encoding-v1.json",
            schema: sorted_keys(crate::rqs::relational_result_encoding_artifact()),
        },
        // LLP 0081 §2/§3 golden vectors: plan digest/id, canonical step
        // IDs, observation/approval/admission digests, and the synthesized
        // UUIDv7 conformance vectors — generated through the
        // The closed migration state machine and transition relation
        // (LLP 0081 §4), generated through the executor module so the
        // committed enumeration cannot drift from the append-time refusal.
        SchemaArtifact {
            file: "migration.journal-machine.v1.json",
            schema: sorted_keys(crate::storage::migration_executor::migration_journal_artifact()),
        },
        // implementation, byte-pinned in migration::tests.
        SchemaArtifact {
            file: "migration.vectors-v1.json",
            schema: sorted_keys(crate::migration::migration_vectors_artifact()),
        },
        // ContentDigestV1 golden vectors (LLP 0081 §5), generated through
        // the streaming implementation (resume-equality is asserted during
        // generation, so a committed file implies the property).
        SchemaArtifact {
            file: "content-digest.v1.json",
            schema: sorted_keys(crate::rqs::content_digest_artifact()),
        },
        // The LLP 0093 P-1 conformance fixture corpus (LLP 0095 §2-§3):
        // canonical frames + expected state-machine transitions, generated
        // through the live-wire serde types so fixtures cannot drift from
        // the wire. tests/wire_fixtures_v1.rs proves each fixture's
        // schemaValid claim against the committed family schema.
        SchemaArtifact {
            file: crate::wire_fixtures::WIRE_FIXTURES_FILE,
            schema: sorted_keys(crate::wire_fixtures::wire_fixture_corpus()),
        },
    ]
}

/// Convert a derived schema to a stable committed value: serialize it, stamp the
/// Snapback schema version onto its `$id`, and sort keys.
fn finish(file: &'static str, schema: impl serde::Serialize) -> SchemaArtifact {
    let mut value = serde_json::to_value(&schema).expect("derived schema serializes to JSON");
    stamp_schema_version(&mut value, file);
    SchemaArtifact {
        file,
        schema: sorted_keys(value),
    }
}

/// Stamp the Snapback schema version onto the schema's top-level `$id` so every
/// committed file carries its version and can be read without a cargo toolchain.
/// A `SNAPBACK_SCHEMA_VERSION` bump therefore shows up as a reviewable diff on
/// every schema and trips the drift gate — the versioning behavior LLP 0037 and
/// LLP 0012 §Versioning call for. The `$id` uses only same-document fragment
/// `$ref`s below it, so setting a base URI does not change validation.
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

/// Recursively sort object keys. `serde_json` runs with `preserve_order` in this
/// workspace (a transitive feature), so without this the committed files would
/// churn on derive/field-order changes; sorting makes the output canonical.
fn sorted_keys(value: Value) -> Value {
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
