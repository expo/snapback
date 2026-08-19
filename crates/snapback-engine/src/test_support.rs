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
use crate::local::{
    LiveInvalidationAdmission, LiveSubscribeInput, LiveSubscribeOutput, PreparedLiveSubscribe,
};
use crate::manifest::{
    AssetAcceptPolicy, AssetAccessPolicy, AssetDeliveryPolicy, AssetImagePolicy, AssetImageVariant,
    AssetLocationPolicy, AssetUploadIntentDefinition, AuthInput, FunctionManifest, FunctionRuntime,
    HandlerInput, IbexModule,
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
    snapback.require_host_plan_for_test_support(&name)?;
    snapback.prepare_subscribe_live_for_transport(name, input, authority, invalidation)
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
