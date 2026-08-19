//! Feature-gated fixtures for tests in higher-ranked workspace crates.
//!
//! This module is unavailable to production builds. It keeps adapter tests on
//! the real engine instantiation without widening the supported façade.

use base64::Engine as _;
use sha2::Digest as _;

use crate::assets::AssetReadAccessPolicy;
use crate::auth::invocation::{InvocationGate, InvocationSource, PreparedAuthority};
use crate::contract_types::ServerProfile;
use crate::diagnostic::SnapbackResult;
use crate::local::LocalSnapback;
use crate::local::{
    LiveInvalidationAdmission, LiveSubscribeInput, LiveSubscribeOutput, PreparedLiveSubscribe,
};
use crate::manifest::{
    AssetAcceptPolicy, AssetAccessPolicy, AssetDeliveryPolicy, AssetImagePolicy, AssetImageVariant,
    AssetLocationPolicy, AssetUploadIntentDefinition, AuthInput, FunctionManifest, FunctionRuntime,
    HandlerInput, IbexModule, MutationOutput,
};

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
    connection: Option<crate::auth::invalidation::AuthorizationInvalidationConnection>,
    effect_fence: Option<crate::ephemeral::ConnectionEffectFence>,
    session_mode: bool,
) -> LiveInvalidationAdmission {
    LiveInvalidationAdmission {
        connection,
        effect_fence,
        session_mode,
    }
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

pub fn asset_store_obj(
    snapback: &LocalSnapback,
) -> SnapbackResult<std::sync::Arc<dyn crate::assets_store::AssetStore>> {
    snapback.asset_store_obj()
}

pub fn prepare_subscribe_live_for_transport(
    snapback: &mut LocalSnapback,
    name: String,
    input: LiveSubscribeInput,
    authority: PreparedAuthority,
    invalidation: LiveInvalidationAdmission,
) -> SnapbackResult<PreparedLiveSubscribe> {
    snapback.prepare_subscribe_live_for_transport(name, input, authority, invalidation)
}

pub fn subscribe_live_prepared_with_invalidation(
    snapback: &mut LocalSnapback,
    name: &str,
    input: LiveSubscribeInput,
    authority: PreparedAuthority,
    invalidation: LiveInvalidationAdmission,
) -> SnapbackResult<LiveSubscribeOutput> {
    snapback.subscribe_live_prepared_with_invalidation(name, input, authority, invalidation)
}

pub fn invoke_mutation_with_authority(
    snapback: &mut LocalSnapback,
    name: &str,
    input: HandlerInput,
    authority: PreparedAuthority,
) -> SnapbackResult<MutationOutput> {
    snapback.invoke_mutation_with_authority(name, input, authority)
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
