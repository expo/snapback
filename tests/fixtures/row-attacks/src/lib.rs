use serde_json::json;
use snapback_auth::auth::keyring::AuthKeyringStore;
use snapback_auth::auth::provider::{
    AuthClock, AuthProvider, PasswordIssuanceCustody, ProviderGuestSessionPlan,
};
use snapback_engine::local::{EnsureAppMode, LocalSnapback};
use snapback_kernel::auth::throttle::RollingWindowBudgetTerms;
use snapback_kernel::storage::LocalDatabase;
use snapback_kernel::storage::auth_grants::{
    GrantApproval, GrantScopeRequest, PairingPresentation, ScopedFunctionKind,
};
use snapback_kernel::storage::auth_integrations::IntegrationRegistrationFacts;
use snapback_kernel::storage::pending_effects::{CreatePendingEffect, PendingEffectAuthority};
use snapback_sync::auth::coordinator::IssuanceFinish;
use snapback_sync::auth::invocation::{
    InvocationSource, ResolvedAppAuthority, WireAuthorityFields,
};
use snapback_types::auth::crypto::OsRandom;
use snapback_types::auth::mode::{
    AuthModeStateRecord, AuthProgramReadiness, FUNCTION_V1_PREFIX, INPUTS_V1_PREFIX,
    SCHEMA_V1_PREFIX,
};
use snapback_types::contract_types::{
    AgentsManifest, AgentsMode, ApiFunctionApproval, ApiFunctionExposure, ApiManifest,
    ApiOAuthBundle, ApiOAuthManifest, AuthManifest, AuthMode, AuthProviderProfile, FieldManifest,
    FieldType, InvitedBy, ServerProfile,
};
use snapback_types::manifest::{
    ArtifactGeneration, FunctionDefinition, FunctionKind, FunctionManifest, FunctionRuntime,
    HandlerPlan, MutationPlan, QueryPlan, SchemaManifest, TableManifest, TableVisibilityV1,
};
use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Instant;

pub const NOW: u64 = 10_000;

fn sessions_oauth_pair() -> (SchemaManifest, FunctionManifest) {
    let mut schema = SchemaManifest {
        schema_version: "snapback.v1".to_owned(),
        app_id: "landed-row-recheck".to_owned(),
        auth: Some(AuthManifest {
            mode: AuthMode::Sessions,
            agents: Some(AgentsManifest::explicit(
                AgentsMode::Open,
                InvitedBy::Operators,
            )),
            password_identifier_mode: None,
            password_minimum_length: None,
        }),
        required_capabilities: vec!["auth.sessions.v1".to_owned()],
        schema_hash: Some(format!("{}{}", SCHEMA_V1_PREFIX, "a".repeat(64))),
        inputs_hash: Some(format!("{}{}", INPUTS_V1_PREFIX, "a".repeat(64))),
        tables: vec![TableManifest {
            name: "items".to_owned(),
            fields: vec![FieldManifest {
                name: "value".to_owned(),
                field_type: FieldType::String,
                optional: false,
            }],
            indexes: Vec::new(),
            search_indexes: Vec::new(),
            vector_indexes: Vec::new(),
            search_live_limits: None,
            syncable: true,
            permission_backing: false,
            permission_fields: None,
            membership: None,
            authority_profile: None,
            asset_sharing: None,
            visibility: Some(TableVisibilityV1::PublicRead),
            history: None,
        }],
        ..SchemaManifest::default()
    };
    schema.api = Some(ApiManifest {
        enabled: true,
        functions: BTreeMap::from([
            (
                "oauthQuery".to_owned(),
                ApiFunctionExposure {
                    expose: true,
                    since: None,
                    approval: None,
                },
            ),
            (
                "approvedMutation".to_owned(),
                ApiFunctionExposure {
                    expose: true,
                    since: None,
                    approval: Some(ApiFunctionApproval::Required),
                },
            ),
        ]),
        oauth: Some(ApiOAuthManifest {
            enabled: true,
            bearer: true,
            bundles: BTreeMap::from([(
                "read".to_owned(),
                ApiOAuthBundle {
                    functions: vec!["oauthQuery".to_owned()],
                },
            )]),
        }),
        ..ApiManifest::default()
    });

    let mut oauth_query = FunctionDefinition::new(
        "oauthQuery",
        FunctionKind::Query,
        FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
            table_visibility: None,
            table: "items".to_owned(),
            filters: Vec::new(),
            order: Vec::new(),
            limit: None,
            membership_filters: Vec::new(),
            indexed_by: None,
        })),
    );
    oauth_query.api_exposure = Some(ApiFunctionExposure {
        expose: true,
        since: None,
        approval: None,
    });
    let mut approved_mutation = FunctionDefinition::new(
        "approvedMutation",
        FunctionKind::Mutation,
        FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
            owner_write_checks: Vec::new(),
            steps: Vec::new(),
            return_value: None,
        })),
    );
    approved_mutation.api_exposure = Some(ApiFunctionExposure {
        expose: true,
        since: None,
        approval: Some(ApiFunctionApproval::Required),
    });
    let functions = FunctionManifest {
        schema_version: "snapback.v1".to_owned(),
        app_id: "landed-row-recheck".to_owned(),
        bundle_hash: Some(format!("{}{}", FUNCTION_V1_PREFIX, "b".repeat(64))),
        inputs_hash: Some(format!("{}{}", INPUTS_V1_PREFIX, "a".repeat(64))),
        functions: vec![oauth_query, approved_mutation],
        ..FunctionManifest::default()
    };
    (schema, functions)
}

fn provision_sessions(path: &std::path::Path) -> Result<FunctionManifest, String> {
    let (schema, functions) = sessions_oauth_pair();
    let mut engine = LocalSnapback::open(path).map_err(|e| format!("open target: {e:?}"))?;
    let prepared = engine
        .prepare_auth_provision(
            EnsureAppMode::Sessions,
            Some(schema),
            Some(functions.clone()),
            None,
        )
        .map_err(|e| format!("prepare sessions: {e:?}"))?;
    let committed = engine
        .commit_auth_provision_classified(prepared, "test", None)
        .map_err(|e| format!("commit sessions: {:?}", e.into_error()))?;
    let (_, pending, _) = committed.into_parts();
    if pending.active != AuthMode::Dev {
        return Err(format!(
            "unexpected pre-restart active mode: {:?}",
            pending.active
        ));
    }
    let readiness = AuthProgramReadiness::new(true, true, true, true, true, true, true);
    let settled = engine
        .consume_sessions_auth_mode_with_functions(&readiness, &functions)
        .map_err(|e| format!("consume sessions: {e:?}"))?;
    if settled.active != AuthMode::Sessions {
        return Err(format!("sessions did not settle: {settled:?}"));
    }
    drop(engine);
    Ok(functions)
}

#[derive(Clone)]
struct FixedClock {
    epoch_ms: u64,
    monotonic: Instant,
}

impl AuthClock for FixedClock {
    fn epoch_ms(&self) -> u64 {
        self.epoch_ms
    }

    fn monotonic_now(&self) -> Instant {
        self.monotonic
    }
}

fn fixed_provider(epoch_ms: u64) -> Result<(Arc<AuthProvider>, Arc<FixedClock>), String> {
    let keyring = Arc::new(AuthKeyringStore::in_memory());
    keyring
        .load_or_mint_initial(epoch_ms, &OsRandom)
        .map_err(|e| format!("mint keyring: {e:?}"))?;
    let clock = Arc::new(FixedClock {
        epoch_ms,
        monotonic: Instant::now(),
    });
    let provider = AuthProvider::new_with_dependencies(
        AuthProviderProfile::Test,
        keyring,
        Arc::new(OsRandom),
        clock.clone(),
    )
    .map_err(|e| format!("provider: {e:?}"))?;
    Ok((Arc::new(provider), clock))
}

fn pending_request(
    authority: PendingEffectAuthority,
    generation: ArtifactGeneration,
    now_ms: u64,
) -> CreatePendingEffect {
    CreatePendingEffect {
        function_id: "fn:approvedMutation".to_owned(),
        function_name: "approvedMutation".to_owned(),
        function_kind: FunctionKind::Mutation,
        args: json!({}),
        caller_lane: "declared".to_owned(),
        caller_key: "cross-engine-output".to_owned(),
        authority,
        generation,
        link_origin_id: None,
        approver_principal_id: Some("overwritten-by-engine".to_owned()),
        declared_write_set: Vec::new(),
        now_ms,
        ttl_ms: 60_000,
    }
}

// The two functions below are the executed m16 audit preserved at the survival
// checkpoint. They stay source-readable while the standing corpus calls the
// row-isolated compositions added below.
#[cfg(any())]
async fn q06_output_travel_witness() -> Result<(), String> {
    let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
    let path_a = dir.path().join("engine-a.sqlite3");
    let path_b = dir.path().join("engine-b.sqlite3");
    let functions = provision_sessions(&path_a)?;

    let mut engine_a = LocalSnapback::open(&path_a).map_err(|e| format!("open A: {e:?}"))?;
    let diagnostics = engine_a.load_functions(functions.clone());
    if diagnostics.iter().any(|d| {
        matches!(
            d.severity,
            snapback_kernel::diagnostic::DiagnosticSeverity::Error
                | snapback_kernel::diagnostic::DiagnosticSeverity::Fatal
        )
    }) {
        return Err(format!("A functions failed: {diagnostics:?}"));
    }
    let (provider_a, clock_a) = fixed_provider(NOW)?;
    let coordinator_a = engine_a
        .build_auth_coordinator(&provider_a, true)
        .map_err(|e| format!("A coordinator: {e:?}"))?;
    let mut catalog_a =
        LocalDatabase::open(&path_a).map_err(|e| format!("open A catalog writer: {e:?}"))?;
    let guest_plan = provider_a
        .plan_guest_session(
            &mut catalog_a,
            NOW,
            1_000_000,
            RollingWindowBudgetTerms {
                limit: 100,
                window_ms: 60_000,
            },
            "q06-dependent-witness-guest",
            "landed-row-recheck",
            "local-dependent-witness",
            &format!("sha256:{}", "c".repeat(64)),
            PasswordIssuanceCustody::Bearer,
        )
        .map_err(|e| format!("A guest plan: {e:?}"))?;
    let ProviderGuestSessionPlan::Planned(guest_plan) = guest_plan else {
        return Err("A guest plan was not newly planned".to_owned());
    };
    let (issuance_plan, guest_context) = guest_plan.into_coordinated_parts();
    let carrier = coordinator_a
        .premark_issuance(issuance_plan)
        .await
        .map_err(|e| format!("A guest premark: {e:?}"))?;
    let commit_plan = guest_context.commit_plan(carrier.plan().commit_plan());
    let attempt = provider_a.commit_guest_issuance(&mut catalog_a, &commit_plan);
    let (finish, terminal_targets) = coordinator_a
        .finish_issuance(carrier, attempt, NOW, clock_a.monotonic_now())
        .into_parts();
    if !terminal_targets.is_empty() {
        return Err("new guest unexpectedly revoked a prior session".to_owned());
    }
    let IssuanceFinish::Committed { issue, .. } =
        finish.map_err(|e| format!("A guest finish: {e:?}"))?
    else {
        return Err("A guest issuance did not commit".to_owned());
    };
    let victim_user_id = issue.response().session.user_id.clone();
    let victim_session_id = issue.response().session.id.clone();
    let victim_bearer = issue.response().token().expose_secret().to_owned();
    let victim_authority_instance_id = issue.response().session.authority_instance_id.clone();

    let state = engine_a
        .auth_mode_snapshot()
        .map_err(|e| format!("A mode: {e:?}"))?
        .state;
    let controller = AdmissionController::from_mode_state(&state)
        .map_err(|e| format!("A external controller: {e:?}"))?;
    let lease = controller
        .admit_for_mode(AuthMode::Sessions)
        .map_err(|e| format!("A external lease: {e:?}"))?;
    let resolved_management = ResolvedAppAuthority::Session {
        user_id: victim_user_id.clone(),
        session_id: victim_session_id.clone(),
        provider: "guest".to_owned(),
        generation: 1,
        authority_instance_id: victim_authority_instance_id,
        session_not_after_ms: NOW + 1_000_000,
        provider_not_after_ms: None,
        rehearsal_provenance: None,
    };
    let prepare_source = |source| {
        InvocationGate::prepare_admitted_authority(
            source,
            AuthMode::Sessions,
            ServerProfile::Test,
            lease.clone(),
            &WireAuthorityFields::default(),
            resolved_management.clone(),
            Some(AuthClaimsProjection::server_derived(Vec::new(), Vec::new())),
        )
        .map_err(|e| format!("prepare {source:?}: {e:?}"))
    };
    let grant_management = prepare_source(InvocationSource::AgentGrantManagement)?;
    let effect_management = prepare_source(InvocationSource::EffectManagement)?;

    let integration = engine_a
        .register_oauth_client(
            &lease,
            AgentsMode::Open,
            None,
            Some("Q06 cross-engine principal".to_owned()),
            IntegrationRegistrationFacts {
                origin: Some("https://q06.example".to_owned()),
                redirect_uris: vec!["https://q06.example/callback".to_owned()],
            },
            ServerProfile::Test,
            NOW + 100,
            &OsRandom,
        )
        .map_err(|e| format!("Q06 registration: {e:?}"))?;
    let effect = grant_management
        .effect_guard("Q06 pairing setup")
        .map_err(|e| format!("Q06 effect guard: {e:?}"))?;
    let pairing = engine_a
        .mint_pairing_code(&effect, &victim_user_id, NOW + 101, &OsRandom)
        .map_err(|e| format!("Q06 pairing mint: {e:?}"))?;
    let presentation = engine_a
        .present_pairing_code(
            &effect,
            &integration.secret,
            &pairing.request_id,
            &pairing.secret,
            &[
                GrantScopeRequest::Exact {
                    function_id: "fn:oauthQuery".to_owned(),
                    kind: ScopedFunctionKind::Query,
                },
                GrantScopeRequest::Exact {
                    function_id: "fn:approvedMutation".to_owned(),
                    kind: ScopedFunctionKind::Mutation,
                },
            ],
            NOW + 102,
        )
        .map_err(|e| format!("Q06 pairing present: {e:?}"))?;
    drop(effect);
    let request_id = match presentation {
        PairingPresentation::Created(request) | PairingPresentation::Existing(request) => {
            request.request_id
        }
    };
    let grant = match engine_a
        .approve_grant_request(&grant_management, &request_id, None, None, NOW + 103)
        .map_err(|e| format!("Q06 grant approval: {e:?}"))?
    {
        GrantApproval::Created(grant) | GrantApproval::Existing(grant) => grant,
    };
    let token = engine_a
        .mint_scoped_token(
            &integration.secret,
            &grant.grant_id,
            Some(60_000),
            NOW + 104,
            &OsRandom,
        )
        .map_err(|e| format!("Q06 token: {e:?}"))?;

    let generation = engine_a
        .function_invocation_facts(AuthMode::Sessions)
        .map_err(|e| format!("A generation: {e:?}"))?
        .ok_or_else(|| "A generation absent".to_owned())?
        .active_generation;

    // Clone A's durable image into a second engine. IDs and live rows are the
    // same, but all process-local database/coordinator/fence identity is new.
    let image = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create_new(true)
        .open(&path_b)
        .map_err(|e| format!("create B image: {e}"))?;
    engine_a
        .backup_database_image_into(&image)
        .map_err(|e| format!("backup A to B: {e:?}"))?;
    drop(image);
    let mut engine_b = LocalSnapback::open(&path_b).map_err(|e| format!("open B: {e:?}"))?;
    let b_diagnostics = engine_b.load_functions(functions);
    if b_diagnostics.iter().any(|d| {
        matches!(
            d.severity,
            snapback_kernel::diagnostic::DiagnosticSeverity::Error
                | snapback_kernel::diagnostic::DiagnosticSeverity::Fatal
        )
    }) {
        return Err(format!("B functions failed: {b_diagnostics:?}"));
    }
    let (provider_b, _clock_b) = fixed_provider(NOW)?;
    let coordinator_b = engine_b
        .build_auth_coordinator(&provider_b, true)
        .map_err(|e| format!("B coordinator: {e:?}"))?;

    // F157: obtain A's legitimate reconstructed output, clone it, and feed it
    // into B's wrapper for a B-owned pending effect with the copied coordinates.
    let route_session = coordinator_a
        .resolve_required_bearer(&victim_bearer, clock_a.epoch_ms(), clock_a.monotonic_now())
        .map_err(|e| format!("A route session: {e:?}"))?;
    let ResolvedAppAuthority::Session {
        user_id,
        session_id,
        provider,
        generation: session_generation,
        authority_instance_id,
        ..
    } = route_session.resolved().clone()
    else {
        return Err("A bearer did not resolve to session".to_owned());
    };
    let session_authority = PendingEffectAuthority::Session {
        user_id,
        session_id,
        provider,
        generation: session_generation,
        authority_instance_id,
        authorization_stream_incarnation: coordinator_a
            .authorization_stream_incarnation()
            .map_err(|e| format!("A incarnation: {e:?}"))?,
    };
    let pending_a = engine_a
        .create_pending_effect(
            &effect_management,
            None,
            pending_request(session_authority.clone(), generation.clone(), NOW + 120),
        )
        .map_err(|e| format!("F157 A pending: {e:?}"))?;
    let approval_a = engine_a
        .prepare_pending_effect_approval(&effect_management, &pending_a.id, NOW + 121)
        .map_err(|e| format!("F157 A approval: {e:?}"))?;
    let retained_a = match approval_a.original_authority() {
        snapback_kernel::storage::pending_effects::RetainedEffectOriginalAuthority::Session(
            retained,
        ) => retained,
        _ => return Err("F157 A retained arm mismatch".to_owned()),
    };
    let output_a = coordinator_a
        .prepare_retained_effect_session(&retained_a, NOW + 122, clock_a.monotonic_now())
        .map_err(|e| format!("F157 A reconstruction: {e:?}"))?;
    let cloned_output_a = output_a.clone();

    let pending_b = engine_b
        .create_pending_effect(
            &effect_management,
            None,
            pending_request(session_authority, generation.clone(), NOW + 120),
        )
        .map_err(|e| format!("F157 B pending: {e:?}"))?;
    let approval_b = engine_b
        .prepare_pending_effect_approval(&effect_management, &pending_b.id, NOW + 121)
        .map_err(|e| format!("F157 B approval: {e:?}"))?;
    let original_b = engine_b
        .prepare_pending_effect_session_original(&approval_b, cloned_output_a, NOW + 122)
        .map_err(|e| format!("F157 B wrapper refused: {e:?}"))?;
    let approved_b = engine_b
        .approve_pending_effect(approval_b, original_b, None, NOW + 123)
        .map_err(|e| format!("F157 B durable approval refused: {e:?}"))?;
    let (record_b, _, _) = approved_b.into_parts();
    println!(
        "OPEN F157 A_output_accepted_by_B effect={} status={:?}",
        record_b.id, record_b.status
    );

    // F175: resolve the same copied token through A's retained view, then feed
    // A's cloneable output to B's wrapper and B's durable approval transition.
    let route_service = engine_a
        .resolve_scoped_token_route_authority(
            &token.secret,
            NOW + 130,
            clock_a.monotonic_now(),
            provider_a.clone(),
        )
        .map_err(|e| format!("A route service: {e:?}"))?;
    let ResolvedAppAuthority::ServicePrincipal {
        actor_user_id,
        credential_id,
        credential_generation,
        grant_id,
        token_id,
        effective_user_id,
        token_expires_at_ms,
        ..
    } = route_service.resolved().clone()
    else {
        return Err("A token did not resolve to service principal".to_owned());
    };
    let service_authority = PendingEffectAuthority::ServicePrincipal {
        actor_user_id,
        credential_id,
        credential_generation,
        grant_id,
        token_id,
        effective_user_id,
        token_expires_at_ms,
    };
    let service_pending_a = engine_a
        .create_pending_effect(
            &effect_management,
            None,
            pending_request(service_authority.clone(), generation.clone(), NOW + 131),
        )
        .map_err(|e| format!("F175 A pending: {e:?}"))?;
    let service_approval_a = engine_a
        .prepare_pending_effect_approval(&effect_management, &service_pending_a.id, NOW + 132)
        .map_err(|e| format!("F175 A approval: {e:?}"))?;
    let service_retained_a = match service_approval_a.original_authority() {
        snapback_kernel::storage::pending_effects::RetainedEffectOriginalAuthority::ServicePrincipal(retained) => retained,
        _ => return Err("F175 A retained arm mismatch".to_owned()),
    };
    let service_output_a = engine_a
        .resolve_retained_effect_service_authority(
            &service_retained_a,
            NOW + 133,
            clock_a.monotonic_now(),
            provider_a,
        )
        .map_err(|e| format!("F175 A reconstruction: {e:?}"))?;
    let cloned_service_output_a = service_output_a.clone();

    let service_pending_b = engine_b
        .create_pending_effect(
            &effect_management,
            None,
            pending_request(service_authority.clone(), generation.clone(), NOW + 131),
        )
        .map_err(|e| format!("F175 B pending: {e:?}"))?;
    let service_approval_b = engine_b
        .prepare_pending_effect_approval(&effect_management, &service_pending_b.id, NOW + 132)
        .map_err(|e| format!("F175 B approval: {e:?}"))?;
    let stream_publication_b = coordinator_b
        .prepare_anonymous_publication()
        .map_err(|e| format!("B stream publication: {e:?}"))?;
    let service_original_b = engine_b
        .prepare_pending_effect_service_original(
            &service_approval_b,
            cloned_service_output_a,
            stream_publication_b,
            NOW + 133,
        )
        .map_err(|e| format!("F175 B wrapper refused: {e:?}"))?;
    let service_approved_b = engine_b
        .approve_pending_effect(service_approval_b, service_original_b, None, NOW + 134)
        .map_err(|e| format!("F175 B durable approval refused: {e:?}"))?;
    let (service_record_b, _, _) = service_approved_b.into_parts();
    println!(
        "OPEN F175 A_output_accepted_by_B effect={} status={:?}",
        service_record_b.id, service_record_b.status
    );

    #[cfg(feature = "additive")]
    {
        // The additive graph also publishes a direct synthetic producer for
        // the same carrier. Feed that carrier into a fresh B effect.
        let synthetic = snapback_engine::local::ResolvedServiceAuthority::synthetic_for_test(
            service_output_a.resolved().clone(),
            service_output_a.publication().clone(),
        );
        let synthetic_pending_b = engine_b
            .create_pending_effect(
                &effect_management,
                None,
                pending_request(service_authority, generation, NOW + 140),
            )
            .map_err(|e| format!("additive F175 B pending: {e:?}"))?;
        let synthetic_approval_b = engine_b
            .prepare_pending_effect_approval(&effect_management, &synthetic_pending_b.id, NOW + 141)
            .map_err(|e| format!("additive F175 B approval: {e:?}"))?;
        let synthetic_original_b = engine_b
            .prepare_pending_effect_service_original(
                &synthetic_approval_b,
                synthetic,
                coordinator_b
                    .prepare_anonymous_publication()
                    .map_err(|e| format!("additive B stream publication: {e:?}"))?,
                NOW + 142,
            )
            .map_err(|e| format!("additive synthetic F175 wrapper: {e:?}"))?;
        let _ = engine_b
            .approve_pending_effect(synthetic_approval_b, synthetic_original_b, None, NOW + 143)
            .map_err(|e| format!("additive synthetic F175 approval: {e:?}"))?;
        let (_resolved, _publication) = output_a.into_parts();
        println!(
            "OPEN additive synthetic ResolvedServiceAuthority and PreparedBearerAuthority::into_parts exposed"
        );
    }

    Ok(())
}

#[cfg(any())]
#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), String> {
    let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
    let path = dir.path().join("target.sqlite3");
    let functions = provision_sessions(&path)?;

    let victim = {
        let mut database =
            LocalDatabase::open(&path).map_err(|e| format!("open seed db: {e:?}"))?;
        database
            .activate_current_auth_catalog()
            .map_err(|e| format!("catalog: {e:?}"))?;
        database
            .ensure_authorization_stream_incarnation()
            .map_err(|e| format!("stream: {e:?}"))?;
        database
            .reconcile_auth_scope_bases(&functions)
            .map_err(|e| format!("scope bases: {e:?}"))?;
        database
            .identity_guest_create(NOW + 1_000_000, NOW, &OsRandom)
            .map_err(|e| format!("guest: {e:?}"))?
    };

    let mut engine = LocalSnapback::open(&path).map_err(|e| format!("reopen target: {e:?}"))?;
    let diagnostics = engine.load_functions(functions.clone());
    if diagnostics.iter().any(|d| {
        matches!(
            d.severity,
            snapback_kernel::diagnostic::DiagnosticSeverity::Error
                | snapback_kernel::diagnostic::DiagnosticSeverity::Fatal
        )
    }) {
        return Err(format!("function publication failed: {diagnostics:?}"));
    }

    // Public, no-feature producer: clone the durable mode record into a second
    // process-local controller and mint authority without any target-engine identity.
    let target_state = engine
        .auth_mode_snapshot()
        .map_err(|e| format!("mode: {e:?}"))?
        .state;
    let foreign_controller = AdmissionController::from_mode_state(&target_state)
        .map_err(|e| format!("foreign controller: {e:?}"))?;
    let foreign_lease = foreign_controller
        .admit_for_mode(AuthMode::Sessions)
        .map_err(|e| format!("foreign lease: {e:?}"))?;
    let forged = InvocationGate::prepare_admitted_authority(
        InvocationSource::AgentGrantManagement,
        AuthMode::Sessions,
        ServerProfile::Test,
        foreign_lease.clone(),
        &WireAuthorityFields::default(),
        ResolvedAppAuthority::Session {
            user_id: victim.user_id.clone(),
            session_id: victim.session_id.clone(),
            provider: "guest".to_owned(),
            generation: 1,
            authority_instance_id: "caller-selected-authority-instance".to_owned(),
            session_not_after_ms: NOW + 1_000_000,
            provider_not_after_ms: None,
            rehearsal_provenance: None,
        },
        Some(AuthClaimsProjection::server_derived(Vec::new(), Vec::new())),
    )
    .map_err(|e| format!("forge prepared authority: {e:?}"))?;
    let forged_clone = forged.clone();

    // F170: a foreign admission lease plus independently authored integration facts mints a client.
    let integration = engine
        .register_oauth_client(
            &foreign_lease,
            AgentsMode::Open,
            None,
            Some("cross-engine client".to_owned()),
            IntegrationRegistrationFacts {
                origin: Some("https://attacker.example".to_owned()),
                redirect_uris: vec!["https://attacker.example/callback".to_owned()],
            },
            ServerProfile::Test,
            NOW + 10,
            &OsRandom,
        )
        .map_err(|e| format!("F170 refused: {e:?}"))?;
    let client_id = engine
        .integration_record_if_present(&integration.user_id)
        .map_err(|e| format!("integration lookup: {e:?}"))?
        .ok_or_else(|| "integration record absent".to_owned())?
        .integration_id;
    println!(
        "OPEN F170 issued_credential={} client={client_id}",
        integration.credential_id
    );

    // F171 -> F172 -> F173: a caller-constructed PreparedAuthority names the
    // victim's public identifiers and completes the entire OAuth consent chain.
    let begun = engine
        .begin_oauth_authorization(
            &forged_clone,
            &client_id,
            "https://attacker.example/callback",
            &["read".to_owned()],
            "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            Some("state"),
            NOW + 20,
            &OsRandom,
        )
        .map_err(|e| format!("F171 refused: {e:?}"))?;
    println!("OPEN F171 request={}", begun.request_id);
    let oauth_grant = engine
        .approve_oauth_grant_request(&forged, &begun.request_id, None, NOW + 21)
        .map_err(|e| format!("F172 refused: {e:?}"))?;
    println!("OPEN F172 approval={oauth_grant:?}");
    let issued = engine
        .issue_oauth_authorization_code(&forged, &begun.request_id, NOW + 22, &OsRandom)
        .map_err(|e| format!("F173 refused: {e:?}"))?;
    let _issued_code = issued;
    println!("OPEN F173 authorization_code_issued=true");

    // Create a separate pending grant through two public partial APIs, then
    // let the same forged root approve it (F188).
    let effect = forged
        .effect_guard("dependent witness pairing setup")
        .map_err(|e| format!("pairing effect guard: {e:?}"))?;
    let pairing = engine
        .mint_pairing_code(&effect, &victim.user_id, NOW + 30, &OsRandom)
        .map_err(|e| format!("mint pairing: {e:?}"))?;
    let presentation = engine
        .present_pairing_code(
            &effect,
            &integration.secret,
            &pairing.request_id,
            &pairing.secret,
            &[GrantScopeRequest::Exact {
                function_id: "fn:oauthQuery".to_owned(),
                kind: ScopedFunctionKind::Query,
            }],
            NOW + 31,
        )
        .map_err(|e| format!("present pairing: {e:?}"))?;
    drop(effect);
    let request_id = match presentation {
        PairingPresentation::Created(request) | PairingPresentation::Existing(request) => {
            request.request_id
        }
    };
    let approved = engine
        .approve_grant_request(&forged, &request_id, None, None, NOW + 32)
        .map_err(|e| format!("F188 refused: {e:?}"))?;
    let grant = match approved {
        GrantApproval::Created(grant) | GrantApproval::Existing(grant) => grant,
    };
    println!(
        "OPEN F188 grant={} victim={}",
        grant.grant_id, grant.effective_user_id
    );

    // Ensure the planners have a real controlled token to select.
    let token = engine
        .mint_scoped_token(
            &integration.secret,
            &grant.grant_id,
            Some(60_000),
            NOW + 33,
            &OsRandom,
        )
        .map_err(|e| format!("mint scoped token through engine sibling: {e:?}"))?;
    let _keeps_functions_owned = functions;
    let single = engine
        .plan_grant_revocation_service_terminal(&forged, &grant.grant_id, NOW + 34)
        .map_err(|e| format!("F190 refused: {e:?}"))?;
    if !single.token_ids().contains(&token.token_id) {
        return Err(format!(
            "F190 plan omitted controlled token: {:?}",
            single.token_ids()
        ));
    }
    println!("OPEN F190 planned_token={}", token.token_id);
    #[cfg(feature = "additive")]
    {
        // Additive-only public roots. Feature unification exposes both direct
        // raw preparation and unmanaged leases to every dependent.
        let raw = InvocationGate::prepare_authority(
            InvocationSource::AgentGrantManagement,
            AuthMode::Sessions,
            ServerProfile::Test,
            target_state.transition_generation,
            77,
            &WireAuthorityFields::default(),
            ResolvedAppAuthority::Session {
                user_id: victim.user_id.clone(),
                session_id: victim.session_id.clone(),
                provider: "guest".to_owned(),
                generation: 1,
                authority_instance_id: "raw-additive-authority".to_owned(),
                session_not_after_ms: NOW + 1_000_000,
                provider_not_after_ms: None,
                rehearsal_provenance: None,
            },
        )
        .map_err(|e| format!("additive prepare_authority: {e:?}"))?;
        let raw_plan = engine
            .plan_grant_revocation_service_terminal(&raw, &grant.grant_id, NOW + 36)
            .map_err(|e| format!("additive F190 refused: {e:?}"))?;
        if !raw_plan.token_ids().contains(&token.token_id) {
            return Err("additive F190 omitted token".to_owned());
        }
        println!("OPEN additive raw PreparedAuthority and unmanaged AdmissionLease accepted");
    }

    // Complete the public F190 planner + public durable-writer composition.
    let single_gate = single
        .acquire_gate()
        .await
        .map_err(|e| format!("F190 terminal gate refused: {e:?}"))?;
    snapback_auth::auth::service_fence::with_service_authority_terminal_gate(single_gate, || {
        engine.revoke_grant_for_user(&forged, &grant.grant_id, NOW + 37)
    })
    .map_err(|e| format!("F190 sibling durable writer refused: {e:?}"))?;

    // Give F191 a distinct still-live token, so F190's required one-shot
    // terminal transition cannot masquerade as a refusal of the bulk route.
    let effect_two = forged
        .effect_guard("dependent witness second pairing setup")
        .map_err(|e| format!("second pairing effect guard: {e:?}"))?;
    let pairing_two = engine
        .mint_pairing_code(&effect_two, &victim.user_id, NOW + 38, &OsRandom)
        .map_err(|e| format!("mint second pairing: {e:?}"))?;
    let presentation_two = engine
        .present_pairing_code(
            &effect_two,
            &integration.secret,
            &pairing_two.request_id,
            &pairing_two.secret,
            &[GrantScopeRequest::Exact {
                function_id: "fn:oauthQuery".to_owned(),
                kind: ScopedFunctionKind::Query,
            }],
            NOW + 39,
        )
        .map_err(|e| format!("present second pairing: {e:?}"))?;
    drop(effect_two);
    let request_two = match presentation_two {
        PairingPresentation::Created(request) | PairingPresentation::Existing(request) => {
            request.request_id
        }
    };
    let grant_two = match engine
        .approve_grant_request(&forged, &request_two, None, None, NOW + 40)
        .map_err(|e| format!("second grant approval: {e:?}"))?
    {
        GrantApproval::Created(grant) | GrantApproval::Existing(grant) => grant,
    };
    let token_two = engine
        .mint_scoped_token(
            &integration.secret,
            &grant_two.grant_id,
            Some(60_000),
            NOW + 41,
            &OsRandom,
        )
        .map_err(|e| format!("mint second scoped token: {e:?}"))?;
    let bulk = engine
        .plan_bulk_grant_revocation_service_terminal(&forged, &integration.user_id, NOW + 42)
        .map_err(|e| format!("F191 refused: {e:?}"))?;
    if !bulk.token_ids().contains(&token_two.token_id) {
        return Err(format!(
            "F191 plan omitted controlled token: {:?}",
            bulk.token_ids()
        ));
    }
    println!("OPEN F191 planned_token={}", token_two.token_id);
    let bulk_gate = bulk
        .acquire_gate()
        .await
        .map_err(|e| format!("F191 terminal gate refused: {e:?}"))?;
    snapback_auth::auth::service_fence::with_service_authority_terminal_gate(bulk_gate, || {
        engine.revoke_grants_by_actor_for_user(&forged, &integration.user_id, NOW + 43)
    })
    .map_err(|e| format!("F191 sibling durable writer refused: {e:?}"))?;
    println!("OPEN F190/F191 public planner + sibling durable writer compositions committed");

    q06_output_travel_witness().await?;
    println!(
        "WITNESS_OK feature_cell={}",
        if cfg!(feature = "additive") {
            "additive"
        } else {
            "no-features"
        }
    );
    let _ = json!({"keeps-serde-linked": true});
    Ok(())
}

/// Stable setup shared by the seven rows whose attack starts from a second
/// public admission controller. The row source owns the hostile composition;
/// setup only provisions the victim and loads the production-shaped engine.
pub struct BaseAttackFixture {
    _directory: tempfile::TempDir,
    pub engine: LocalSnapback,
    pub catalog: LocalDatabase,
    pub provider: Arc<AuthProvider>,
    pub mode_state: AuthModeStateRecord,
    pub victim_user_id: String,
    pub victim_session_id: String,
    pub victim_session_generation: u64,
    pub victim_bearer: String,
    pub route_authority: snapback_sync::auth::coordinator::PreparedBearerAuthority,
}

pub async fn setup_base_attack() -> Result<BaseAttackFixture, String> {
    let directory = tempfile::tempdir().map_err(|error| error.to_string())?;
    let path = directory.path().join("target.sqlite3");
    let functions = provision_sessions(&path)?;

    let mut engine =
        LocalSnapback::open(&path).map_err(|error| format!("open target: {error:?}"))?;
    let diagnostics = engine.load_functions(functions);
    if diagnostics.iter().any(|diagnostic| {
        matches!(
            diagnostic.severity,
            snapback_kernel::diagnostic::DiagnosticSeverity::Error
                | snapback_kernel::diagnostic::DiagnosticSeverity::Fatal
        )
    }) {
        return Err(format!("function publication failed: {diagnostics:?}"));
    }
    let (provider, clock) = fixed_provider(NOW)?;
    let coordinator = engine
        .build_auth_coordinator(&provider, true)
        .map_err(|error| format!("coordinator: {error:?}"))?;
    let mut catalog =
        LocalDatabase::open(&path).map_err(|error| format!("open catalog writer: {error:?}"))?;
    let guest_plan = provider
        .plan_guest_session(
            &mut catalog,
            NOW,
            1_000_000,
            RollingWindowBudgetTerms {
                limit: 100,
                window_ms: 60_000,
            },
            "row-attack-base-guest",
            "row-attacks",
            "local-dependent-witness",
            &format!("sha256:{}", "d".repeat(64)),
            PasswordIssuanceCustody::Bearer,
        )
        .map_err(|error| format!("guest plan: {error:?}"))?;
    let ProviderGuestSessionPlan::Planned(guest_plan) = guest_plan else {
        return Err("guest plan was not newly planned".to_owned());
    };
    let (issuance_plan, guest_context) = guest_plan.into_coordinated_parts();
    let carrier = coordinator
        .premark_issuance(issuance_plan)
        .await
        .map_err(|error| format!("guest premark: {error:?}"))?;
    let commit_plan = guest_context.commit_plan(carrier.plan().commit_plan());
    let attempt = provider.commit_guest_issuance(&mut catalog, &commit_plan);
    let (finish, terminal_targets) = coordinator
        .finish_issuance(carrier, attempt, NOW, clock.monotonic_now())
        .into_parts();
    if !terminal_targets.is_empty() {
        return Err("new guest unexpectedly revoked a prior session".to_owned());
    }
    let IssuanceFinish::Committed { issue, .. } =
        finish.map_err(|error| format!("guest finish: {error:?}"))?
    else {
        return Err("guest issuance did not commit".to_owned());
    };
    let victim_user_id = issue.response().session.user_id.clone();
    let victim_session_id = issue.response().session.id.clone();
    let victim_session_generation = issue.response().session.generation;
    let victim_bearer = issue.response().token().expose_secret().to_owned();
    let mode_state = engine
        .auth_mode_snapshot()
        .map_err(|error| format!("mode: {error:?}"))?
        .state;
    let route_authority = coordinator
        .resolve_required_bearer(&victim_bearer, clock.epoch_ms(), clock.monotonic_now())
        .map_err(|error| format!("route authority: {error:?}"))?;
    Ok(BaseAttackFixture {
        _directory: directory,
        engine,
        catalog,
        provider,
        mode_state,
        victim_user_id,
        victim_session_id,
        victim_session_generation,
        victim_bearer,
        route_authority,
    })
}

/// Production-shaped catalog and admission state used by the F145 dependent
/// composition. The setup owns no authority composition: the attack source
/// selects the callback subject and invokes the public sync consumer itself.
pub struct CallbackAuthorityAttackFixture {
    _directory: tempfile::TempDir,
    pub serving: snapback_kernel::storage::ServingDatabase,
    pub mode_state: AuthModeStateRecord,
}

pub fn setup_callback_authority_attack() -> Result<CallbackAuthorityAttackFixture, String> {
    let directory = tempfile::tempdir().map_err(|error| error.to_string())?;
    let path = directory.path().join("callback-target.sqlite3");
    provision_sessions(&path)?;
    let engine =
        LocalSnapback::open(&path).map_err(|error| format!("open callback target: {error:?}"))?;
    let mode_state = engine
        .auth_mode_snapshot()
        .map_err(|error| format!("callback mode: {error:?}"))?
        .state;
    drop(engine);
    let database =
        LocalDatabase::open(&path).map_err(|error| format!("open callback catalog: {error:?}"))?;
    let serving = snapback_kernel::storage::ServingDatabase::adopt(database)
        .map_err(|error| format!("adopt callback catalog: {error:?}"))?;
    Ok(CallbackAuthorityAttackFixture {
        _directory: directory,
        serving,
        mode_state,
    })
}

/// Production-feature pending-effect catalog exposed through the raw serving
/// owner. The attack source owns every transition composition; setup only
/// provisions the declared API and returns the public bridge plus inert input.
pub struct PendingEffectOwnerBridgeAttackFixture {
    _directory: tempfile::TempDir,
    pub serving: snapback_kernel::storage::ServingDatabase,
    pub request: CreatePendingEffect,
}

pub fn setup_pending_effect_owner_bridge_attack()
-> Result<PendingEffectOwnerBridgeAttackFixture, String> {
    let directory = tempfile::tempdir().map_err(|error| error.to_string())?;
    let path = directory.path().join("pending-effect-owner.sqlite3");
    provision_sessions(&path)?;
    let database =
        LocalDatabase::open(&path).map_err(|error| format!("open pending catalog: {error:?}"))?;
    let serving = snapback_kernel::storage::ServingDatabase::adopt(database)
        .map_err(|error| format!("adopt pending catalog: {error:?}"))?;
    let mut request = pending_request(
        PendingEffectAuthority::Anonymous,
        ArtifactGeneration {
            schema_version: "snapback.v1".to_owned(),
            app_id: "landed-row-recheck".to_owned(),
            schema_hash: format!("{}{}", SCHEMA_V1_PREFIX, "a".repeat(64)),
            bundle_hash: format!("{}{}", FUNCTION_V1_PREFIX, "b".repeat(64)),
            inputs_hash: format!("{}{}", INPUTS_V1_PREFIX, "a".repeat(64)),
        },
        NOW,
    );
    request.approver_principal_id = Some("human-a".to_owned());
    Ok(PendingEffectOwnerBridgeAttackFixture {
        _directory: directory,
        serving,
        request,
    })
}

pub fn integration_facts() -> IntegrationRegistrationFacts {
    IntegrationRegistrationFacts {
        origin: Some("https://attacker.example".to_owned()),
        redirect_uris: vec!["https://attacker.example/callback".to_owned()],
    }
}

pub fn exact_query_scope() -> GrantScopeRequest {
    GrantScopeRequest::Exact {
        function_id: "fn:oauthQuery".to_owned(),
        kind: ScopedFunctionKind::Query,
    }
}

/// Emit one machine-readable observation. A refused composition is an
/// observation, not a process failure; harness/infrastructure failures occur
/// before this function is called and retain a non-zero exit.
pub fn report_observation(row: &str, result: Result<String, String>) {
    let (observed, diagnostic) = match result {
        Ok(diagnostic) => ("OPEN", diagnostic),
        Err(diagnostic) => ("CLOSED", diagnostic),
    };
    println!(
        "SNAPBACK_ROW_ATTACK {}",
        json!({
            "row": row,
            "observed": observed,
            "diagnostic": diagnostic,
        })
    );
}

struct Q06Base {
    directory: tempfile::TempDir,
    engine_a: LocalSnapback,
    engine_b: LocalSnapback,
    provider_a: Arc<AuthProvider>,
    clock_a: Arc<FixedClock>,
    coordinator_a: Arc<snapback_sync::auth::coordinator::AuthCoordinator>,
    coordinator_b: Arc<snapback_sync::auth::coordinator::AuthCoordinator>,
    effect_management_a: snapback_sync::auth::invocation::PreparedAuthority,
    effect_management_b: snapback_sync::auth::invocation::PreparedAuthority,
    token: snapback_kernel::storage::auth_agent_credentials::IssuedScopedToken,
    generation: ArtifactGeneration,
    victim_bearer: String,
}

async fn setup_q06_base() -> Result<Q06Base, String> {
    let directory = tempfile::tempdir().map_err(|error| error.to_string())?;
    let path_a = directory.path().join("engine-a.sqlite3");
    let path_b = directory.path().join("engine-b.sqlite3");
    let functions = provision_sessions(&path_a)?;

    let mut engine_a =
        LocalSnapback::open(&path_a).map_err(|error| format!("open A: {error:?}"))?;
    let diagnostics = engine_a.load_functions(functions.clone());
    if diagnostics.iter().any(|diagnostic| {
        matches!(
            diagnostic.severity,
            snapback_kernel::diagnostic::DiagnosticSeverity::Error
                | snapback_kernel::diagnostic::DiagnosticSeverity::Fatal
        )
    }) {
        return Err(format!("A functions failed: {diagnostics:?}"));
    }
    let (provider_a, clock_a) = fixed_provider(NOW)?;
    let coordinator_a = engine_a
        .build_auth_coordinator(&provider_a, true)
        .map_err(|error| format!("A coordinator: {error:?}"))?;
    let mut catalog_a = LocalDatabase::open(&path_a)
        .map_err(|error| format!("open A catalog writer: {error:?}"))?;
    let guest_plan = provider_a
        .plan_guest_session(
            &mut catalog_a,
            NOW,
            1_000_000,
            RollingWindowBudgetTerms {
                limit: 100,
                window_ms: 60_000,
            },
            "row-attack-guest",
            "row-attacks",
            "local-dependent-witness",
            &format!("sha256:{}", "c".repeat(64)),
            PasswordIssuanceCustody::Bearer,
        )
        .map_err(|error| format!("A guest plan: {error:?}"))?;
    let ProviderGuestSessionPlan::Planned(guest_plan) = guest_plan else {
        return Err("A guest plan was not newly planned".to_owned());
    };
    let (issuance_plan, guest_context) = guest_plan.into_coordinated_parts();
    let carrier = coordinator_a
        .premark_issuance(issuance_plan)
        .await
        .map_err(|error| format!("A guest premark: {error:?}"))?;
    let commit_plan = guest_context.commit_plan(carrier.plan().commit_plan());
    let attempt = provider_a.commit_guest_issuance(&mut catalog_a, &commit_plan);
    let (finish, terminal_targets) = coordinator_a
        .finish_issuance(carrier, attempt, NOW, clock_a.monotonic_now())
        .into_parts();
    if !terminal_targets.is_empty() {
        return Err("new guest unexpectedly revoked a prior session".to_owned());
    }
    let IssuanceFinish::Committed { issue, .. } =
        finish.map_err(|error| format!("A guest finish: {error:?}"))?
    else {
        return Err("A guest issuance did not commit".to_owned());
    };
    let victim_user_id = issue.response().session.user_id.clone();
    let victim_bearer = issue.response().token().expose_secret().to_owned();

    let bindings_a = engine_a
        .claim_app_state_graph(
            ServerProfile::Test,
            snapback_types::auth::deployment::AuthDeploymentTarget::Local,
        )
        .map_err(|error| format!("claim A graph: {error:?}"))?;
    let (controller_a, _, _, _, _, _, _, _) = bindings_a
        .into_parts_for_app_state(&engine_a)
        .map_err(|error| format!("bind A graph: {error:?}"))?;
    let lease_a = controller_a
        .admit_for_mode(AuthMode::Sessions)
        .map_err(|error| format!("A lease: {error:?}"))?;
    let resolved_management_a = coordinator_a
        .resolve_required_bearer(&victim_bearer, NOW, clock_a.monotonic_now())
        .map_err(|error| format!("resolve A management authority: {error:?}"))?;
    let grant_management = engine_a
        .prepare_bearer_authority(
            resolved_management_a.clone(),
            InvocationSource::AgentGrantManagement,
            AuthMode::Sessions,
            ServerProfile::Test,
            lease_a.clone(),
            &WireAuthorityFields::default(),
            NOW,
        )
        .map_err(|error| format!("prepare A grant management: {error:?}"))?;
    let effect_management_a = engine_a
        .prepare_bearer_authority(
            resolved_management_a,
            InvocationSource::EffectManagement,
            AuthMode::Sessions,
            ServerProfile::Test,
            lease_a.clone(),
            &WireAuthorityFields::default(),
            NOW,
        )
        .map_err(|error| format!("prepare A effect management: {error:?}"))?;

    let integration = engine_a
        .register_oauth_client(
            &lease_a,
            None,
            Some("Q06 cross-engine principal".to_owned()),
            IntegrationRegistrationFacts {
                origin: Some("https://q06.example".to_owned()),
                redirect_uris: vec!["https://q06.example/callback".to_owned()],
            },
            ServerProfile::Test,
            NOW + 100,
            &OsRandom,
        )
        .map_err(|error| format!("Q06 registration: {error:?}"))?;
    let effect = grant_management
        .effect_guard("Q06 pairing setup")
        .map_err(|error| format!("Q06 effect guard: {error:?}"))?;
    let pairing = engine_a
        .mint_pairing_code(&effect, &victim_user_id, NOW + 101, &OsRandom)
        .map_err(|error| format!("Q06 pairing mint: {error:?}"))?;
    let presentation = engine_a
        .present_pairing_code(
            &effect,
            &integration.secret,
            &pairing.request_id,
            &pairing.secret,
            &[
                GrantScopeRequest::Exact {
                    function_id: "fn:oauthQuery".to_owned(),
                    kind: ScopedFunctionKind::Query,
                },
                GrantScopeRequest::Exact {
                    function_id: "fn:approvedMutation".to_owned(),
                    kind: ScopedFunctionKind::Mutation,
                },
            ],
            NOW + 102,
        )
        .map_err(|error| format!("Q06 pairing present: {error:?}"))?;
    drop(effect);
    let request_id = match presentation {
        PairingPresentation::Created(request) | PairingPresentation::Existing(request) => {
            request.request_id
        }
    };
    let grant = match engine_a
        .approve_grant_request(&grant_management, &request_id, None, None, NOW + 103)
        .map_err(|error| format!("Q06 grant approval: {error:?}"))?
    {
        GrantApproval::Created(grant) | GrantApproval::Existing(grant) => grant,
    };
    let token = engine_a
        .mint_scoped_token(
            &integration.secret,
            &grant.grant_id,
            Some(60_000),
            NOW + 104,
            &OsRandom,
        )
        .map_err(|error| format!("Q06 token: {error:?}"))?;

    let generation = engine_a
        .function_invocation_facts(AuthMode::Sessions)
        .map_err(|error| format!("A generation: {error:?}"))?
        .ok_or_else(|| "A generation absent".to_owned())?
        .active_generation;
    let image = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create_new(true)
        .open(&path_b)
        .map_err(|error| format!("create B image: {error}"))?;
    engine_a
        .backup_database_image_into(&image)
        .map_err(|error| format!("backup A to B: {error:?}"))?;
    drop(image);
    let mut engine_b =
        LocalSnapback::open(&path_b).map_err(|error| format!("open B: {error:?}"))?;
    let diagnostics_b = engine_b.load_functions(functions);
    if diagnostics_b.iter().any(|diagnostic| {
        matches!(
            diagnostic.severity,
            snapback_kernel::diagnostic::DiagnosticSeverity::Error
                | snapback_kernel::diagnostic::DiagnosticSeverity::Fatal
        )
    }) {
        return Err(format!("B functions failed: {diagnostics_b:?}"));
    }
    let (provider_b, _) = fixed_provider(NOW)?;
    let coordinator_b = engine_b
        .build_auth_coordinator(&provider_b, true)
        .map_err(|error| format!("B coordinator: {error:?}"))?;
    let bindings_b = engine_b
        .claim_app_state_graph(
            ServerProfile::Test,
            snapback_types::auth::deployment::AuthDeploymentTarget::Local,
        )
        .map_err(|error| format!("claim B graph: {error:?}"))?;
    let (controller_b, _, _, _, _, _, _, _) = bindings_b
        .into_parts_for_app_state(&engine_b)
        .map_err(|error| format!("bind B graph: {error:?}"))?;
    let lease_b = controller_b
        .admit_for_mode(AuthMode::Sessions)
        .map_err(|error| format!("B lease: {error:?}"))?;
    let resolved_management_b = coordinator_b
        .resolve_required_bearer(&victim_bearer, NOW, clock_a.monotonic_now())
        .map_err(|error| format!("resolve B management authority: {error:?}"))?;
    let effect_management_b = engine_b
        .prepare_bearer_authority(
            resolved_management_b,
            InvocationSource::EffectManagement,
            AuthMode::Sessions,
            ServerProfile::Test,
            lease_b,
            &WireAuthorityFields::default(),
            NOW,
        )
        .map_err(|error| format!("prepare B effect management: {error:?}"))?;

    Ok(Q06Base {
        directory,
        engine_a,
        engine_b,
        provider_a,
        clock_a,
        coordinator_a,
        coordinator_b,
        effect_management_a,
        effect_management_b,
        token,
        generation,
        victim_bearer,
    })
}

pub struct F157AttackFixture {
    _directory: tempfile::TempDir,
    pub engine: LocalSnapback,
    pub approval: Option<snapback_engine::local::PreparedEffectApproval>,
    pub carrier: snapback_sync::auth::coordinator::PreparedBearerAuthority,
    pub now_ms: u64,
}

pub async fn setup_f157_attack() -> Result<F157AttackFixture, String> {
    let mut base = setup_q06_base().await?;
    let route_session = base
        .coordinator_a
        .resolve_required_bearer(
            &base.victim_bearer,
            base.clock_a.epoch_ms(),
            base.clock_a.monotonic_now(),
        )
        .map_err(|error| format!("A route session: {error:?}"))?;
    let ResolvedAppAuthority::Session(subject) = route_session.resolved() else {
        return Err("A bearer did not resolve to session".to_owned());
    };
    let session_authority = PendingEffectAuthority::Session {
        user_id: subject.user_id().to_owned(),
        session_id: subject.session_id().to_owned(),
        provider: subject.provider().to_owned(),
        generation: subject.generation(),
        authority_instance_id: subject.authority_instance_id().to_owned(),
        authorization_stream_incarnation: base
            .coordinator_a
            .authorization_stream_incarnation()
            .map_err(|error| format!("A incarnation: {error:?}"))?,
    };
    let pending_a = base
        .engine_a
        .create_pending_effect(
            &base.effect_management_a,
            None,
            pending_request(
                session_authority.clone(),
                base.generation.clone(),
                NOW + 120,
            ),
        )
        .map_err(|error| format!("F157 A pending: {error:?}"))?;
    let approval_a = base
        .engine_a
        .prepare_pending_effect_approval(&base.effect_management_a, &pending_a.id, NOW + 121)
        .map_err(|error| format!("F157 A approval: {error:?}"))?;
    let retained_a = match approval_a.original_authority() {
        snapback_kernel::storage::pending_effects::RetainedEffectOriginalAuthority::Session(
            retained,
        ) => retained,
        _ => return Err("F157 A retained arm mismatch".to_owned()),
    };
    let carrier = base
        .coordinator_a
        .prepare_retained_effect_session(&retained_a, NOW + 122, base.clock_a.monotonic_now())
        .map_err(|error| format!("F157 A reconstruction: {error:?}"))?;
    let pending_b = base
        .engine_b
        .create_pending_effect(
            &base.effect_management_b,
            None,
            pending_request(session_authority, base.generation, NOW + 120),
        )
        .map_err(|error| format!("F157 B pending: {error:?}"))?;
    let approval_b = base
        .engine_b
        .prepare_pending_effect_approval(&base.effect_management_b, &pending_b.id, NOW + 121)
        .map_err(|error| format!("F157 B approval: {error:?}"))?;
    Ok(F157AttackFixture {
        _directory: base.directory,
        engine: base.engine_b,
        approval: Some(approval_b),
        carrier,
        now_ms: NOW + 122,
    })
}

pub struct F175AttackFixture {
    _directory: tempfile::TempDir,
    pub engine: LocalSnapback,
    pub coordinator: Arc<snapback_sync::auth::coordinator::AuthCoordinator>,
    pub approval: Option<snapback_engine::local::PreparedEffectApproval>,
    pub resolution: snapback_engine::local::ResolvedServiceAuthority,
    #[cfg(feature = "additive")]
    pub synthetic_approval: Option<snapback_engine::local::PreparedEffectApproval>,
    pub now_ms: u64,
}

pub async fn setup_f175_attack() -> Result<F175AttackFixture, String> {
    let mut base = setup_q06_base().await?;
    let route_service = base
        .engine_a
        .resolve_scoped_token_route_authority(
            &base.token.secret,
            NOW + 130,
            base.clock_a.monotonic_now(),
            base.provider_a.clone(),
        )
        .map_err(|error| format!("A route service: {error:?}"))?;
    let ResolvedAppAuthority::ServicePrincipal(subject) = route_service.resolved() else {
        return Err("A token did not resolve to service principal".to_owned());
    };
    let service_authority = PendingEffectAuthority::ServicePrincipal {
        actor_user_id: subject.actor_user_id().to_owned(),
        credential_id: subject.credential_id().to_owned(),
        credential_generation: subject.credential_generation(),
        grant_id: subject.grant_id().to_owned(),
        token_id: subject.token_id().to_owned(),
        effective_user_id: subject.effective_user_id().map(str::to_owned),
        token_expires_at_ms: subject.token_expires_at_ms(),
    };
    let pending_a = base
        .engine_a
        .create_pending_effect(
            &base.effect_management_a,
            None,
            pending_request(
                service_authority.clone(),
                base.generation.clone(),
                NOW + 131,
            ),
        )
        .map_err(|error| format!("F175 A pending: {error:?}"))?;
    let approval_a = base
        .engine_a
        .prepare_pending_effect_approval(&base.effect_management_a, &pending_a.id, NOW + 132)
        .map_err(|error| format!("F175 A approval: {error:?}"))?;
    let retained_a = match approval_a.original_authority() {
        snapback_kernel::storage::pending_effects::RetainedEffectOriginalAuthority::ServicePrincipal(
            retained,
        ) => retained,
        _ => return Err("F175 A retained arm mismatch".to_owned()),
    };
    let resolution = base
        .engine_a
        .resolve_retained_effect_service_authority(
            &retained_a,
            NOW + 133,
            base.clock_a.monotonic_now(),
            base.provider_a,
        )
        .map_err(|error| format!("F175 A reconstruction: {error:?}"))?;
    let pending_b = base
        .engine_b
        .create_pending_effect(
            &base.effect_management_b,
            None,
            pending_request(
                service_authority.clone(),
                base.generation.clone(),
                NOW + 131,
            ),
        )
        .map_err(|error| format!("F175 B pending: {error:?}"))?;
    let approval_b = base
        .engine_b
        .prepare_pending_effect_approval(&base.effect_management_b, &pending_b.id, NOW + 132)
        .map_err(|error| format!("F175 B approval: {error:?}"))?;
    #[cfg(feature = "additive")]
    let synthetic_approval = {
        let pending = base
            .engine_b
            .create_pending_effect(
                &base.effect_management_b,
                None,
                pending_request(service_authority, base.generation, NOW + 140),
            )
            .map_err(|error| format!("additive F175 B pending: {error:?}"))?;
        Some(
            base.engine_b
                .prepare_pending_effect_approval(&base.effect_management_b, &pending.id, NOW + 141)
                .map_err(|error| format!("additive F175 B approval: {error:?}"))?,
        )
    };
    Ok(F175AttackFixture {
        _directory: base.directory,
        engine: base.engine_b,
        coordinator: base.coordinator_b,
        approval: Some(approval_b),
        resolution,
        #[cfg(feature = "additive")]
        synthetic_approval,
        now_ms: NOW + 133,
    })
}
