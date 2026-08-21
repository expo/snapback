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
    PushAudienceResolverV1, PushBatchClaimV1, PushBatchSettlementV1, PushLedgerDeclarationV1,
    PushRegistryDeclarationV1, PushSeamDeclarationV1, PushSendRequestV1, PushTriggerModeV1,
};
use crate::storage::capability_links::{
    CapabilityLinkFunctionKind, MintCapabilityLink, MintedCapabilityLink,
};
use serde_json::Map;
use std::collections::BTreeMap;
use std::io::{Read, Seek, SeekFrom};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError, sync_channel};
use std::thread::{self, JoinHandle};
use std::time::Duration;

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

const RETIREMENT_START_TIMEOUT: Duration = Duration::from_secs(2);
const RETIREMENT_BLOCK_OBSERVATION: Duration = Duration::from_millis(50);
const RETIREMENT_FINISH_TIMEOUT: Duration = Duration::from_secs(2);

struct LiveRetirementProbe {
    site: AdmissionEffectSite,
    commit_completed: Arc<AtomicBool>,
    finished: Receiver<(String, bool)>,
    worker: JoinHandle<()>,
}

thread_local! {
    static LIVE_RETIREMENT_PROBE: std::cell::RefCell<Option<LiveRetirementProbe>> =
        const { std::cell::RefCell::new(None) };
}

/// Install a one-shot probe that runs only after the production guard call.
/// It observes the admission mutex as locked, starts retirement on a second
/// thread, and proves retirement cannot return during a bounded window while
/// the guard remains live. The commit hook then records the successful durable
/// operation before the guard leaves scope.
fn retire_during_next_effect(site: AdmissionEffectSite, controller: AdmissionController) {
    AFTER_ADMISSION_EFFECT_GUARD_HOOK.with(|slot| {
        assert!(
            slot.borrow().is_none(),
            "an after-guard admission-effect hook is already installed"
        );
        *slot.borrow_mut() = Some(Box::new(move |observed| {
            assert_eq!(
                observed, site,
                "live retirement reached the wrong durable write"
            );
            assert!(
                !controller.state_mutex_available_for_test(),
                "{site:?} admission-state mutex was available after the effect-guard statement; \
                 the guard was never acquired or was dropped before the durable write"
            );

            let commit_completed = Arc::new(AtomicBool::new(false));
            let commit_seen_by_worker = commit_completed.clone();
            let (started_tx, started_rx) = sync_channel(0);
            let (finished_tx, finished) = sync_channel(1);
            let worker = thread::spawn(move || {
                if started_tx.send(()).is_err() {
                    return;
                }
                let outcome = match controller.retire_current_epoch_for_test() {
                    Ok(_) => "unexpected-success".to_owned(),
                    Err(error) => error.diagnostic.code,
                };
                let saw_commit = commit_seen_by_worker.load(Ordering::SeqCst);
                let _ = finished_tx.send((outcome, saw_commit));
            });

            started_rx
                .recv_timeout(RETIREMENT_START_TIMEOUT)
                .expect("retirement worker did not start before the clean timeout");
            match finished.recv_timeout(RETIREMENT_BLOCK_OBSERVATION) {
                Err(RecvTimeoutError::Timeout) => {}
                Ok((outcome, saw_commit)) => {
                    worker.join().expect("premature retirement worker panicked");
                    panic!(
                        "{site:?} retirement returned while the durable effect should hold the \
                         admission mutex: outcome={outcome}, commit_completed={saw_commit}"
                    );
                }
                Err(RecvTimeoutError::Disconnected) => {
                    worker.join().expect("retirement worker panicked");
                    panic!("{site:?} retirement worker disconnected before the commit");
                }
            }

            LIVE_RETIREMENT_PROBE.with(|probe| {
                assert!(
                    probe.borrow().is_none(),
                    "a live retirement probe is already pending"
                );
                *probe.borrow_mut() = Some(LiveRetirementProbe {
                    site,
                    commit_completed: commit_completed.clone(),
                    finished,
                    worker,
                });
            });
            AFTER_ADMISSION_EFFECT_COMMIT_HOOK.with(|slot| {
                assert!(
                    slot.borrow().is_none(),
                    "an admission-effect commit hook is already installed"
                );
                *slot.borrow_mut() = Some(Box::new(move |committed_site| {
                    assert_eq!(committed_site, site, "the wrong durable commit completed");
                    LIVE_RETIREMENT_PROBE.with(|probe| {
                        let probe = probe.borrow();
                        let probe = probe.as_ref().expect("live retirement probe exists");
                        assert_eq!(probe.site, site);
                        assert!(
                            matches!(
                                probe.finished.try_recv(),
                                Err(std::sync::mpsc::TryRecvError::Empty)
                            ),
                            "{site:?} retirement returned before the durable commit completed"
                        );
                        probe.commit_completed.store(true, Ordering::SeqCst);
                    });
                }));
            });
        }));
    });
}

fn assert_retirement_followed_commit(site: AdmissionEffectSite) {
    let probe = LIVE_RETIREMENT_PROBE.with(|slot| {
        slot.borrow_mut()
            .take()
            .expect("the successful effect must install a live retirement probe")
    });
    assert_eq!(probe.site, site);
    assert!(
        probe.commit_completed.load(Ordering::SeqCst),
        "{site:?} durable commit hook did not run while the guard was live"
    );
    let (outcome, worker_saw_commit) = match probe.finished.recv_timeout(RETIREMENT_FINISH_TIMEOUT)
    {
        Ok(result) => result,
        Err(RecvTimeoutError::Timeout) => {
            drop(probe.worker);
            panic!("{site:?} retirement did not finish after the guard dropped")
        }
        Err(RecvTimeoutError::Disconnected) => {
            probe.worker.join().expect("retirement worker panicked");
            panic!("{site:?} retirement worker disconnected after the commit")
        }
    };
    probe.worker.join().expect("retirement worker panicked");
    assert_eq!(
        outcome, "SNAPBACK_AUTH_MODE_QUIESCENCE_TIMEOUT",
        "the in-flight authority must make the post-commit test retirement retire the epoch"
    );
    assert!(
        worker_saw_commit,
        "{site:?} retirement returned before observing the completed durable commit"
    );
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
    let fired = retire_at_next_effect(AdmissionEffectSite::CapabilityLinkMint, controller.clone());

    let error = snapback
        .mint_capability_link(&authority, link_request(Some(1)))
        .expect_err("retired admission must refuse capability-link mint");

    assert_retired_refusal(&error, &fired);
    assert_eq!(
        durable_database_image(&snapback),
        before,
        "refused mint must not add a durable capability-link row"
    );

    let authority = session_management_authority(&controller);
    let before_commit = durable_database_image(&snapback);
    retire_during_next_effect(AdmissionEffectSite::CapabilityLinkMint, controller);
    let minted = snapback
        .mint_capability_link(&authority, link_request(Some(1)))
        .expect("live admission guard permits capability-link mint");
    assert_ne!(
        durable_database_image(&snapback),
        before_commit,
        "the successful guarded mint must be durable"
    );
    snapback
        .resolve_capability_link(&minted.token, NOW_MS + 1)
        .expect("the guarded mint is durably resolvable");
    assert_retirement_followed_commit(AdmissionEffectSite::CapabilityLinkMint);
}

#[test]
fn capability_link_revoke_refuses_retired_epoch_without_changing_the_row() {
    let (mut snapback, controller) = capability_link_fixture();
    let minted = seed_link(&mut snapback, 1);
    let authority = session_management_authority(&controller);
    let before = durable_database_image(&snapback);
    let fired = retire_at_next_effect(
        AdmissionEffectSite::CapabilityLinkRevoke,
        controller.clone(),
    );

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

    let authority = session_management_authority(&controller);
    let before_commit = durable_database_image(&snapback);
    retire_during_next_effect(AdmissionEffectSite::CapabilityLinkRevoke, controller);
    snapback
        .revoke_capability_link(&authority, &minted.record.id, NOW_MS + 3)
        .expect("live admission guard permits capability-link revoke");
    assert_ne!(
        durable_database_image(&snapback),
        before_commit,
        "the successful guarded revoke must be durable"
    );
    assert_eq!(
        snapback
            .resolve_capability_link(&minted.token, NOW_MS + 4)
            .expect_err("the guarded revoke is durably visible")
            .diagnostic
            .code,
        "SNAPBACK_CAPABILITY_LINK_UNAVAILABLE"
    );
    assert_retirement_followed_commit(AdmissionEffectSite::CapabilityLinkRevoke);
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
    let fired = retire_at_next_effect(
        AdmissionEffectSite::CapabilityLinkConsume,
        controller.clone(),
    );

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

    let authority = link_invocation_authority(&controller);
    let before_commit = durable_database_image(&snapback);
    retire_during_next_effect(AdmissionEffectSite::CapabilityLinkConsume, controller);
    let consumed = snapback
        .consume_capability_link_use(&authority, &link, NOW_MS + 4)
        .expect("live admission guard permits capability-link consumption");
    assert_eq!(consumed.link_id, minted.record.id);
    assert_ne!(
        durable_database_image(&snapback),
        before_commit,
        "the successful guarded consume must be durable"
    );
    assert_eq!(
        snapback
            .resolve_capability_link(&minted.token, NOW_MS + 5)
            .expect_err("the guarded consume exhausts the one-use link")
            .diagnostic
            .code,
        "SNAPBACK_CAPABILITY_LINK_UNAVAILABLE"
    );
    assert_retirement_followed_commit(AdmissionEffectSite::CapabilityLinkConsume);
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
    let successful_settlement_use = ConsumedCapabilityLinkUse {
        link_id: consumed.link_id.clone(),
        ordinal: consumed.ordinal,
    };
    drop(consume_authority);
    let authority = link_invocation_authority(&controller);
    let before = durable_database_image(&snapback);
    let fired = retire_at_next_effect(
        AdmissionEffectSite::CapabilityLinkSettle,
        controller.clone(),
    );

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

    let authority = link_invocation_authority(&controller);
    let before_commit = durable_database_image(&snapback);
    retire_during_next_effect(AdmissionEffectSite::CapabilityLinkSettle, controller);
    snapback
        .settle_capability_link_use(&authority, successful_settlement_use, "ok", NOW_MS + 5)
        .expect("live admission guard permits capability-link settlement");
    assert_ne!(
        durable_database_image(&snapback),
        before_commit,
        "the successful guarded settlement must be durable"
    );
    let settled = snapback
        .resolve_capability_link(&minted.token, NOW_MS + 6)
        .expect("one remaining use keeps the settled link observable");
    assert_eq!(settled.record.remaining_uses, Some(1));
    assert_eq!(settled.record.use_count, 1);
    assert_eq!(settled.record.last_outcome.as_deref(), Some("ok"));
    assert_retirement_followed_commit(AdmissionEffectSite::CapabilityLinkSettle);
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

fn push_batch_fixture() -> (LocalSnapback, AdmissionController, String) {
    let mut snapback = LocalSnapback::memory().expect("push batch fence database");
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
    let principal_id = ids::mint(Kind::User).expect("push target principal");
    let session_id = ids::mint(Kind::Session).expect("push target session");
    let installation_id = ids::mint(Kind::Installation).expect("push target installation");
    {
        let mut registry = snapback.auth_database_mut().push_registry();
        registry
            .insert_session_for_test(&principal_id, &session_id, 1, 4_000_000_000_000, 41)
            .expect("insert push target session");
        registry
            .register(
                &declaration,
                &principal_id,
                &session_id,
                1,
                &installation_id,
                "ExponentPushToken[admission-fence]",
                NOW_MS,
            )
            .expect("register push target token");
    }
    let controller = synchronize_sessions(&snapback);
    let authority = system_authority(&controller);
    let request = PushSendRequestV1 {
        to: PushAudienceReferenceV1 {
            audience: "empty".to_owned(),
            args: Map::from_iter([("principalIds".to_owned(), serde_json::json!([principal_id]))]),
        },
        title: "guarded push batch".to_owned(),
        body: "must commit before retirement".to_owned(),
        data: None,
        dedupe_key: ids::mint_time_ordered(Kind::PushIntent),
        redrive_ambiguous: false,
    };
    let (attempt, _) = snapback
        .reserve_push_send(
            &authority,
            PushTriggerModeV1::System,
            None,
            &request,
            NOW_MS + 1,
        )
        .expect("reserve one push batch fixture");
    assert_eq!(attempt.response.target_count, 1);
    assert_eq!(attempt.response.batch_count, 1);
    assert_eq!(attempt.batches.len(), 1);
    (snapback, controller, attempt.batches[0].batch_id.clone())
}

fn claim_push_batch_fixture(
    snapback: &mut LocalSnapback,
    controller: &AdmissionController,
    batch_id: &str,
    now_ms: u64,
) -> PushBatchClaimV1 {
    let authority = system_authority(controller);
    snapback
        .claim_push_batch(&authority, batch_id, now_ms)
        .expect("claim push batch fixture")
        .expect("reserved push batch remains claimable")
}

#[test]
fn push_batch_claim_refuses_retired_epoch_and_holds_the_guard_through_commit() {
    let (mut snapback, controller, batch_id) = push_batch_fixture();
    let authority = system_authority(&controller);
    let before = durable_database_image(&snapback);
    let fired = retire_at_next_effect(AdmissionEffectSite::PushBatchClaim, controller.clone());

    let error = match snapback.claim_push_batch(&authority, &batch_id, NOW_MS + 2) {
        Ok(_) => panic!("retired admission must refuse push batch claim"),
        Err(error) => error,
    };

    assert_retired_refusal(&error, &fired);
    assert_eq!(
        durable_database_image(&snapback),
        before,
        "refused claim must not change the durable push batch"
    );

    let authority = system_authority(&controller);
    retire_during_next_effect(AdmissionEffectSite::PushBatchClaim, controller);
    let claim = snapback
        .claim_push_batch(&authority, &batch_id, NOW_MS + 3)
        .expect("live admission guard permits push batch claim")
        .expect("guarded push batch remains claimable");
    assert_eq!(claim.batch_id, batch_id);
    assert_ne!(
        durable_database_image(&snapback),
        before,
        "the successful guarded claim must be durable"
    );
    assert_retirement_followed_commit(AdmissionEffectSite::PushBatchClaim);
}

#[test]
fn push_transmitting_marker_refuses_retired_epoch_and_holds_the_guard_through_commit() {
    let (mut snapback, controller, batch_id) = push_batch_fixture();
    let claim = claim_push_batch_fixture(&mut snapback, &controller, &batch_id, NOW_MS + 2);
    let authority = system_authority(&controller);
    let before = durable_database_image(&snapback);
    let fired = retire_at_next_effect(
        AdmissionEffectSite::PushBatchTransmitting,
        controller.clone(),
    );

    let error = snapback
        .mark_push_batch_transmitting(&authority, &claim, NOW_MS + 3)
        .expect_err("retired admission must refuse push transmitting marker");

    assert_retired_refusal(&error, &fired);
    assert_eq!(
        durable_database_image(&snapback),
        before,
        "refused transmitting marker must not change the durable push batch"
    );

    let authority = system_authority(&controller);
    retire_during_next_effect(AdmissionEffectSite::PushBatchTransmitting, controller);
    snapback
        .mark_push_batch_transmitting(&authority, &claim, NOW_MS + 4)
        .expect("live admission guard permits push transmitting marker");
    assert_ne!(
        durable_database_image(&snapback),
        before,
        "the successful guarded transmitting marker must be durable"
    );
    assert_retirement_followed_commit(AdmissionEffectSite::PushBatchTransmitting);
}

#[test]
fn push_batch_settlement_refuses_retired_epoch_and_holds_the_guard_through_commit() {
    let (mut snapback, controller, batch_id) = push_batch_fixture();
    let claim = claim_push_batch_fixture(&mut snapback, &controller, &batch_id, NOW_MS + 2);
    let authority = system_authority(&controller);
    snapback
        .mark_push_batch_transmitting(&authority, &claim, NOW_MS + 3)
        .expect("mark push batch transmitting fixture");
    drop(authority);
    let settlement = PushBatchSettlementV1::Ambiguous {
        code: "timeout".to_owned(),
    };
    let authority = system_authority(&controller);
    let before = durable_database_image(&snapback);
    let fired = retire_at_next_effect(AdmissionEffectSite::PushBatchSettlement, controller.clone());

    let error = snapback
        .settle_push_batch(&authority, &claim, &settlement, NOW_MS + 4)
        .expect_err("retired admission must refuse push batch settlement");

    assert_retired_refusal(&error, &fired);
    assert_eq!(
        durable_database_image(&snapback),
        before,
        "refused settlement must not change the durable push batch"
    );

    let authority = system_authority(&controller);
    retire_during_next_effect(AdmissionEffectSite::PushBatchSettlement, controller);
    snapback
        .settle_push_batch(&authority, &claim, &settlement, NOW_MS + 5)
        .expect("live admission guard permits push batch settlement");
    assert_ne!(
        durable_database_image(&snapback),
        before,
        "the successful guarded settlement must be durable"
    );
    assert_retirement_followed_commit(AdmissionEffectSite::PushBatchSettlement);
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
    retire_during_next_effect(AdmissionEffectSite::PushReservation, controller);
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
    assert_retirement_followed_commit(AdmissionEffectSite::PushReservation);
}
