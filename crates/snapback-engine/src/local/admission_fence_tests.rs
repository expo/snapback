use super::*;
use crate::auth::invocation::{
    InvocationGate, InvocationSource, PreparedAuthority, ResolvedAppAuthority, WireAuthorityFields,
};
use crate::auth::mode::{
    AuthModeStateRecord, AuthProgramReadiness, DeploymentIdentity, FUNCTION_V1_PREFIX,
    INPUTS_V1_PREFIX, SCHEMA_V1_PREFIX,
};
use crate::contract_types::{
    AgentsManifest, AgentsMode, ApiAskBilling, ApiAskBudgets, ApiAskManifest, ApiAskModelManifest,
    ApiAskPerPrincipalDayBudget, ApiAskPerRequestBudget, ApiAskResultVolumeBudget,
    ApiAskTokenBudget, ApiBudgetsManifest, ApiManifest, InvitedBy,
};
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
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};

const USER_ID: &str = "018f0d90-7b22-7a22-8c33-445566778899";
const SESSION_ID: &str = "018f0d90-7b23-7a22-8c33-445566778899";
const AUTHORITY_INSTANCE_ID: &str = "018f0d90-7b24-7a22-8c33-445566778899";
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

fn session_management_authority(snapback: &mut LocalSnapback) -> PreparedAuthority {
    session_authority_for_source(snapback, InvocationSource::CapabilityLinkManagement)
}

fn session_authority_for_source(
    snapback: &mut LocalSnapback,
    source: InvocationSource,
) -> PreparedAuthority {
    snapback.prepare_resolved_session_for_test(
        source,
        USER_ID,
        SESSION_ID,
        AUTHORITY_INSTANCE_ID,
        1,
        u64::MAX,
    )
}

fn link_invocation_authority(controller: &AdmissionController) -> PreparedAuthority {
    InvocationGate::prepare_admitted_subjectless_authority(
        InvocationSource::HttpCapabilityLink,
        AuthMode::Sessions,
        ServerProfile::Test,
        controller
            .admit_for_mode(AuthMode::Sessions)
            .expect("managed sessions admission"),
        &WireAuthorityFields::default(),
        ResolvedAppAuthority::Anonymous,
        None,
    )
    .expect("prepared link authority")
}

fn system_authority(controller: &AdmissionController) -> PreparedAuthority {
    InvocationGate::prepare_admitted_subjectless_authority(
        InvocationSource::Cron,
        AuthMode::Sessions,
        ServerProfile::Test,
        controller
            .admit_for_mode(AuthMode::Sessions)
            .expect("managed sessions admission"),
        &WireAuthorityFields::default(),
        ResolvedAppAuthority::System,
        None,
    )
    .expect("prepared system authority")
}

struct FenceRandom(AtomicU8);

impl FenceRandom {
    fn new() -> Self {
        Self(AtomicU8::new(1))
    }
}

impl crate::auth::crypto::RandomSource for FenceRandom {
    fn fill(&self, destination: &mut [u8]) -> Result<(), crate::auth::crypto::CryptoError> {
        destination.fill(self.0.fetch_add(1, Ordering::SeqCst));
        Ok(())
    }
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

/// Install a probe that runs only after the production guard call. It observes
/// test-only guard-lifetime bookkeeping there and at every SQLite commit
/// attempt owned by this operation. The probe never acquires or re-enters the
/// admission mutex it is proving held.
struct GuardCommitObservation {
    installed:
        std::rc::Rc<std::cell::RefCell<Option<crate::storage::DurableCommitObservationForTest>>>,
}

impl GuardCommitObservation {
    fn matching_commits(&self) -> usize {
        self.installed
            .borrow()
            .as_ref()
            .map_or(0, |observation| observation.matching_commits())
    }

    fn mismatched_commits(&self) -> usize {
        self.installed
            .borrow()
            .as_ref()
            .map_or(0, |observation| observation.mismatched_commits())
    }
}

fn observe_guard_through_next_commit(
    site: AdmissionEffectSite,
    controller: AdmissionController,
) -> GuardCommitObservation {
    let admission_epoch = controller.snapshot().admission_epoch;
    let expected_guard = controller.effect_guard_identity_for_test(admission_epoch);
    let installed = std::rc::Rc::new(std::cell::RefCell::new(None));
    let installed_in_hook = installed.clone();
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
                crate::auth::admission::current_thread_holds_admission_effect_guard_for_test(
                    &controller,
                    admission_epoch,
                ),
                "{site:?} admission effect guard was not live after the effect-guard statement; \
                 the guard was never acquired or was dropped before the durable write"
            );
            let observation = crate::storage::observe_next_durable_commits_for_test(
                site.durable_commit_count(),
                expected_guard,
            );
            *installed_in_hook.borrow_mut() = Some(observation);
        }));
    });
    GuardCommitObservation { installed }
}

fn assert_guard_observed_at_commit(site: AdmissionEffectSite, observed: &GuardCommitObservation) {
    assert_eq!(
        observed.matching_commits(),
        site.durable_commit_count(),
        "{site:?} commit-boundary hook did not observe the live effect guard at every durable commit"
    );
    assert_eq!(
        observed.mismatched_commits(),
        0,
        "{site:?} commit-boundary hook observed a commit without the exact controller/epoch guard"
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
    capability_link_fixture_with_agents_mode(AgentsMode::Disabled)
}

fn capability_link_fixture_with_agents_mode(
    agents_mode: AgentsMode,
) -> (LocalSnapback, AdmissionController) {
    let mut snapback = LocalSnapback::memory().expect("capability-link fence database");
    let deployment = sessions_deployment();
    let manifest = SchemaManifest {
        schema_version: SNAPBACK_SESSIONS_SCHEMA_VERSION.to_owned(),
        app_id: deployment.app_id.clone(),
        schema_hash: Some(deployment.schema_hash.clone()),
        inputs_hash: Some(deployment.inputs_hash.clone()),
        auth: Some(AuthManifest {
            mode: AuthMode::Sessions,
            agents: Some(AgentsManifest::explicit(agents_mode, InvitedBy::Operators)),
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

fn ask_spend_budgets() -> ApiAskBudgets {
    ApiAskBudgets {
        per_request: ApiAskPerRequestBudget {
            max_tokens: 10,
            max_steps: 3,
            max_wall_ms: 1_000,
        },
        per_principal_day: ApiAskPerPrincipalDayBudget { max_tokens: 100 },
        per_integration_day: None,
        app_monthly: ApiAskTokenBudget { max_tokens: 1_000 },
        result_volume: ApiAskResultVolumeBudget {
            max_bytes: 100,
            max_rows: 5,
            per_principal_day_bytes: 1_000,
        },
    }
}

fn ask_spend_fixture() -> (
    LocalSnapback,
    AdmissionController,
    PreparedAuthority,
    crate::storage::ask_spend::AskSpendSubject,
    ApiAskBudgets,
) {
    let mut snapback = LocalSnapback::memory().expect("ask spend fence database");
    let deployment = sessions_deployment();
    let budgets = ask_spend_budgets();
    let schema = SchemaManifest {
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
            ask: Some(ApiAskManifest {
                enabled: true,
                billing: ApiAskBilling::CallerKey,
                model: Some(ApiAskModelManifest {
                    provider: "openai-compatible".to_owned(),
                    model: "admission-fence".to_owned(),
                    secret: None,
                }),
            }),
            budgets: Some(ApiBudgetsManifest {
                ask: Some(budgets.clone()),
            }),
            ..ApiManifest::default()
        }),
        required_capabilities: vec![TargetCapabilityId::AuthSessionsV1.to_string()],
        ..SchemaManifest::default()
    };
    let functions = crate::manifest::FunctionManifest {
        schema_version: SNAPBACK_SESSIONS_SCHEMA_VERSION.to_owned(),
        app_id: deployment.app_id.clone(),
        bundle_hash: Some(deployment.bundle_hash.clone()),
        inputs_hash: Some(deployment.inputs_hash.clone()),
        ..crate::manifest::FunctionManifest::default()
    };
    let prepared = snapback
        .prepare_auth_provision(
            EnsureAppMode::Sessions,
            Some(schema),
            Some(functions.clone()),
            None,
        )
        .expect("preflight ask spend sessions deployment");
    snapback
        .commit_auth_provision(prepared, "test")
        .expect("stage ask spend sessions deployment");
    let settled = snapback
        .auth_database_mut()
        .consume_sessions_auth_mode_with_functions(
            &AuthProgramReadiness::new(true, true, true, true, true, true, true),
            &functions,
        )
        .expect("activate ask spend sessions deployment");
    snapback
        .synchronize_auth_mode_admission(&settled)
        .expect("publish ask spend sessions admission");
    let controller = snapback.admission_controller();
    let authority = session_authority_for_source(&mut snapback, InvocationSource::HttpAsk);
    let subject = crate::storage::ask_spend::AskSpendSubject {
        principal_key: format!("user:{USER_ID}"),
        integration_key: None,
    };
    (snapback, controller, authority, subject, budgets)
}

fn seed_link(snapback: &mut LocalSnapback, remaining_uses: u64) -> MintedCapabilityLink {
    snapback
        .auth_database_mut()
        .mint_capability_link(link_request(Some(remaining_uses)))
        .expect("seed capability link before fence proof")
}

fn client_mutation_acknowledgement_fixture() -> (
    LocalSnapback,
    AdmissionController,
    PreparedAuthority,
    String,
) {
    let mut snapback = LocalSnapback::memory().expect("client-mutation ACK fence database");
    snapback
        .apply_schema(SchemaManifest {
            app_id: "admission-fence-ack".to_owned(),
            schema_hash: Some("admission-fence-ack-schema".to_owned()),
            tables: vec![crate::manifest::TableManifest {
                name: "items".to_owned(),
                fields: vec![crate::manifest::FieldManifest {
                    name: "value".to_owned(),
                    field_type: crate::manifest::FieldType::String,
                    optional: false,
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
            }],
            ..SchemaManifest::default()
        })
        .expect("apply client-mutation ACK schema");
    let mut values = BTreeMap::new();
    values.insert(
        "value".to_owned(),
        crate::manifest::ValueExpr::Literal(serde_json::json!("guarded")),
    );
    let functions = crate::manifest::FunctionManifest {
        functions: vec![crate::manifest::FunctionDefinition::new(
            "ackSeed",
            crate::manifest::FunctionKind::Mutation,
            crate::manifest::FunctionRuntime::HostPlan(crate::manifest::HandlerPlan::Mutation(
                crate::manifest::MutationPlan {
                    owner_write_checks: Vec::new(),
                    steps: vec![crate::manifest::MutationStep::Insert {
                        table: "items".to_owned(),
                        values,
                        bind_id_as: None,
                    }],
                    return_value: Some(crate::manifest::ReturnValue::ChangedCount),
                },
            )),
        )],
        ..crate::manifest::FunctionManifest::default()
    };
    let diagnostics = snapback.load_functions(functions);
    assert!(
        diagnostics
            .iter()
            .all(|diagnostic| diagnostic.severity != crate::diagnostic::DiagnosticSeverity::Error),
        "client-mutation ACK function must load: {diagnostics:?}"
    );

    let controller = synchronize_sessions(&snapback);
    let authority = session_authority_for_source(&mut snapback, InvocationSource::HttpMutation);
    let descriptor = snapback
        .descriptor_for_prepared_authority(&authority)
        .expect("prepare client-mutation authority descriptor");
    let mutation_id = "cm_admission_fence_ack".to_owned();
    snapback
        .invoke_mutation_recording_with_authority_descriptor(
            "ackSeed",
            HandlerInput::default(),
            Some(mutation_id.clone()),
            Some(descriptor),
            "test",
            authority.clone(),
        )
        .0
        .expect("seed durable client-mutation settlement");
    (snapback, controller, authority, mutation_id)
}

fn watch_creation_fixture() -> (LocalSnapback, AdmissionController) {
    let mut snapback = LocalSnapback::memory().expect("watch creation fence database");
    let deployment = sessions_deployment();
    let exposure = crate::manifest::ApiFunctionExposure {
        expose: true,
        since: None,
        approval: None,
    };
    let schema = SchemaManifest {
        schema_version: SNAPBACK_SESSIONS_SCHEMA_VERSION.to_owned(),
        app_id: deployment.app_id.clone(),
        schema_hash: Some(deployment.schema_hash.clone()),
        inputs_hash: Some(deployment.inputs_hash.clone()),
        tables: vec![crate::manifest::TableManifest {
            name: "items".to_owned(),
            fields: vec![crate::manifest::FieldManifest {
                name: "value".to_owned(),
                field_type: crate::manifest::FieldType::String,
                optional: false,
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
        }],
        api: Some(ApiManifest {
            enabled: true,
            functions: BTreeMap::from([
                ("watchQuery".to_owned(), exposure.clone()),
                ("watchReaction".to_owned(), exposure.clone()),
            ]),
            ..ApiManifest::default()
        }),
        auth: Some(AuthManifest {
            mode: AuthMode::Sessions,
            agents: Some(AgentsManifest::explicit(
                AgentsMode::Disabled,
                InvitedBy::Operators,
            )),
            password_identifier_mode: None,
            password_minimum_length: None,
        }),
        required_capabilities: vec![TargetCapabilityId::AuthSessionsV1.to_string()],
        ..SchemaManifest::default()
    };
    let query_plan = crate::manifest::QueryPlan {
        table_visibility: None,
        table: "items".to_owned(),
        filters: Vec::new(),
        membership_filters: Vec::new(),
        order: Vec::new(),
        limit: None,
        indexed_by: None,
    };
    let mut query = crate::manifest::FunctionDefinition::new(
        "watchQuery",
        crate::manifest::FunctionKind::LiveQuery,
        crate::manifest::FunctionRuntime::HostPlan(crate::manifest::HandlerPlan::Query(
            query_plan.clone(),
        )),
    );
    query.auth_requirement = Some(crate::manifest::AuthRequirement::Authenticated);
    query.api_exposure = Some(exposure.clone());
    let mut reaction = crate::manifest::FunctionDefinition::new(
        "watchReaction",
        crate::manifest::FunctionKind::Query,
        crate::manifest::FunctionRuntime::HostPlan(crate::manifest::HandlerPlan::Query(query_plan)),
    );
    reaction.auth_requirement = Some(crate::manifest::AuthRequirement::Authenticated);
    reaction.api_exposure = Some(exposure);
    let functions = crate::manifest::FunctionManifest {
        schema_version: SNAPBACK_SESSIONS_SCHEMA_VERSION.to_owned(),
        app_id: deployment.app_id.clone(),
        bundle_hash: Some(deployment.bundle_hash.clone()),
        inputs_hash: Some(deployment.inputs_hash.clone()),
        functions: vec![query, reaction],
        ..crate::manifest::FunctionManifest::default()
    };
    let prepared = snapback
        .prepare_auth_provision(
            EnsureAppMode::Sessions,
            Some(schema),
            Some(functions.clone()),
            None,
        )
        .expect("preflight watch sessions deployment");
    snapback
        .commit_auth_provision(prepared, "test")
        .expect("stage watch sessions deployment");
    let settled = snapback
        .auth_database_mut()
        .consume_sessions_auth_mode_with_functions(
            &AuthProgramReadiness::new(true, true, true, true, true, true, true),
            &functions,
        )
        .expect("activate watch sessions deployment");
    snapback
        .synchronize_auth_mode_admission(&settled)
        .expect("publish watch sessions admission");
    let diagnostics =
        snapback.publish_preflighted_functions(functions, 1, DiagnosticBoundary::Attached);
    assert!(
        diagnostics
            .iter()
            .all(|diagnostic| diagnostic.severity != crate::diagnostic::DiagnosticSeverity::Error),
        "watch functions must load: {diagnostics:?}"
    );
    snapback
        .auth_database_mut()
        .push_registry()
        .insert_session_for_test(USER_ID, SESSION_ID, 1, 4_000_000_000_000, 73)
        .expect("insert active watch owner");
    let controller = snapback.admission_controller();
    (snapback, controller)
}

fn watch_request() -> crate::watches::CreateWatchSpec {
    crate::watches::CreateWatchSpec {
        query_function: "watchQuery".to_owned(),
        query_args: serde_json::json!({}),
        predicate: serde_json::json!({"path": "/rows", "op": "exists"}),
        reaction: crate::watches::WatchReactionSpec::Function {
            function: "watchReaction".to_owned(),
            args: serde_json::json!({}),
        },
        debounce_ms: crate::watches::DEFAULT_DEBOUNCE_MS,
        daily_firing_budget: crate::watches::DEFAULT_DAILY_FIRING_BUDGET,
    }
}

fn watch_webhook_request() -> crate::watches::CreateWatchSpec {
    crate::watches::CreateWatchSpec {
        predicate: serde_json::json!({"path": "/rows/0", "op": "exists"}),
        reaction: crate::watches::WatchReactionSpec::Webhook {
            // A literal public address keeps this durability test independent
            // of host DNS while still exercising production target policy.
            url: "https://93.184.216.34/admission-fence".to_owned(),
            secret: Some("admission-fence-webhook-secret".to_owned()),
        },
        ..watch_request()
    }
}

fn claimed_watch_fixture(
    request: crate::watches::CreateWatchSpec,
) -> (
    LocalSnapback,
    AdmissionController,
    crate::watches::CreatedWatch,
    AdmittedJobClaim,
) {
    let (mut snapback, controller) = watch_creation_fixture();
    let authority = session_authority_for_source(&mut snapback, InvocationSource::WatchManagement);
    let created = snapback
        .create_watch(&authority, request, NOW_MS)
        .expect("create watch job fence fixture");
    assert!(
        snapback
            .db
            .schedule_watch_evaluation(&created.watch.id, NOW_MS)
            .expect("schedule watch evaluation fixture"),
        "the fresh watch receives one evaluation job"
    );
    let mut claims = snapback
        .claim_due_jobs(NOW_MS, 1, "admission-fence", DiagnosticBoundary::Attached)
        .expect("claim watch evaluation fixture");
    assert_eq!(claims.len(), 1, "one watch evaluation job is due");
    let claim = claims.remove(0);
    assert_eq!(claim.action, crate::watches::INTERNAL_EVALUATION_ACTION);
    (snapback, controller, created, claim)
}

fn begun_watch_fixture(
    request: crate::watches::CreateWatchSpec,
) -> (
    LocalSnapback,
    AdmissionController,
    crate::watches::CreatedWatch,
    WatchJobContext,
    crate::storage::watches::WatchRecord,
) {
    let (mut snapback, controller, created, claim) = claimed_watch_fixture(request);
    let context = claim.watch_context();
    let record = snapback
        .db
        .begin_watch_evaluation(&created.watch.id, &context.job_id, NOW_MS)
        .expect("begin watch evaluation fixture")
        .expect("claimed watch remains current");
    (snapback, controller, created, context, record)
}

fn firing_watch_fixture() -> (
    LocalSnapback,
    AdmissionController,
    WatchJobContext,
    crate::storage::watches::WatchRecord,
    u64,
) {
    let (mut snapback, controller, created, context, record) =
        begun_watch_fixture(watch_webhook_request());
    let decision = snapback
        .db
        .decide_watch_evaluation(&record.id, &context.job_id, true, &[], NOW_MS)
        .expect("admit webhook firing fixture");
    let crate::storage::watches::EvaluationDecision::Fire { ordinal } = decision else {
        panic!("false-to-true webhook fixture must fire: {decision:?}");
    };
    let record = snapback
        .db
        .watch_for_execution(&created.watch.id)
        .expect("reload firing watch")
        .expect("firing watch remains present");
    (snapback, controller, context, record, ordinal)
}

fn one_off_job_fixture() -> (LocalSnapback, AdmissionController, u64) {
    let mut snapback = LocalSnapback::memory().expect("one-off job fence database");
    let diagnostics = snapback.load_functions(crate::manifest::FunctionManifest {
        functions: vec![
            crate::manifest::FunctionDefinition::new(
                "scheduleFenceJob",
                crate::manifest::FunctionKind::Mutation,
                crate::manifest::FunctionRuntime::IbexModule(crate::manifest::IbexModule {
                    source: "globalThis.__snapbackHandlers = { async scheduleFenceJob(ctx) { return await ctx.jobs.enqueue('fenceJob', {}); } };".to_owned(),
                    export: "scheduleFenceJob".to_owned(),
                }),
            ),
            crate::manifest::FunctionDefinition::new(
                "fenceJob",
                crate::manifest::FunctionKind::Action,
                crate::manifest::FunctionRuntime::HostPlan(crate::manifest::HandlerPlan::Action(
                    crate::manifest::ActionPlan {
                        steps: Vec::new(),
                        return_value: None,
                    },
                )),
            ),
        ],
        acknowledged_experimental_capabilities: vec!["jobs_one_off_v1".to_owned()],
        ..crate::manifest::FunctionManifest::default()
    });
    assert!(
        diagnostics
            .iter()
            .all(|diagnostic| diagnostic.severity != crate::diagnostic::DiagnosticSeverity::Error),
        "one-off job functions must load: {diagnostics:?}"
    );
    let output = snapback
        .invoke_mutation("scheduleFenceJob", HandlerInput::default())
        .expect("enqueue one-off job fence fixture");
    let available_at = output.result["availableAtMs"]
        .as_u64()
        .expect("job fixture returns availability");
    let controller = snapback.admission_controller();
    (snapback, controller, available_at)
}

#[test]
fn initial_one_off_job_claim_refuses_retired_epoch_without_claiming_the_job() {
    let (mut snapback, controller, available_at) = one_off_job_fixture();
    let before = durable_database_image(&snapback);
    let fired = retire_at_next_effect(AdmissionEffectSite::InitialJobClaim, controller);

    let error = match snapback.claim_due_jobs(
        available_at,
        1,
        "admission-fence",
        DiagnosticBoundary::Attached,
    ) {
        Ok(_) => panic!("retired admission must refuse the initial one-off job claim"),
        Err(error) => error,
    };

    assert_retired_refusal(&error, &fired);
    assert_eq!(
        durable_database_image(&snapback),
        before,
        "refused claim must leave the pending job and attempt ledger unchanged"
    );
}

#[test]
fn watch_evaluation_begin_refuses_retired_epoch_without_bookkeeping() {
    let (mut snapback, controller, created, claim) = claimed_watch_fixture(watch_request());
    let context = claim.watch_context();
    assert!(
        !snapback
            .db
            .schedule_watch_evaluation(&created.watch.id, NOW_MS)
            .expect("mark claimed evaluation dirty"),
        "an already-pending watch folds invalidation into durable dirty state"
    );
    let before = durable_database_image(&snapback);
    let fired = retire_at_next_effect(AdmissionEffectSite::WatchEvaluationBegin, controller);

    let error = match snapback.prepare_watch_job(context) {
        Ok(_) => panic!("retired admission must refuse watch evaluation begin"),
        Err(error) => error,
    };

    assert_retired_refusal(&error, &fired);
    assert_eq!(
        durable_database_image(&snapback),
        before,
        "refused evaluation begin must not update the watch"
    );
}

#[test]
fn watch_dead_transition_refuses_retired_epoch_without_killing_the_watch() {
    let (mut snapback, controller, _created, context, record) =
        begun_watch_fixture(watch_request());
    let before = durable_database_image(&snapback);
    let fired = retire_at_next_effect(AdmissionEffectSite::WatchDeadTransition, controller);

    let error = snapback
        .mark_watch_dead_for_job(
            &context.admission,
            &record.id,
            "retired_epoch_fixture",
            "SNAPBACK_WATCH_AUTHORITY_DEAD",
            NOW_MS,
        )
        .expect_err("retired admission must refuse the watch dead-state transition");

    assert_retired_refusal(&error, &fired);
    assert_eq!(
        durable_database_image(&snapback),
        before,
        "refused dead-state transition must leave the watch active"
    );
}

#[test]
fn watch_evaluation_decision_refuses_retired_epoch_without_deciding_or_enqueuing() {
    let (mut snapback, controller, _created, context, record) =
        begun_watch_fixture(watch_request());
    let before = durable_database_image(&snapback);
    let fired = retire_at_next_effect(AdmissionEffectSite::WatchEvaluationDecision, controller);

    let error = match snapback.prepare_watch_job_inner(&context, record, NOW_MS) {
        Ok(_) => panic!("retired admission must refuse the watch evaluation decision"),
        Err(error) => error,
    };

    assert_retired_refusal(&error, &fired);
    assert_eq!(
        durable_database_image(&snapback),
        before,
        "refused decision must not update dependencies or enqueue a firing"
    );
}

#[test]
fn watch_evaluation_failure_refuses_retired_epoch_without_retry_bookkeeping() {
    let (mut snapback, controller, _created, context, record) =
        begun_watch_fixture(watch_request());
    let before = durable_database_image(&snapback);
    let fired = retire_at_next_effect(AdmissionEffectSite::WatchEvaluationFailure, controller);

    let error = snapback
        .publish_watch_evaluation_failure(
            &context.admission,
            &record.id,
            &context.job_id,
            "SNAPBACK_WATCH_TEST_FAILURE",
            NOW_MS,
            true,
        )
        .expect_err("retired admission must refuse watch retry bookkeeping");

    assert_retired_refusal(&error, &fired);
    assert_eq!(
        durable_database_image(&snapback),
        before,
        "refused retry bookkeeping must leave the watch unchanged"
    );
}

#[test]
fn watch_firing_settlement_refuses_retired_epoch_without_settling_the_firing() {
    let (mut snapback, controller, context, record, ordinal) = firing_watch_fixture();
    let before = durable_database_image(&snapback);
    let fired = retire_at_next_effect(AdmissionEffectSite::WatchFiringSettlement, controller);

    let error = snapback
        .publish_watch_firing_outcome(
            &context.admission,
            &record.id,
            &context.job_id,
            ordinal,
            "succeeded",
            None,
            NOW_MS,
            false,
        )
        .expect_err("retired admission must refuse watch firing settlement");

    assert_retired_refusal(&error, &fired);
    assert_eq!(
        durable_database_image(&snapback),
        before,
        "refused firing settlement must retain the pending firing"
    );
}

#[test]
fn watch_webhook_reservation_refuses_retired_epoch_without_a_delivery() {
    let (mut snapback, controller, context, record, ordinal) = firing_watch_fixture();
    let before = durable_database_image(&snapback);
    let fired = retire_at_next_effect(AdmissionEffectSite::WatchWebhookReservation, controller);

    let error = match snapback.dispatch_watch_reaction(&context, &record, None, ordinal, NOW_MS) {
        Ok(_) => panic!("retired admission must refuse webhook reservation"),
        Err(error) => error,
    };

    assert_retired_refusal(&error, &fired);
    assert_eq!(
        durable_database_image(&snapback),
        before,
        "refused webhook reservation must not add a durable delivery"
    );
}

#[test]
fn watch_webhook_attempt_settlement_refuses_retired_epoch_without_attempt_bookkeeping() {
    let (mut snapback, controller, context, record, ordinal) = firing_watch_fixture();
    let prepared = match snapback
        .dispatch_watch_reaction(&context, &record, None, ordinal, NOW_MS)
        .expect("reserve webhook settlement fixture")
    {
        WatchJobExecution::Webhook(prepared) => prepared,
        _ => panic!("webhook fixture must prepare a delivery"),
    };
    let before = durable_database_image(&snapback);
    let fired = retire_at_next_effect(AdmissionEffectSite::WatchWebhookSettlement, controller);

    let error = snapback
        .settle_watch_webhook(
            prepared,
            crate::webhooks::DeliveryOutcome::Succeeded { http_status: 204 },
            1,
            8,
            NOW_MS,
        )
        .expect_err("retired admission must refuse webhook-attempt settlement");

    assert_retired_refusal(&error, &fired);
    assert_eq!(
        durable_database_image(&snapback),
        before,
        "refused webhook settlement must leave delivery and firing pending"
    );
}

fn derived_fork_admission_fixture(
    arm_coverage: bool,
) -> (
    tempfile::TempDir,
    LocalSnapback,
    AdmissionController,
    PreparedAuthority,
    std::path::PathBuf,
) {
    let directory = tempfile::tempdir().expect("derived-fork admission fence directory");
    let source = directory.path().join("parent.sqlite3");
    drop(LocalSnapback::open(&source).expect("create derived-fork parent"));
    let destination = directory.path().join("fork");
    snapback_services::instance_fork::publish(
        &source,
        &destination,
        "admission-fence-app",
        "admission-fence-parent",
        NOW_MS,
        None,
    )
    .expect("publish derived-fork admission fixture");
    let database = destination.join("parent.sqlite3");
    let mut fork = LocalSnapback::open(&database).expect("open derived-fork admission fixture");
    if arm_coverage {
        fork.arm_open_derived_fork_app_row_coverage(NOW_MS + 1)
            .expect("arm derived-fork registered-writer coverage");
    }
    let controller = synchronize_sessions(&fork);
    let authority = system_authority(&controller);
    (directory, fork, controller, authority, database)
}

#[test]
fn derived_fork_egress_marker_refuses_retired_epoch_without_a_marker() {
    let (_directory, fork, controller, authority, _database) =
        derived_fork_admission_fixture(false);
    let before = durable_database_image(&fork);
    let fired = retire_at_next_effect(AdmissionEffectSite::DerivedForkAdmittedEgress, controller);

    let error = fork
        .deny_derived_fork_host_op_admitted(&authority, "host.fetch", NOW_MS + 2)
        .expect_err("retired admission must refuse derived-fork denial persistence");

    assert_retired_refusal(&error, &fired);
    assert_eq!(
        durable_database_image(&fork),
        before,
        "refused derived-fork denial must not add a durable marker"
    );
}

#[test]
fn admitted_registered_writer_gap_refuses_retired_epoch_without_persisting_the_gap() {
    let (_directory, fork, controller, authority, database) = derived_fork_admission_fixture(true);
    fork.db
        .remove_active_operation_coverage_manifest_for_test()
        .expect("simulate an out-of-class registered-writer coverage gap");
    let gap_path = database.with_file_name(crate::instance_fork::APP_ROW_COVERAGE_GAP_FILE);
    assert!(!gap_path.exists(), "gap evidence starts absent");
    let before = durable_database_image(&fork);
    let fired = retire_at_next_effect(AdmissionEffectSite::DerivedForkAdmittedEgress, controller);

    let error = fork
        .deny_derived_fork_host_op_admitted(&authority, "host.fetch", NOW_MS + 2)
        .expect_err("retired admission must refuse registered-writer opening");

    assert_retired_refusal(&error, &fired);
    assert_eq!(
        durable_database_image(&fork),
        before,
        "refused registered-writer opening must not break the continuity row"
    );
    assert!(
        !gap_path.exists(),
        "refused admitted opening must not publish the fork coverage-gap sidecar"
    );
}

#[test]
fn oauth_dynamic_registration_refuses_a_foreign_engine_lease_before_commit() {
    let (mut snapback, _) = capability_link_fixture_with_agents_mode(AgentsMode::Open);
    let foreign_controller = AdmissionController::from_mode_state(
        &snapback
            .auth_mode_snapshot()
            .expect("read OAuth registration mode")
            .state,
    )
    .expect("construct foreign OAuth registration controller");
    let foreign_lease = foreign_controller
        .admit_for_mode(AuthMode::Sessions)
        .expect("foreign controller admits its own sessions epoch");
    let before = durable_database_image(&snapback);

    let error = snapback
        .register_oauth_client(
            &foreign_lease,
            None,
            Some("foreign OAuth registration".to_owned()),
            crate::storage::auth_integrations::IntegrationRegistrationFacts {
                origin: Some("https://foreign.example".to_owned()),
                redirect_uris: vec!["https://foreign.example/callback".to_owned()],
            },
            ServerProfile::Test,
            NOW_MS,
            &FenceRandom::new(),
        )
        .expect_err("a foreign admission lease must not register an OAuth client");

    assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_POLICY_UNAVAILABLE");
    assert_eq!(
        durable_database_image(&snapback),
        before,
        "foreign registration refusal must precede every durable write"
    );
}

#[test]
fn oauth_dynamic_registration_refuses_retired_epoch_and_holds_the_guard_through_commit() {
    let (mut snapback, controller) = capability_link_fixture_with_agents_mode(AgentsMode::Open);
    let random = FenceRandom::new();
    let admission = controller
        .admit_for_mode(AuthMode::Sessions)
        .expect("OAuth dynamic registration admission");
    let before = durable_database_image(&snapback);
    let fired = retire_at_next_effect(
        AdmissionEffectSite::OAuthDynamicRegistration,
        controller.clone(),
    );

    let error = snapback
        .register_oauth_client(
            &admission,
            None,
            Some("retired OAuth registration".to_owned()),
            crate::storage::auth_integrations::IntegrationRegistrationFacts {
                origin: Some("https://retired.example".to_owned()),
                redirect_uris: vec!["https://retired.example/callback".to_owned()],
            },
            ServerProfile::Test,
            NOW_MS,
            &random,
        )
        .expect_err("retired admission must refuse OAuth dynamic registration");

    assert_retired_refusal(&error, &fired);
    assert_eq!(
        durable_database_image(&snapback),
        before,
        "refused OAuth registration must not add an integration principal"
    );

    let admission = controller
        .admit_for_mode(AuthMode::Sessions)
        .expect("fresh OAuth dynamic registration admission");
    let commit_observed = observe_guard_through_next_commit(
        AdmissionEffectSite::OAuthDynamicRegistration,
        controller,
    );
    let issued = snapback
        .register_oauth_client(
            &admission,
            None,
            Some("guarded OAuth registration".to_owned()),
            crate::storage::auth_integrations::IntegrationRegistrationFacts {
                origin: Some("https://guarded.example".to_owned()),
                redirect_uris: vec!["https://guarded.example/callback".to_owned()],
            },
            ServerProfile::Test,
            NOW_MS + 1,
            &random,
        )
        .expect("live admission guard permits OAuth dynamic registration");
    assert!(
        snapback
            .integration_record_if_present(&issued.user_id)
            .expect("read guarded OAuth registration")
            .is_some(),
        "the guarded OAuth registration must be durable"
    );
    assert_guard_observed_at_commit(
        AdmissionEffectSite::OAuthDynamicRegistration,
        &commit_observed,
    );
}

#[test]
fn ask_spend_reservation_refuses_retired_epoch_and_holds_the_guard_through_commit() {
    let (mut snapback, controller, authority, subject, budgets) = ask_spend_fixture();
    let before = durable_database_image(&snapback);
    let fired = retire_at_next_effect(AdmissionEffectSite::AskSpendReservation, controller.clone());

    let error = snapback
        .reserve_ask_spend(&authority, NOW_MS, subject.clone(), &budgets)
        .expect_err("retired admission must refuse ask spend reservation");

    assert_retired_refusal(&error, &fired);
    assert_eq!(
        durable_database_image(&snapback),
        before,
        "refused ask reservation must not consume durable budget"
    );

    let authority = session_authority_for_source(&mut snapback, InvocationSource::HttpAsk);
    let commit_observed =
        observe_guard_through_next_commit(AdmissionEffectSite::AskSpendReservation, controller);
    let (_, facts) = snapback
        .reserve_ask_spend(&authority, NOW_MS + 1, subject, &budgets)
        .expect("live admission guard permits ask spend reservation");
    assert_eq!(facts.principal_day_tokens, budgets.per_request.max_tokens);
    assert_eq!(
        facts.principal_day_result_bytes,
        budgets.result_volume.max_bytes
    );
    assert_guard_observed_at_commit(AdmissionEffectSite::AskSpendReservation, &commit_observed);
}

#[test]
fn ask_spend_settlement_refuses_retired_epoch_and_holds_the_guard_through_commit() {
    let (mut snapback, controller, authority, subject, budgets) = ask_spend_fixture();
    let (reservation, _) = snapback
        .reserve_ask_spend(&authority, NOW_MS, subject.clone(), &budgets)
        .expect("seed ask spend reservation before settlement fence proof");
    let before = durable_database_image(&snapback);
    let fired = retire_at_next_effect(AdmissionEffectSite::AskSpendSettlement, controller.clone());

    let error = snapback
        .settle_ask_spend(reservation, 4, 25)
        .expect_err("retired admission must refuse ask spend settlement");

    assert_retired_refusal(&error, &fired);
    assert_eq!(
        durable_database_image(&snapback),
        before,
        "refused ask settlement must retain the outstanding reservation"
    );

    let authority = session_authority_for_source(&mut snapback, InvocationSource::HttpAsk);
    let (reservation, _) = snapback
        .reserve_ask_spend(&authority, NOW_MS + 1, subject, &budgets)
        .expect("reserve ask spend under the fresh admission epoch");
    let before_commit = durable_database_image(&snapback);
    let commit_observed =
        observe_guard_through_next_commit(AdmissionEffectSite::AskSpendSettlement, controller);
    let facts = snapback
        .settle_ask_spend(reservation, 4, 25)
        .expect("live admission guard permits ask spend settlement");
    assert_eq!(
        facts.principal_day_tokens,
        budgets.per_request.max_tokens + 4,
        "the retired reservation remains conservative while fresh actual spend settles"
    );
    assert_eq!(
        facts.principal_day_result_bytes,
        budgets.result_volume.max_bytes + 25,
        "the retired result-byte reservation remains conservative"
    );
    assert_ne!(
        durable_database_image(&snapback),
        before_commit,
        "the successful guarded settlement must be durable"
    );
    assert_guard_observed_at_commit(AdmissionEffectSite::AskSpendSettlement, &commit_observed);
}

#[test]
fn client_mutation_acknowledgement_refuses_retired_epoch_and_holds_the_guard_through_commit() {
    let (mut snapback, controller, authority, mutation_id) =
        client_mutation_acknowledgement_fixture();
    let before = durable_database_image(&snapback);
    let fired = retire_at_next_effect(
        AdmissionEffectSite::ClientMutationAcknowledgement,
        controller.clone(),
    );

    let error = snapback
        .acknowledge_client_mutations_with_authority(&authority, std::slice::from_ref(&mutation_id))
        .expect_err("retired admission must refuse client-mutation acknowledgement");

    assert_retired_refusal(&error, &fired);
    assert_eq!(
        durable_database_image(&snapback),
        before,
        "refused acknowledgement must retain the durable settlement"
    );

    let authority = session_authority_for_source(&mut snapback, InvocationSource::HttpMutation);
    let commit_observed = observe_guard_through_next_commit(
        AdmissionEffectSite::ClientMutationAcknowledgement,
        controller,
    );
    assert_eq!(
        snapback
            .acknowledge_client_mutations_with_authority(
                &authority,
                std::slice::from_ref(&mutation_id),
            )
            .expect("live admission guard permits client-mutation acknowledgement"),
        1,
        "the guarded acknowledgement must durably remove its settlement"
    );
    assert_guard_observed_at_commit(
        AdmissionEffectSite::ClientMutationAcknowledgement,
        &commit_observed,
    );
}

#[test]
fn partial_multi_commit_failure_drops_its_commit_observer_before_later_work() {
    let (mut snapback, controller, authority, mutation_id) =
        client_mutation_acknowledgement_fixture();
    let partial_observation = observe_guard_through_next_commit(
        AdmissionEffectSite::ClientMutationAcknowledgement,
        controller.clone(),
    );
    FAIL_CLIENT_MUTATION_ACK_AFTER_FIRST_COMMIT.with(|slot| {
        assert!(!slot.replace(true), "partial-commit fault is one-shot");
    });

    let error = snapback
        .acknowledge_client_mutations_with_authority(&authority, std::slice::from_ref(&mutation_id))
        .expect_err("the injected failure returns before the second COMMIT primitive");
    assert_eq!(
        error.diagnostic.code,
        "TEST_CLIENT_MUTATION_ACK_AFTER_FIRST_COMMIT"
    );
    assert_eq!(partial_observation.matching_commits(), 1);
    assert_eq!(partial_observation.mismatched_commits(), 0);

    // The observation expected two commits but saw only one. Its RAII owner
    // must remove the still-pending observer before this worker thread reuses
    // the same commit sites for another operation.
    drop(partial_observation);
    let authority = session_authority_for_source(&mut snapback, InvocationSource::HttpMutation);
    let later_observation = observe_guard_through_next_commit(
        AdmissionEffectSite::ClientMutationAcknowledgement,
        controller,
    );
    assert_eq!(
        snapback
            .acknowledge_client_mutations_with_authority(
                &authority,
                std::slice::from_ref(&mutation_id),
            )
            .expect("later acknowledgement is not poisoned by the partial observer"),
        0,
        "the first transaction already removed the one retained settlement"
    );
    assert_guard_observed_at_commit(
        AdmissionEffectSite::ClientMutationAcknowledgement,
        &later_observation,
    );
}

#[test]
fn watch_creation_refuses_retired_mode_epoch_and_holds_mode_guard_through_commit() {
    // This proves only the correlated mode-admission epoch and its COMMIT
    // span. It is not a caller-publication fence proof: watch creation
    // deliberately remains mode-only for the reasons recorded in
    // issues/20260822-watch-creation-fence-design-decision.md.
    let (mut snapback, controller) = watch_creation_fixture();
    let authority = session_authority_for_source(&mut snapback, InvocationSource::WatchManagement);
    let before = durable_database_image(&snapback);
    let fired = retire_at_next_effect(AdmissionEffectSite::WatchCreation, controller.clone());

    let error = snapback
        .create_watch(&authority, watch_request(), NOW_MS)
        .expect_err("retired admission must refuse watch creation");

    assert_retired_refusal(&error, &fired);
    assert_eq!(
        durable_database_image(&snapback),
        before,
        "refused watch creation must not add a durable watch"
    );

    let authority = session_authority_for_source(&mut snapback, InvocationSource::WatchManagement);
    let commit_observed =
        observe_guard_through_next_commit(AdmissionEffectSite::WatchCreation, controller);
    let created = snapback
        .create_watch(&authority, watch_request(), NOW_MS + 1)
        .expect("live admission guard permits watch creation");
    assert_eq!(
        snapback
            .list_watches(&authority)
            .expect("list guarded watch")
            .iter()
            .map(|watch| watch.id.as_str())
            .collect::<Vec<_>>(),
        vec![created.watch.id.as_str()],
        "the guarded watch creation must be durable"
    );
    assert_guard_observed_at_commit(AdmissionEffectSite::WatchCreation, &commit_observed);
}

#[test]
fn capability_link_mint_refuses_retired_epoch_without_a_durable_row() {
    let (mut snapback, controller) = capability_link_fixture();
    let authority = session_management_authority(&mut snapback);
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

    let authority = session_management_authority(&mut snapback);
    let before_commit = durable_database_image(&snapback);
    let commit_observed =
        observe_guard_through_next_commit(AdmissionEffectSite::CapabilityLinkMint, controller);
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
    assert_guard_observed_at_commit(AdmissionEffectSite::CapabilityLinkMint, &commit_observed);
}

#[test]
fn capability_link_mint_observes_the_guard_when_an_error_follows_commit() {
    let (mut snapback, controller) = capability_link_fixture();
    let authority = session_management_authority(&mut snapback);
    assert_eq!(
        snapback
            .auth_database_mut()
            .capability_link_count_for_test()
            .expect("count capability links before injected failure"),
        0
    );
    snapback
        .auth_database_mut()
        .fail_next_capability_link_mint_after_commit_before_read_for_test();
    let commit_observed =
        observe_guard_through_next_commit(AdmissionEffectSite::CapabilityLinkMint, controller);

    let error = snapback
        .mint_capability_link(&authority, link_request(Some(1)))
        .expect_err("the injected row read must fail after capability-link COMMIT");

    assert_eq!(
        error.diagnostic.code,
        "TEST_CAPABILITY_LINK_POST_COMMIT_READ_FAILURE"
    );
    assert_eq!(
        snapback
            .auth_database_mut()
            .capability_link_count_for_test()
            .expect("count capability links after injected failure"),
        1,
        "the capability-link row must be durable even though the caller returned an error"
    );
    assert_guard_observed_at_commit(AdmissionEffectSite::CapabilityLinkMint, &commit_observed);
}

#[test]
fn durable_commit_observer_rejects_a_foreign_guard_when_the_target_guard_is_absent() {
    let (mut snapback, target_controller) = capability_link_fixture();
    let target_epoch = target_controller.snapshot().admission_epoch;
    let expected_guard = target_controller.effect_guard_identity_for_test(target_epoch);
    let other_controller = AdmissionController::new(1, true).expect("different controller");
    let other_lease = other_controller
        .admit()
        .expect("different-controller admission");
    let _other_guard = other_lease
        .effect_guard("foreign-only durable-observer regression")
        .expect("different-controller guard");
    let commit_observed = crate::storage::observe_next_durable_commits_for_test(1, expected_guard);

    // Drive the real instrumented capability-link COMMIT boundary directly.
    // The engine operation cannot discriminate here because it acquires the
    // target guard itself; this storage call deliberately leaves only the
    // foreign guard live when the durable observer runs.
    snapback
        .auth_database_mut()
        .mint_capability_link(link_request(Some(1)))
        .expect("the direct storage operation reaches its durable commit");

    assert_eq!(
        commit_observed.matching_commits(),
        0,
        "a foreign guard must not satisfy the target controller/epoch observation"
    );
    assert_eq!(
        commit_observed.mismatched_commits(),
        1,
        "the real durable commit boundary must reject the foreign-only guard"
    );
}

#[test]
fn capability_link_revoke_refuses_retired_epoch_without_changing_the_row() {
    let (mut snapback, controller) = capability_link_fixture();
    let minted = seed_link(&mut snapback, 1);
    let authority = session_management_authority(&mut snapback);
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

    let authority = session_management_authority(&mut snapback);
    let before_commit = durable_database_image(&snapback);
    let commit_observed =
        observe_guard_through_next_commit(AdmissionEffectSite::CapabilityLinkRevoke, controller);
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
    assert_guard_observed_at_commit(AdmissionEffectSite::CapabilityLinkRevoke, &commit_observed);
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
    let commit_observed =
        observe_guard_through_next_commit(AdmissionEffectSite::CapabilityLinkConsume, controller);
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
    assert_guard_observed_at_commit(AdmissionEffectSite::CapabilityLinkConsume, &commit_observed);
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
    let commit_observed =
        observe_guard_through_next_commit(AdmissionEffectSite::CapabilityLinkSettle, controller);
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
    assert_guard_observed_at_commit(AdmissionEffectSite::CapabilityLinkSettle, &commit_observed);
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
    let commit_observed =
        observe_guard_through_next_commit(AdmissionEffectSite::PushBatchClaim, controller);
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
    assert_guard_observed_at_commit(AdmissionEffectSite::PushBatchClaim, &commit_observed);
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
    let commit_observed =
        observe_guard_through_next_commit(AdmissionEffectSite::PushBatchTransmitting, controller);
    snapback
        .mark_push_batch_transmitting(&authority, &claim, NOW_MS + 4)
        .expect("live admission guard permits push transmitting marker");
    assert_ne!(
        durable_database_image(&snapback),
        before,
        "the successful guarded transmitting marker must be durable"
    );
    assert_guard_observed_at_commit(AdmissionEffectSite::PushBatchTransmitting, &commit_observed);
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
    let commit_observed =
        observe_guard_through_next_commit(AdmissionEffectSite::PushBatchSettlement, controller);
    snapback
        .settle_push_batch(&authority, &claim, &settlement, NOW_MS + 5)
        .expect("live admission guard permits push batch settlement");
    assert_ne!(
        durable_database_image(&snapback),
        before,
        "the successful guarded settlement must be durable"
    );
    assert_guard_observed_at_commit(AdmissionEffectSite::PushBatchSettlement, &commit_observed);
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
    let commit_observed =
        observe_guard_through_next_commit(AdmissionEffectSite::PushReservation, controller);
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
    assert_guard_observed_at_commit(AdmissionEffectSite::PushReservation, &commit_observed);
}
