//! Feature-gated fixtures for tests in higher-ranked workspace crates.
//!
//! Cargo features are caller-controlled, so every helper here must remain safe
//! when a dependent enables `test-support` in a release build. In particular,
//! this module must not combine caller-selected executable code with fabricated
//! authority or expose an authority-bypassing evaluator.

use base64::Engine as _;
use sha2::Digest as _;

use crate::assets::AssetReadAccessPolicy;
use crate::auth::invocation::{InvocationGate, InvocationSource, PreparedAuthority};
use crate::contract_types::ServerProfile;
use crate::diagnostic::SnapbackResult;
use crate::local::LocalSnapback;
use crate::local::{LiveInvalidationAdmission, LiveSubscribeInput, LiveSubscribeOutput};
use crate::manifest::{
    AssetAcceptPolicy, AssetAccessPolicy, AssetDeliveryPolicy, AssetImagePolicy, AssetImageVariant,
    AssetLocationPolicy, AssetUploadIntentDefinition, AuthInput, FunctionManifest, FunctionRuntime,
    GraphQueryPlanV1, GraphRowKeyV1, HandlerInput, IbexModule,
};

pub fn apply_graph_delta_to_result_for_test(
    plan: &GraphQueryPlanV1,
    previous_result_bytes: &str,
    previous_root_keys: &[GraphRowKeyV1],
    ops: &[crate::live_wire::LiveGraphDeltaWireOpV1],
    ordered_root_keys: &[GraphRowKeyV1],
) -> SnapbackResult<String> {
    crate::graph_evaluator::apply_graph_delta_to_result(
        plan,
        previous_result_bytes,
        previous_root_keys,
        ops,
        ordered_root_keys,
    )
}

const ASSET_INTENT_SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async signedUpload(ctx) {
    return { owner: (ctx.auth && ctx.auth.userId) ? ctx.auth.userId : "owner_1" };
  }
};
"#;

/// A ready private-signed asset and the exact authority that created it.
pub struct SignedAssetFixture {
    pub snapback: LocalSnapback,
    pub asset_id: String,
    pub authority: PreparedAuthority,
}

/// Construct the compatibility admission used by higher-rank transport tests.
pub fn live_invalidation_admission(
    connection: crate::auth::invalidation::AuthorizationInvalidationConnection,
    session_mode: bool,
) -> LiveInvalidationAdmission {
    LiveInvalidationAdmission::new(connection).with_session_mode(session_mode)
}

/// Compatibility admission for tests that deliberately exercise a connection
/// without the authorization-invalidation protocol.
pub fn live_unscoped_invalidation_admission(
    effect_fence: crate::ephemeral::ConnectionEffectFence,
    session_mode: bool,
) -> LiveInvalidationAdmission {
    LiveInvalidationAdmission::without_invalidation(effect_fence).with_session_mode(session_mode)
}

pub fn auth_database_mut(snapback: &mut LocalSnapback) -> &mut crate::storage::LocalDatabase {
    snapback.auth_database_mut()
}

pub fn erase_protected_record(
    snapback: &mut LocalSnapback,
    request: &crate::proof_checkpoint::ProtectedRecordErasureRequestV1,
) -> SnapbackResult<crate::proof_checkpoint::ProtectedRecordErasureReceiptV1> {
    snapback.erase_protected_record(request)
}

pub fn activate_agent_safe_operation_coverage(
    snapback: &mut LocalSnapback,
    activated_at_ms: u64,
) -> SnapbackResult<crate::commit_envelope::OperationCoverageManifestV1> {
    snapback.activate_agent_safe_operation_coverage(activated_at_ms)
}

pub fn authorization_commit_preflight_for_seed(
    snapback: &mut LocalSnapback,
    seed: &crate::manifest::SeedData,
) -> SnapbackResult<crate::storage::AuthorizationCommitPreflight> {
    snapback.authorization_commit_preflight_for_seed(seed)
}

pub fn asset_host_op(
    snapback: &mut LocalSnapback,
    operation: &str,
    input: Option<&serde_json::Value>,
    user_id: Option<&str>,
    profile: ServerProfile,
) -> SnapbackResult<serde_json::Value> {
    snapback.asset_host_op(operation, input, user_id, profile)
}

/// Return only the non-authoritative backend classification. The store handle
/// is deliberately dropped inside the owner crate.
pub fn asset_store_kind(snapback: &LocalSnapback) -> SnapbackResult<&'static str> {
    snapback.asset_store_obj().map(|store| store.kind())
}

pub fn asset_set_attempt_expiry(
    snapback: &mut LocalSnapback,
    attempt_id: &str,
    expires_at_ms: u64,
) -> SnapbackResult<()> {
    snapback.asset_set_attempt_expiry_for_test(attempt_id, expires_at_ms)
}

pub fn asset_publication_count(snapback: &mut LocalSnapback) -> SnapbackResult<u64> {
    snapback.asset_publication_count_for_test()
}

pub fn asset_attempt_state(
    snapback: &mut LocalSnapback,
    attempt_id: &str,
) -> SnapbackResult<crate::assets::AssetAttemptState> {
    snapback.asset_attempt_state_for_test(attempt_id)
}

/// Move the exact phantom-sensitive admission witness used by the HTTP
/// finalize retry regression. This helper mutates only a fixed test schema and
/// fixed row; it accepts no caller-supplied code or query shape.
pub fn asset_move_finalize_witness(
    snapback: &mut LocalSnapback,
    attempt_id: &str,
) -> SnapbackResult<()> {
    snapback.asset_move_finalize_witness_for_test(attempt_id)
}

/// Subscribe through a prepared authority, restricted to declarative plans.
/// Caller-loaded JavaScript modules are refused before evaluation.
pub fn subscribe_live_prepared_with_invalidation(
    snapback: &mut LocalSnapback,
    name: &str,
    input: LiveSubscribeInput,
    authority: PreparedAuthority,
    invalidation: LiveInvalidationAdmission,
) -> SnapbackResult<LiveSubscribeOutput> {
    snapback.require_host_plan_for_test_support(name)?;
    snapback.subscribe_live_prepared_with_invalidation(name, input, authority, invalidation)
}

/// Build the protocol-test authority and subscribe to a declarative plan.
/// Caller-loaded JavaScript modules are refused before evaluation.
pub fn subscribe_live_host_plan_with_invalidation(
    snapback: &mut LocalSnapback,
    name: &str,
    input: LiveSubscribeInput,
    invalidation: LiveInvalidationAdmission,
) -> SnapbackResult<LiveSubscribeOutput> {
    snapback.require_host_plan_for_test_support(name)?;
    snapback.subscribe_live_with_invalidation(name, input, invalidation)
}

/// Install the deterministic stream identities and real retained-live
/// scheduler used by LLP 0209's frozen cross-crate corpus.
pub fn configure_graph_corpus_scheduler(
    snapback: &mut LocalSnapback,
    authorization: crate::storage::AuthorizationVersion,
    data_version_stream: &str,
) -> SnapbackResult<crate::auth::invalidation::AuthorizationInvalidationConnection> {
    snapback.configure_graph_corpus_scheduler_for_test(authorization, data_version_stream)
}

/// Bind a sessions-mode fixture clone's existing authorization stream for a
/// read-only served-path measurement. No catalog or identity rows are added.
pub fn configure_graph_measurement_scheduler(
    snapback: &mut LocalSnapback,
) -> SnapbackResult<crate::auth::invalidation::AuthorizationInvalidationConnection> {
    snapback.configure_graph_measurement_scheduler_for_test()
}

/// Establish a corpus graph with the real sessions-mode retained authority
/// and invalidation protocol. Caller-loaded JavaScript remains refused.
pub fn subscribe_graph_corpus_case(
    snapback: &mut LocalSnapback,
    name: &str,
    input: LiveSubscribeInput,
    connection: crate::auth::invalidation::AuthorizationInvalidationConnection,
) -> SnapbackResult<LiveSubscribeOutput> {
    snapback.require_host_plan_for_test_support(name)?;
    snapback.subscribe_graph_corpus_case_for_test(name, input, connection)
}

/// Establish the same corpus graph under a second owner-issued authority
/// instance for partition-isolation evidence. Both instances resolve to the
/// fixed corpus principal and session; only the host-owned prepared authority
/// instance rotates, matching the engine's authority-isolation test pattern.
pub fn subscribe_graph_corpus_partition_case(
    snapback: &mut LocalSnapback,
    name: &str,
    input: LiveSubscribeInput,
    connection: crate::auth::invalidation::AuthorizationInvalidationConnection,
) -> SnapbackResult<LiveSubscribeOutput> {
    snapback.require_host_plan_for_test_support(name)?;
    snapback.subscribe_graph_corpus_partition_case_for_test(name, input, connection)
}

/// Commit one declarative corpus mutation through the ordinary mutation and
/// post-commit fan-out path. Caller-loaded JavaScript remains refused.
pub fn invoke_graph_corpus_mutation(
    snapback: &mut LocalSnapback,
    name: &str,
    input: HandlerInput,
) -> SnapbackResult<crate::manifest::MutationOutput> {
    snapback.require_host_plan_for_test_support(name)?;
    snapback.invoke_graph_corpus_mutation_for_test(name, input)
}

pub fn graph_corpus_authorization_frames(
    snapback: &mut LocalSnapback,
    connection_id: &str,
) -> SnapbackResult<Vec<String>> {
    snapback.graph_corpus_authorization_frames_for_test(connection_id)
}

/// Refresh every served graph through the production memo/group path and
/// return measurements read from the retained memo entries themselves.
pub fn measure_graph_serving_groups(
    snapback: &mut LocalSnapback,
) -> SnapbackResult<serde_json::Value> {
    snapback.measure_graph_serving_groups_for_test()
}

/// Drive either every retained graph or one named subscription through the
/// production refresh scheduler. The targeted arm exists for tuple-isolation
/// cases where predecessor memo holders must remain installed.
pub fn refresh_graph_corpus_scheduler(
    snapback: &mut LocalSnapback,
    only_subscription: Option<&str>,
) -> SnapbackResult<bool> {
    snapback.refresh_graph_corpus_scheduler_for_test(only_subscription)
}

pub fn set_graph_corpus_memo_limits(
    snapback: &mut LocalSnapback,
    max_entries: usize,
    max_bytes: usize,
) {
    snapback.set_graph_corpus_memo_limits_for_test(max_entries, max_bytes);
}

pub fn graph_corpus_memo_entries(snapback: &LocalSnapback) -> serde_json::Value {
    snapback.graph_corpus_memo_entries_for_test()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_live_helper_refuses_caller_loaded_javascript() {
        let mut snapback = LocalSnapback::memory().expect("memory test-support audit fixture");
        let diagnostics = snapback.load_functions(FunctionManifest {
            functions: vec![crate::manifest::FunctionDefinition::new(
                "callerJavascript",
                crate::manifest::FunctionKind::LiveQuery,
                FunctionRuntime::IbexModule(IbexModule {
                    source: r#"
globalThis.__snapbackHandlers = {
  async callerJavascript(ctx) {
    return await ctx.db.elevated.query("secrets").collect();
  }
};
"#
                    .to_owned(),
                    export: "callerJavascript".to_owned(),
                }),
            )],
            ..FunctionManifest::default()
        });
        assert!(
            !diagnostics.iter().any(|diagnostic| matches!(
                diagnostic.severity,
                crate::diagnostic::DiagnosticSeverity::Error
                    | crate::diagnostic::DiagnosticSeverity::Fatal
            )),
            "caller module must load so the guard, not fixture validation, is tested: {diagnostics:?}",
        );

        let error = subscribe_live_host_plan_with_invalidation(
            &mut snapback,
            "callerJavascript",
            LiveSubscribeInput {
                connection_id: "test-support-audit".to_owned(),
                input: HandlerInput::default(),
                authorization_namespace: None,
                supersedes: None,
                resume_from_token: None,
            },
            LiveInvalidationAdmission::default(),
        )
        .expect_err("public test-support helper must refuse caller-loaded JavaScript");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_TEST_SUPPORT_RUNTIME_FORBIDDEN"
        );
    }
}

/// Build the bounded engine state needed by the façade's signed-URL route test.
pub fn signed_asset_fixture(user: &str, bytes: &[u8]) -> SignedAssetFixture {
    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    let diagnostics = snapback.load_functions(FunctionManifest {
        asset_upload_intents: vec![AssetUploadIntentDefinition {
            id: "app:signedUpload".to_owned(),
            name: "signedUpload".to_owned(),
            exported_name: Some("signedUpload".to_owned()),
            implementation_hash: Some("sha256:test-impl".to_owned()),
            args_contract_hash: Some("sha256:test-args".to_owned()),
            intent_policy_hash: "sha256:test-policy-signedUpload".to_owned(),
            auth_requirement: None,
            accept: AssetAcceptPolicy {
                media_types: vec![
                    "application/octet-stream".to_owned(),
                    "image/jpeg".to_owned(),
                ],
                max_bytes: 64 * 1024,
            },
            delivery: AssetDeliveryPolicy {
                kind: crate::assets::AssetDeliveryProfile::PrivateSigned,
            },
            access: AssetAccessPolicy {
                read: AssetReadAccessPolicy::OwnerOnly,
            },
            grants: false,
            image: Some(AssetImagePolicy {
                location: AssetLocationPolicy::Retain,
                variants: vec![AssetImageVariant {
                    key: "thumb".to_owned(),
                    width: 16,
                    required: false,
                }],
            }),
            video: None,
            on: None,
            declared_reads: Vec::new(),
            runtime: FunctionRuntime::IbexModule(IbexModule {
                source: ASSET_INTENT_SOURCE.to_owned(),
                export: "signedUpload".to_owned(),
            }),
            handler_form: Some("inline".to_owned()),
            source_span: None,
        }],
        ..FunctionManifest::default()
    });
    assert!(
        diagnostics
            .iter()
            .all(|diagnostic| diagnostic.severity != crate::diagnostic::DiagnosticSeverity::Error),
        "intent manifest must load: {diagnostics:?}"
    );

    let authority = dev_authority(user, InvocationSource::HttpQuery);
    let transfer = dev_authority(user, InvocationSource::AssetTransfer);
    let created = snapback
        .asset_attempt_create(
            &authority,
            crate::assets::AssetAttemptCreateRequestV1 {
                intent_id: "app:signedUpload".to_owned(),
                intent_policy_hash: "sha256:test-policy-signedUpload".to_owned(),
                implementation_hash: Some("sha256:test-impl".to_owned()),
                args: serde_json::json!({}),
                declared_filename: Some("photo.bin".to_owned()),
                declared_length: Some(bytes.len() as u64),
                declared_content_type: Some("application/octet-stream".to_owned()),
                retry_of_asset_id: None,
            },
        )
        .expect("attempt creates");
    let checksum = base64::engine::general_purpose::STANDARD.encode(sha2::Sha256::digest(bytes));
    snapback
        .asset_tus_patch(
            &transfer,
            &created.task.attempt_id,
            0,
            bytes,
            Some(("sha256", checksum.as_str())),
        )
        .expect("bytes land");
    snapback
        .asset_attempt_finalize(
            &authority,
            crate::assets::AssetFinalizeRequestV1 {
                attempt_id: created.task.attempt_id,
                lifecycle_generation: 1,
                declared_digest: None,
            },
        )
        .expect("finalizes");

    SignedAssetFixture {
        snapback,
        asset_id: created.task.asset_id,
        authority,
    }
}

fn dev_authority(user: &str, source: InvocationSource) -> PreparedAuthority {
    InvocationGate::prepare_dev_input(
        source,
        ServerProfile::Dev,
        &HandlerInput {
            auth: AuthInput {
                user_id: Some(user.to_owned()),
                ..AuthInput::default()
            },
            ..HandlerInput::default()
        },
    )
    .expect("dev authority")
}
