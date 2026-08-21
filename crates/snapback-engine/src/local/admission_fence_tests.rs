use super::*;
use crate::auth::identity_core::AuthClaimsProjection;
use crate::auth::invocation::{
    InvocationGate, InvocationSource, PreparedAuthority, ResolvedAppAuthority, WireAuthorityFields,
};
use crate::auth::mode::{
    AuthModeStateRecord, AuthProgramReadiness, DeploymentIdentity, FUNCTION_V1_PREFIX,
    INPUTS_V1_PREFIX, SCHEMA_V1_PREFIX,
};
use crate::contract_types::{AgentsManifest, AgentsMode, ApiManifest, InvitedBy};
use crate::ids::{self, Kind};
use crate::manifest::{
    AuthManifest, AuthMode, SNAPBACK_SESSIONS_SCHEMA_VERSION, SchemaManifest, TargetCapabilityId,
};
use crate::push::{
    PushAppScopeV1, PushAudienceAuthorizeV1, PushAudienceDeclarationV1, PushAudienceReferenceV1,
    PushAudienceResolverV1, PushLedgerDeclarationV1, PushRegistryDeclarationV1,
    PushSeamDeclarationV1, PushSendRequestV1, PushTriggerModeV1,
};
use crate::storage::capability_links::{
    CapabilityLinkFunctionKind, MintCapabilityLink, MintedCapabilityLink,
};
use serde_json::Map;
use std::collections::BTreeMap;
use std::io::{Read, Seek, SeekFrom};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

const USER_ID: &str = "admission-fence-user";
const SESSION_ID: &str = "admission-fence-session";
const AUTHORITY_INSTANCE_ID: &str = "admission-fence-authority";
const NOW_MS: u64 = 1_000;

fn sessions_deployment() -> DeploymentIdentity {
    let digest = |prefix: &str, byte: char| format!("{prefix}{}", byte.to_string().repeat(64));
    DeploymentIdentity {
        schema_version: "snapback.v1".to_owned(),
        auth_mode: AuthMode::Sessions,
        app_id: "admission-fence-app".to_owned(),
        schema_hash: digest(SCHEMA_V1_PREFIX, 'a'),
        bundle_hash: digest(FUNCTION_V1_PREFIX, 'b'),
        inputs_hash: digest(INPUTS_V1_PREFIX, 'c'),
    }
}

fn settled_sessions_state() -> AuthModeStateRecord {
    let deployment = sessions_deployment();
    let mut state = AuthModeStateRecord::initial_dev(Some(deployment.clone()));
    state.transition_generation = 1;
    state.active = AuthMode::Sessions;
    state.desired = AuthMode::Sessions;
    state.sessions_ever_activated = true;
    state.active_deployment = Some(deployment);
    state.validate_shape().expect("settled sessions state");
    state
}

fn synchronize_sessions(snapback: &LocalSnapback) -> AdmissionController {
    snapback
        .synchronize_auth_mode_admission(&settled_sessions_state())
        .expect("publish sessions admission");
    snapback.admission_controller()
}

fn prepare_authority(
    controller: &AdmissionController,
    source: InvocationSource,
    resolved: ResolvedAppAuthority,
) -> PreparedAuthority {
    let session_claims = matches!(resolved, ResolvedAppAuthority::Session { .. })
        .then(|| AuthClaimsProjection::server_derived(Vec::new(), Vec::new()));
    InvocationGate::prepare_admitted_authority(
        source,
        AuthMode::Sessions,
        ServerProfile::Test,
        controller
            .admit_for_mode(AuthMode::Sessions)
            .expect("managed sessions admission"),
        &WireAuthorityFields::default(),
        resolved,
        session_claims,
    )
    .expect("prepared managed authority")
}

fn session_management_authority(controller: &AdmissionController) -> PreparedAuthority {
    prepare_authority(
        controller,
        InvocationSource::CapabilityLinkManagement,
        ResolvedAppAuthority::Session {
            user_id: USER_ID.to_owned(),
            session_id: SESSION_ID.to_owned(),
            provider: "email-code".to_owned(),
            generation: 1,
            authority_instance_id: AUTHORITY_INSTANCE_ID.to_owned(),
            session_not_after_ms: u64::MAX,
            provider_not_after_ms: None,
            rehearsal_provenance: None,
        },
    )
}

fn link_invocation_authority(controller: &AdmissionController) -> PreparedAuthority {
    prepare_authority(
        controller,
        InvocationSource::HttpCapabilityLink,
        ResolvedAppAuthority::Anonymous,
    )
}

fn system_authority(controller: &AdmissionController) -> PreparedAuthority {
    prepare_authority(
        controller,
        InvocationSource::Cron,
        ResolvedAppAuthority::System,
    )
}

fn retire_at_next_effect(
    site: AdmissionEffectSite,
    controller: AdmissionController,
) -> Arc<AtomicBool> {
    let fired = Arc::new(AtomicBool::new(false));
    let fired_in_hook = fired.clone();
    BEFORE_ADMISSION_EFFECT_GUARD_HOOK.with(|slot| {
        assert!(
            slot.borrow().is_none(),
            "an admission-effect retirement hook is already installed"
        );
        *slot.borrow_mut() = Some(Box::new(move |observed| {
            assert_eq!(observed, site, "retirement reached the wrong durable write");
            let error = match controller.retire_current_epoch_for_test() {
                Ok(_) => panic!("an in-flight admitted authority must force timeout retirement"),
                Err(error) => error,
            };
            assert_eq!(
                error.diagnostic.code, "SNAPBACK_AUTH_MODE_QUIESCENCE_TIMEOUT",
                "the hook must retire the in-flight epoch, not merely close admission"
            );
            fired_in_hook.store(true, Ordering::SeqCst);
        }));
    });
    fired
}

fn assert_retired_refusal(error: &SnapbackError, fired: &AtomicBool) {
    assert!(
        fired.load(Ordering::SeqCst),
        "the epoch must retire after prevalidation and before the durable effect"
    );
    assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_MODE_PENDING");
}

fn durable_database_image(snapback: &LocalSnapback) -> Vec<u8> {
    let mut image = tempfile::tempfile().expect("temporary database image");
    snapback
        .backup_database_image_into(&image)
        .expect("capture complete database image");
    image.seek(SeekFrom::Start(0)).expect("rewind image");
    let mut bytes = Vec::new();
    image.read_to_end(&mut bytes).expect("read database image");
    bytes
}

fn capability_link_fixture() -> (LocalSnapback, AdmissionController) {
    let mut snapback = LocalSnapback::memory().expect("capability-link fence database");
    let deployment = sessions_deployment();
    let manifest = SchemaManifest {
        schema_version: SNAPBACK_SESSIONS_SCHEMA_VERSION.to_owned(),
        app_id: deployment.app_id.clone(),
        schema_hash: Some(deployment.schema_hash.clone()),
        inputs_hash: Some(deployment.inputs_hash.clone()),
        auth: Some(AuthManifest {
            mode: AuthMode::Sessions,
            agents: Some(AgentsManifest::explicit(
                AgentsMode::Disabled,
                InvitedBy::Operators,
            )),
            password_identifier_mode: None,
            password_minimum_length: None,
        }),
        api: Some(ApiManifest {
            enabled: true,
            ..ApiManifest::default()
        }),
        required_capabilities: vec![TargetCapabilityId::AuthSessionsV1.to_string()],
        ..SchemaManifest::default()
    };
    snapback
        .auth_database_mut()
        .stage_auth_mode(deployment, manifest, None)
        .expect("stage capability-link sessions deployment");
    let settled = snapback
        .auth_database_mut()
        .consume_sessions_auth_mode(&AuthProgramReadiness::new(
            true, true, true, true, true, true, false,
        ))
        .expect("activate capability-link sessions deployment");
    snapback
        .auth_database_mut()
        .auth_catalog()
        .insert_human_user_for_test(USER_ID, NOW_MS)
        .expect("insert live human minter");
    snapback
        .synchronize_auth_mode_admission(&settled)
        .expect("publish capability-link sessions admission");
    let controller = snapback.admission_controller();
    (snapback, controller)
}

fn link_request(remaining_uses: Option<u64>) -> MintCapabilityLink {
    MintCapabilityLink {
        minter_principal_id: USER_ID.to_owned(),
        minter_session_id: SESSION_ID.to_owned(),
        minter_authority_instance_id: AUTHORITY_INSTANCE_ID.to_owned(),
        function_id: "fn:admissionFence".to_owned(),
        function_name: "admissionFence".to_owned(),
        function_kind: CapabilityLinkFunctionKind::Mutation,
        pinned_args_json: "{}".to_owned(),
        caller_args: Vec::new(),
        expires_at_ms: NOW_MS + 60_000,
        remaining_uses,
        approval_per_use: false,
        now_ms: NOW_MS,
    }
}

fn seed_link(snapback: &mut LocalSnapback, remaining_uses: u64) -> MintedCapabilityLink {
    snapback
        .auth_database_mut()
        .mint_capability_link(link_request(Some(remaining_uses)))
        .expect("seed capability link before fence proof")
}

#[test]
fn capability_link_mint_refuses_retired_epoch_without_a_durable_row() {
    let (mut snapback, controller) = capability_link_fixture();
    let authority = session_management_authority(&controller);
    let before = durable_database_image(&snapback);
    let fired = retire_at_next_effect(AdmissionEffectSite::CapabilityLinkMint, controller);

    let error = snapback
        .mint_capability_link(&authority, link_request(Some(1)))
        .expect_err("retired admission must refuse capability-link mint");

    assert_retired_refusal(&error, &fired);
    assert_eq!(
        durable_database_image(&snapback),
        before,
        "refused mint must not add a durable capability-link row"
    );
}

#[test]
fn capability_link_revoke_refuses_retired_epoch_without_changing_the_row() {
    let (mut snapback, controller) = capability_link_fixture();
    let minted = seed_link(&mut snapback, 1);
    let authority = session_management_authority(&controller);
    let before = durable_database_image(&snapback);
    let fired = retire_at_next_effect(AdmissionEffectSite::CapabilityLinkRevoke, controller);

    let error = snapback
        .revoke_capability_link(&authority, &minted.record.id, NOW_MS + 1)
        .expect_err("retired admission must refuse capability-link revoke");

    assert_retired_refusal(&error, &fired);
    assert_eq!(
        durable_database_image(&snapback),
        before,
        "refused revoke must not update the durable capability-link row"
    );
    snapback
        .resolve_capability_link(&minted.token, NOW_MS + 2)
        .expect("refused revoke leaves the link active");
}

#[test]
fn capability_link_consume_refuses_retired_epoch_without_consuming_the_row() {
    let (mut snapback, controller) = capability_link_fixture();
    let minted = seed_link(&mut snapback, 1);
    let link = snapback
        .resolve_capability_link(&minted.token, NOW_MS + 1)
        .expect("resolve consume fixture");
    let authority = link_invocation_authority(&controller);
    let before = durable_database_image(&snapback);
    let fired = retire_at_next_effect(AdmissionEffectSite::CapabilityLinkConsume, controller);

    let error = snapback
        .consume_capability_link_use(&authority, &link, NOW_MS + 2)
        .expect_err("retired admission must refuse capability-link use consumption");

    assert_retired_refusal(&error, &fired);
    assert_eq!(
        durable_database_image(&snapback),
        before,
        "refused consume must not update the durable capability-link row"
    );
    let unchanged = snapback
        .resolve_capability_link(&minted.token, NOW_MS + 3)
        .expect("refused consume leaves the one-use link available");
    assert_eq!(unchanged.record.remaining_uses, Some(1));
    assert_eq!(unchanged.record.use_count, 0);
    assert_eq!(unchanged.record.last_outcome, None);
}

#[test]
fn capability_link_settle_refuses_retired_epoch_without_settling_the_row() {
    let (mut snapback, controller) = capability_link_fixture();
    let minted = seed_link(&mut snapback, 2);
    let link = snapback
        .resolve_capability_link(&minted.token, NOW_MS + 1)
        .expect("resolve settlement fixture");
    let consume_authority = link_invocation_authority(&controller);
    let consumed = snapback
        .consume_capability_link_use(&consume_authority, &link, NOW_MS + 2)
        .expect("seed admitted use before settlement fence proof");
    drop(consume_authority);
    let authority = link_invocation_authority(&controller);
    let before = durable_database_image(&snapback);
    let fired = retire_at_next_effect(AdmissionEffectSite::CapabilityLinkSettle, controller);

    let error = snapback
        .settle_capability_link_use(&authority, consumed, "ok", NOW_MS + 3)
        .expect_err("retired admission must refuse capability-link use settlement");

    assert_retired_refusal(&error, &fired);
    assert_eq!(
        durable_database_image(&snapback),
        before,
        "refused settlement must not update the durable capability-link row"
    );
    let unchanged = snapback
        .resolve_capability_link(&minted.token, NOW_MS + 4)
        .expect("one remaining use keeps the link observable");
    assert_eq!(unchanged.record.remaining_uses, Some(1));
    assert_eq!(unchanged.record.use_count, 1);
    assert_eq!(unchanged.record.last_outcome.as_deref(), Some("admitted"));
}

fn push_declaration() -> PushSeamDeclarationV1 {
    PushSeamDeclarationV1 {
        app_scope: PushAppScopeV1 {
            eas_project_id: "admission-fence-project".to_owned(),
            application_id: "com.example.admission-fence".to_owned(),
            environment: "test".to_owned(),
        },
        registry: PushRegistryDeclarationV1 {
            idle_retention_ms: 86_400_000,
        },
        audiences: BTreeMap::from([(
            "empty".to_owned(),
            PushAudienceDeclarationV1 {
                resolve: PushAudienceResolverV1::ExplicitPrincipals {
                    principals_arg: "principalIds".to_owned(),
                    max_items: 1,
                },
                authorize: PushAudienceAuthorizeV1::System,
            },
        )]),
        uses: Vec::new(),
        ledger: Some(PushLedgerDeclarationV1 {
            retention_ms: 86_400_000,
        }),
    }
}

#[test]
fn push_reservation_refuses_retired_epoch_without_a_durable_intent() {
    let mut snapback = LocalSnapback::memory().expect("push fence database");
    snapback
        .auth_database_mut()
        .push_registry()
        .activate_current_auth_catalog()
        .expect("activate auth catalog");
    let declaration = push_declaration();
    snapback
        .auth_database_mut()
        .push_registry()
        .activate_push_registry_for_test(declaration.clone())
        .expect("activate push registry");
    let controller = synchronize_sessions(&snapback);
    let authority = system_authority(&controller);
    let request = PushSendRequestV1 {
        to: PushAudienceReferenceV1 {
            audience: "empty".to_owned(),
            args: Map::from_iter([(
                "principalIds".to_owned(),
                serde_json::json!([ids::mint(Kind::User).expect("unregistered principal")]),
            )]),
        },
        title: "retirement fence".to_owned(),
        body: "must not persist".to_owned(),
        data: None,
        dedupe_key: "retired-admission".to_owned(),
        redrive_ambiguous: false,
    };
    let fired = retire_at_next_effect(AdmissionEffectSite::PushReservation, controller.clone());

    let error = match snapback.reserve_push_send(
        &authority,
        PushTriggerModeV1::System,
        None,
        &request,
        NOW_MS,
    ) {
        Ok(_) => panic!("retired admission must refuse push reservation"),
        Err(error) => error,
    };

    assert_retired_refusal(&error, &fired);
    let fresh_authority = system_authority(&controller);
    let (retry, _) = snapback
        .reserve_push_send(
            &fresh_authority,
            PushTriggerModeV1::System,
            None,
            &request,
            NOW_MS + 1,
        )
        .expect("fresh admission reserves after the refused attempt");
    assert!(
        !retry.response.deduplicated,
        "a deduplicated retry would prove the retired attempt left a durable intent row"
    );
    assert_eq!(retry.response.target_count, 0);
    assert_eq!(retry.response.batch_count, 0);
}
