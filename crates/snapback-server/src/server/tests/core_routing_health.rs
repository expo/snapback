// Complete test items included at `server::tests` module scope.

#[tokio::test]
async fn network_profile_http_release_marks_delay_and_keeps_normal_identity() {
    let mut snapback = LocalSnapback::memory().expect("network profile fixture");
    let bindings = snapback
        .claim_app_state_graph(
            crate::contract_types::ServerProfile::Test,
            crate::auth::deployment::AuthDeploymentTarget::Local,
        )
        .expect("claim network profile graph");
    let (_, _, _, _, _, _, profiles, _) = bindings
        .into_parts_for_app_state(&snapback)
        .expect("bind network profile graph");
    snapback
        .activate_startup_network_profile(crate::network_profile::NetworkConditionProfile {
            name: "test-delay".to_owned(),
            mutation_ack_delay_ms: 30,
            live_delta_delay_ms: 30,
            query_response_delay_ms: 30,
            jitter_ms: 0,
        })
        .unwrap();

    let ready_at = Instant::now();
    let rejected = super::prepare_mutation_network_egress(
        &profiles,
        crate::network_profile::MutationEgressBasis::ResultReady,
        ready_at,
    )
    .expect("a rejected mutation uses its result-readiness deadline");
    assert!(rejected.release_at() >= ready_at + std::time::Duration::from_millis(30));
    let started = Instant::now();
    let delayed = super::release_network_profiled_response(
        axum::response::Response::new(axum::body::Body::empty()),
        Some(rejected),
    )
    .await;
    assert!(started.elapsed() >= std::time::Duration::from_millis(20));
    assert!(started.elapsed() < std::time::Duration::from_secs(1));
    assert_eq!(
        delayed
            .headers()
            .get(crate::network_profile::NETWORK_PROFILE_HEADER)
            .and_then(|value| value.to_str().ok()),
        Some("test-delay")
    );
    assert_eq!(
        delayed
            .extensions()
            .get::<super::NetworkProfileObservation>()
            .map(|observation| observation.0.profile.name.as_str()),
        Some("test-delay")
    );

    let mut normal_snapback = LocalSnapback::memory().expect("normal network profile fixture");
    let bindings = normal_snapback
        .claim_app_state_graph(
            crate::contract_types::ServerProfile::Test,
            crate::auth::deployment::AuthDeploymentTarget::Local,
        )
        .expect("claim normal network profile graph");
    let (_, _, _, _, _, _, profiles, _) = bindings
        .into_parts_for_app_state(&normal_snapback)
        .expect("bind normal network profile graph");
    let started = Instant::now();
    let normal = super::release_network_profiled_response(
        axum::response::Response::new(axum::body::Body::empty()),
        profiles.admit_result(
            crate::network_profile::NetworkEgressLane::QueryResponse,
            Instant::now(),
        ),
    )
    .await;
    assert!(started.elapsed() < std::time::Duration::from_secs(1));
    assert!(
        normal
            .headers()
            .get(crate::network_profile::NETWORK_PROFILE_HEADER)
            .is_none()
    );
}

#[tokio::test]
async fn poll_lane_marker_uses_frame_admission_snapshot_and_normal_preserves_bytes() {
    let mut context = ServerContext::detached();
    context.profile = ServerProfile::Test;
    let state = test_app_state_from_snapback(
        LocalSnapback::memory().expect("poll marker fixture"),
        context,
    );
    let opened = state
        .connections
        .open(Some("profiled-poll".to_owned()), None, true)
        .expect("open poll grant");
    let prepare_act = || {
        state
            .connections
            .prepare_act(
                &opened.connection_id,
                Some(&opened.connection_token),
                None,
                true,
                super::now_millis(),
                Instant::now(),
            )
            .expect("prepare poll act")
    };
    let live_bytes = serde_json::to_vec(&crate::live_wire::LiveEnvelope::LiveReplace {
        network_profile: None,
        subscription_id: "sub_poll".to_owned(),
        function: "listTodos".to_owned(),
        version: 1,
        rows: vec![],
        resume: None,
    })
    .unwrap();
    state
        .snapback
        .lock()
        .await
        .activate_startup_network_profile(crate::network_profile::NetworkConditionProfile {
            name: "poll-admission".to_owned(),
            mutation_ack_delay_ms: 0,
            live_delta_delay_ms: 1,
            query_response_delay_ms: 0,
            jitter_ms: 0,
        })
        .unwrap();
    let admission = state
        .network_profiles
        .admit_result(
            crate::network_profile::NetworkEgressLane::LiveDelta,
            Instant::now() - Duration::from_millis(1),
        )
        .expect("profiled frame captures admission snapshot");
    state
        .ephemeral
        .enqueue_durable_with_network_egress_for_test(
            &opened.connection_id,
            live_bytes.clone(),
            admission,
        );
    let response = leased_queued_outbox_http_response(&state, prepare_act());
    let batch: Value = serde_json::from_slice(
        &to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("profiled poll body"),
    )
    .unwrap();
    let marked = batch[0]["Durable"]["payload"]
        .as_array()
        .unwrap()
        .iter()
        .map(|byte| byte.as_u64().unwrap() as u8)
        .collect::<Vec<_>>();
    let marked: Value = serde_json::from_slice(&marked).unwrap();
    assert_eq!(marked["network_profile"], "poll-admission");

    state
        .ephemeral
        .enqueue_durable_for_test(&opened.connection_id, live_bytes.clone());
    let response = leased_queued_outbox_http_response(&state, prepare_act());
    let normal_body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("normal poll body");
    let expected_body = serde_json::to_vec(&vec![RealtimeEnvelope::Durable(
        crate::ephemeral::DurableMessage::new(live_bytes.clone()),
    )])
    .unwrap();
    assert_eq!(
        normal_body.as_ref(),
        expected_body,
        "normal poll batch stays byte-identical"
    );
    let batch: Value = serde_json::from_slice(&normal_body).unwrap();
    let normal = batch[0]["Durable"]["payload"]
        .as_array()
        .unwrap()
        .iter()
        .map(|byte| byte.as_u64().unwrap() as u8)
        .collect::<Vec<_>>();
    assert_eq!(
        normal, live_bytes,
        "normal poll payload stays byte-identical"
    );
}

#[tokio::test]
async fn network_profile_admin_api_uses_shared_authorizer_and_activation_gate() {
    let mut context = ServerContext::detached();
    context.profile = ServerProfile::Test;
    context.admin_token = Some("network-profile-admin".to_owned());
    let state = test_app_state_from_snapback(
        LocalSnapback::memory().expect("network profile admin fixture"),
        context,
    );
    let router = app(state.clone());
    let put = router
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri("/_snapback/api/debug/network-profile")
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-snapback-admin-token", "network-profile-admin")
                .body(Body::from(r#""optimistic""#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(put.status(), StatusCode::OK);
    assert_eq!(response_json(put).await["profile"]["name"], "optimistic");

    let get = router
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/_snapback/api/debug/network-profile")
                .header("x-snapback-admin-token", "network-profile-admin")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(get.status(), StatusCode::OK);
    let get = response_json(get).await;
    assert_eq!(get["profile"]["name"], "optimistic");
    assert_eq!(get["provenance"]["source"], "api");

    let console = router
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri("/_snapback/api/debug/network-profile")
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-snapback-admin-token", "network-profile-admin")
                .header(
                    crate::network_profile::NETWORK_PROFILE_SOURCE_HEADER,
                    "console",
                )
                .body(Body::from(r#""normal""#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(console.status(), StatusCode::OK);
    let console = response_json(console).await;
    assert_eq!(console["provenance"]["source"], "console");
    assert!(console["provenance"].get("principal").is_none());

    let mut context = ServerContext::detached();
    context.profile = ServerProfile::Prod;
    context.admin_token = Some("prod-admin".to_owned());
    let prod = test_app_state_from_snapback(
        LocalSnapback::memory().expect("production gate fixture"),
        context,
    );
    let forbidden = app(prod)
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri("/_snapback/api/debug/network-profile")
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-snapback-admin-token", "prod-admin")
                .body(Body::from(r#""optimistic""#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(forbidden.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        response_json(forbidden).await["diagnostic"]["code"],
        crate::network_profile::NETWORK_PROFILE_FORBIDDEN_CODE
    );
}

#[test]
fn one_database_rejects_a_second_independent_app_state_graph() {
    let first = test_detached_app_state(LocalSnapback::memory().expect("shared registry fixture"));
    let clone = first.clone();
    assert!(
        Arc::ptr_eq(&first.snapback, &clone.snapback),
        "router clones retain one engine graph"
    );
    let second = AppState::try_new(
        first.snapback.clone(),
        first.read.clone(),
        first.ephemeral.clone(),
        (*first.server).clone(),
    );
    assert!(
        second.is_err(),
        "a second independent connection/lifecycle graph must be rejected"
    );
}

#[tokio::test]
async fn http_telemetry_uses_registered_names_codes_and_private_unmatched_details() {
    let directory = tempfile::tempdir().expect("telemetry HTTP fixture directory");
    let database_path = directory.path().join("http-telemetry.sqlite3");
    let snapback = LocalSnapback::open(&database_path).expect("file-backed HTTP fixture");
    let state = test_app_state_from_snapback(snapback, bound_loopback_context());
    let telemetry = state.telemetry.clone();
    let router = app(state);

    let health = router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(health.status(), StatusCode::OK);

    let options = router
        .clone()
        .oneshot(
            Request::builder()
                .method("OPTIONS")
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert!(options.status().is_success());

    let failed = router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/request-code")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert!(!failed.status().is_success());

    let unmatched = router
        .oneshot(
            Request::builder()
                .uri("/attacker/path?secret=must-not-survive")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(unmatched.status(), StatusCode::NOT_FOUND);

    telemetry.force_flush().expect("flush HTTP observations");
    let health_count =
        physical_telemetry_events_for_test(&telemetry, Some("http_request"), Some("/health"))
            .into_iter()
            .filter(|event| event.phase == "joined")
            .count();
    assert_eq!(
        health_count, 1,
        "the registered health operation is observed while inert OPTIONS is not"
    );
    let failure_code = physical_telemetry_events_for_test(
        &telemetry,
        Some("http_request"),
        Some("/auth/request-code"),
    )
    .into_iter()
    .rev()
    .find(|event| event.phase == "joined")
    .expect("registered failure observation")
    .code;
    assert!(
        failure_code
            .as_deref()
            .is_some_and(|code| code.starts_with("SNAPBACK_")),
        "the handler diagnostic code crosses the response seam: {failure_code:?}"
    );
    let unmatched_details =
        physical_telemetry_events_for_test(&telemetry, Some("http_request"), Some("_unmatched"))
            .into_iter()
            .rev()
            .find(|event| event.phase == "joined")
            .expect("unmatched observation")
            .details
            .expect("unmatched details JSON");
    assert_eq!(unmatched_details["rawPath"], "/attacker/path");
    assert_eq!(unmatched_details["method"], "GET");
    assert!(!unmatched_details.to_string().contains("must-not-survive"));
}

#[test]
fn ws_connect_observation_joins_once_with_generic_disconnect_cause() {
    let directory = tempfile::tempdir().expect("socket telemetry fixture directory");
    let database_path = directory.path().join("socket-telemetry.sqlite3");
    let telemetry = crate::telemetry::Telemetry::open_for_database(
        &database_path,
        "01900000-0000-7000-8000-000000000001",
        crate::telemetry::TelemetryConfig::default(),
    )
    .expect("file-backed socket telemetry");

    {
        let observation = super::LiveSocketObservation::new(telemetry.start_span(
            "ws_connect",
            "/live/{connection_id}/stream",
            Some("socket-fixture"),
            None,
            true,
        ));
        telemetry.force_flush().expect("flush socket admission");
        let phases = physical_telemetry_events_for_test(&telemetry, Some("ws_connect"), None)
            .into_iter()
            .map(|event| event.phase)
            .collect::<Vec<_>>();
        assert_eq!(phases, vec!["admission"]);
        observation.finish();
    }
    telemetry.force_flush().expect("flush socket terminal");

    let rows = physical_telemetry_events_for_test(&telemetry, Some("ws_connect"), None);
    assert_eq!(rows.len(), 2);
    assert_eq!(
        (rows[0].phase.as_str(), rows[1].phase.as_str()),
        ("admission", "terminal")
    );
    assert_eq!(
        rows[0].generation, rows[1].generation,
        "terminal keeps admitted generation"
    );
    assert_eq!(rows[0].correlation.as_deref(), Some("socket-fixture"));
    assert_eq!(rows[1].correlation.as_deref(), Some("socket-fixture"));
    assert!(
        rows[1].recorded_ts_ms > rows[0].recorded_ts_ms,
        "terminal is completion-bound"
    );
    let details = rows[1].details.as_ref().expect("disconnect cause details");
    assert_eq!(details["cause"], "disconnected");
}

#[test]
fn ws_connect_observation_preserves_typed_terminal_code_and_reason() {
    let directory = tempfile::tempdir().expect("typed socket telemetry directory");
    let database_path = directory.path().join("typed-socket.sqlite3");
    let telemetry = crate::telemetry::Telemetry::open_for_database(
        &database_path,
        "01900000-0000-7000-8000-000000000001",
        crate::telemetry::TelemetryConfig::default(),
    )
    .expect("typed socket telemetry");
    {
        let observation = super::LiveSocketObservation::new(telemetry.start_span(
            "ws_connect",
            "/live/{connection_id}/stream",
            Some("typed-socket"),
            None,
            true,
        ));
        observation
            .terminal
            .record(crate::ephemeral::DeliveryTerminalEvent {
                code: crate::live_wire::LiveAuthErrorCode::SessionExpired,
                reason: crate::live_wire::LiveAuthErrorReason::Revoked,
                authority_disposition: crate::live_wire::LiveAuthorityDisposition::DurableDelete,
                close_by: Instant::now(),
            });
        observation.finish();
    }
    telemetry.force_flush().expect("flush typed terminal");
    let terminal = physical_telemetry_events_for_test(&telemetry, Some("ws_connect"), None)
        .into_iter()
        .find(|event| event.phase == "terminal")
        .expect("typed socket terminal");
    assert_eq!(terminal.status, Some(500));
    assert_eq!(
        terminal.code.as_deref(),
        Some("SNAPBACK_AUTH_SESSION_EXPIRED")
    );
    assert_eq!(terminal.details.unwrap()["cause"], "revoked");
}

#[test]
fn live_service_terminal_failure_emission_records_once() {
    let directory = tempfile::tempdir().expect("service diagnostic directory");
    let database_path = directory.path().join("service-diagnostic.sqlite3");
    let config = crate::telemetry::TelemetryConfig {
        buffer_capacity: 4,
        priority_reserve: 2,
        batch_size: 64,
        max_age_ms: 60_000,
        ..crate::telemetry::TelemetryConfig::default()
    };
    let telemetry = crate::telemetry::Telemetry::open_for_database(
        &database_path,
        "01900000-0000-7000-8000-000000000001",
        config,
    )
    .expect("service diagnostic telemetry");
    let error = crate::diagnostic::SnapbackError::error(
        "SNAPBACK_TEST_SERVICE_FAILURE",
        "auth",
        "closed test failure",
    );
    super::report_live_service_terminal_observation_failure(&telemetry, &error, false);
    for name in ["pressure-one", "pressure-two", "pressure-three"] {
        telemetry.point(
            "log",
            name,
            None,
            None,
            None,
            None,
            crate::telemetry::Priority::Normal,
        );
    }
    telemetry.force_flush().expect("flush service diagnostic");
    let count = physical_telemetry_events_for_test(
        &telemetry,
        Some("diagnostic"),
        Some("SNAPBACK_LIVE_SERVICE_TERMINAL_OBSERVATION_FAILED"),
    )
    .into_iter()
    .filter(|event| {
        event.code.as_deref() == Some("SNAPBACK_LIVE_SERVICE_TERMINAL_OBSERVATION_FAILED")
    })
    .count();
    assert_eq!(count, 1);
}

#[tokio::test]
async fn successful_bind_records_process_ready_exactly_once() {
    let directory = tempfile::tempdir().expect("ready telemetry directory");
    let database_path = directory.path().join("ready.sqlite3");
    let local = LocalSnapback::open(&database_path).expect("ready local instance");
    let telemetry = local.telemetry();
    let state = test_detached_app_state(local);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind ready listener");
    let _bound = super::app(state).bind(listener).expect("couple bound app");
    telemetry.force_flush().expect("flush ready lifecycle");
    let count =
        physical_telemetry_events_for_test(&telemetry, Some("lifecycle"), Some("process_ready"))
            .len();
    assert_eq!(count, 1);

    let direct_path = directory.path().join("direct-ready.sqlite3");
    let direct_local = LocalSnapback::open(&direct_path).expect("direct local instance");
    let direct_telemetry = direct_local.telemetry();
    let direct_state = test_detached_app_state(direct_local);
    let mut direct = super::app(direct_state);
    direct_telemetry
        .force_flush()
        .expect("flush pre-ready lifecycle");
    let before = physical_telemetry_events_for_test(
        &direct_telemetry,
        Some("lifecycle"),
        Some("process_ready"),
    )
    .len();
    assert_eq!(before, 0, "construction alone is not readiness");
    tower::ServiceExt::ready(&mut direct)
        .await
        .expect("direct service ready");
    tower::ServiceExt::ready(&mut direct)
        .await
        .expect("direct service remains ready");
    direct_telemetry
        .force_flush()
        .expect("flush direct readiness");
    let after = physical_telemetry_events_for_test(
        &direct_telemetry,
        Some("lifecycle"),
        Some("process_ready"),
    )
    .len();
    assert_eq!(after, 1, "shared readiness authority is one-shot");
}

#[tokio::test]
async fn hosted_adapter_authority_requires_the_consumed_loopback_listener() {
    let mut state = test_detached_app_state(LocalSnapback::memory().expect("hosted bind instance"));
    Arc::make_mut(&mut state.server).auth_deployment =
        crate::auth::deployment::AuthDeploymentTarget::Hosted;
    let (_adapter_fixture, admission) = hosted_edge_admission_fixture();
    let (state, _renewal) = state
        .with_hosted_edge_admission(admission)
        .await
        .expect("consume the production hosted-edge admission");
    // @ref LLP 0267#71-posture-first-redaction-bounded-storage-localhosted —
    // the production hosted adapter composition inherits the engine's
    // recorder-off default; consuming a verified admission cannot opt capture
    // in.
    assert!(
        !state
            .snapback
            .try_lock()
            .expect("inspect hosted recorder posture")
            .runtime_cost_recorder_enabled_for_test(),
        "verified hosted composition must preserve recorder-off posture",
    );
    assert_eq!(
        state.hosted_listener_binding,
        crate::admin::HostedListenerBinding::Pending,
        "production hosted composition must require the consumed listener",
    );

    let direct = super::app(state.clone())
        .oneshot(
            Request::builder()
                .uri("/auth/session")
                .body(Body::empty())
                .expect("direct hosted request"),
        )
        .await
        .expect("direct hosted response");
    assert_eq!(
        response_json(direct).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_HOSTED_ADMISSION_INVALID",
        "an unbound service cannot consume caller-described topology",
    );

    let non_loopback = tokio::net::TcpListener::bind("0.0.0.0:0")
        .await
        .expect("bind non-loopback regression listener");
    let refused = match super::app(state.clone()).bind(non_loopback) {
        Ok(_) => panic!("hosted authority must not bind a non-loopback listener"),
        Err(error) => error,
    };
    assert_eq!(refused.kind(), std::io::ErrorKind::PermissionDenied);
    assert!(
        refused
            .to_string()
            .contains("SNAPBACK_AUTH_HOSTED_ADMISSION_INVALID")
    );

    let loopback = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind loopback regression listener");
    let post_bind_inspection = state.clone();
    let _bound = super::app(state)
        .bind(loopback)
        .expect("the exact observed loopback listener admits the opaque authority");
    assert!(
        !post_bind_inspection
            .snapback
            .try_lock()
            .expect("inspect bound hosted recorder posture")
            .runtime_cost_recorder_enabled_for_test(),
        "successful hosted listener admission must preserve recorder-off posture",
    );
}

#[tokio::test]
async fn embedded_serving_emits_resolved_exposure_warning_once() {
    let context = crate::admin::ServerContext::new_with_resolved_environment(
        "127.0.0.1",
        0,
        true,
        Some("dev"),
        crate::admin::resolve_exposure(Some("fronted")),
    );
    let warning_witness = context.clone();
    let state = AppState::try_from_snapback(
        LocalSnapback::memory().expect("embedded warning test instance"),
        context,
    )
    .expect("embedded warning app state");
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind embedded warning listener");
    let bound = super::app(state)
        .bind(listener)
        .expect("couple embedded warning app");
    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel();
    let server = tokio::spawn(async move {
        bound
            .serve_with_graceful_shutdown(async move {
                let _ = shutdown_rx.await;
            })
            .await
            .expect("serve embedded warning app");
    });

    tokio::time::timeout(Duration::from_secs(2), async {
        while !warning_witness.startup_warning_was_emitted() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("embedded serving emits its resolved exposure warning");
    assert!(
        !warning_witness.emit_startup_warning_once(),
        "the shared lifecycle guard suppresses a second emission"
    );

    let _ = shutdown_tx.send(());
    server.await.expect("embedded warning server joins");
}

#[tokio::test]
async fn fronted_unset_profile_serves_with_production_refusal_and_no_warning() {
    let context = crate::admin::ServerContext::new_with_resolved_environment(
        "127.0.0.1",
        0,
        true,
        None,
        crate::admin::resolve_exposure(Some("fronted")),
    );
    assert_eq!(context.profile, ServerProfile::Prod);
    let warning_witness = context.clone();
    let state = AppState::try_from_snapback(
        LocalSnapback::memory().expect("fronted production test instance"),
        context,
    )
    .expect("fronted production app state");
    assert!(
        state.dev_identity_capabilities.is_none(),
        "fronted unset production composition must not mint dev-identity capabilities"
    );
    let mint_refusal =
        crate::admin::require_operation_profile(&state.server, "auth.mintSession", false)
            .expect_err("fronted unset production must refuse dev session minting");
    let mint_refusal = mint_refusal.into_response();
    assert_eq!(mint_refusal.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        response_json(mint_refusal).await["diagnostic"]["code"],
        "SNAPBACK_PROFILE_FORBIDS"
    );
    let response = super::app(state)
        .oneshot(
            Request::builder()
                .uri("/inspect")
                .body(Body::empty())
                .expect("fronted inspect request"),
        )
        .await
        .expect("fronted inspect response");
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        response_json(response).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_POLICY_UNAVAILABLE"
    );
    assert!(
        !warning_witness.emit_startup_warning_once(),
        "fronted with an unset profile resolves silently to production"
    );
}

#[test]
fn already_terminal_session_errors_preserve_exact_durable_disposition() {
    let cap = already_terminal_session_error(Some(RevocationReason::CapEviction));
    assert_eq!(cap.0.diagnostic.code, "SNAPBACK_AUTH_SESSION_EXPIRED");
    assert_eq!(cap.0.diagnostic.details["authorityDisposition"], "carrier");

    let logout = already_terminal_session_error(Some(RevocationReason::Logout));
    assert_eq!(
        logout.0.diagnostic.details["authorityDisposition"],
        "durableDelete"
    );

    let legacy = already_terminal_session_error(None);
    assert_eq!(
        legacy.0.diagnostic.details["authorityDisposition"], "carrier",
        "a legacy row without an exact cause witness may not overclassify durable deletion"
    );
}

#[test]
fn production_rehearsal_carrier_refusal_precedes_shape_validation() {
    let mut context = ServerContext::detached();
    context.profile = ServerProfile::Prod;
    let state = test_app_state_from_snapback(
        LocalSnapback::memory().expect("production rehearsal prevalidation fixture"),
        context,
    );
    let absent = super::rehearsal_carrier_hash(&state, &HeaderMap::new()).unwrap_err();
    let mut malformed_headers = HeaderMap::new();
    malformed_headers.insert(
        crate::auth::rehearsal::AUTH_REHEARSAL_CAPABILITY_HEADER,
        HeaderValue::from_static("sbrc_deliberately-malformed"),
    );
    let malformed = super::rehearsal_carrier_hash(&state, &malformed_headers).unwrap_err();
    assert_eq!(
        absent.diagnostic.code,
        "SNAPBACK_AUTH_REHEARSAL_PROFILE_FORBIDDEN"
    );
    assert_eq!(malformed.diagnostic, absent.diagnostic);
}

#[test]
fn rehearsal_operations_pin_each_independent_authority_axis() {
    let mint = super::host_ops_operation_spec("auth.rehearsal.mint", None, false)
        .expect("registered rehearsal mint");
    assert_eq!(mint.path_policy, RoutePolicy::AdminWrite);
    assert_eq!(
        mint.credential_resolution,
        super::CredentialResolution::AdminCredential
    );
    assert_eq!(
        mint.effect_policy,
        super::EffectPolicy::ImpersonationCapability
    );
    assert_eq!(
        mint.response_sensitivity,
        super::ResponseSensitivity::CredentialSecret
    );

    let exercise = super::host_ops_operation_spec("auth.rehearsal.exercise", None, false)
        .expect("registered rehearsal exercise");
    assert_eq!(exercise.path_policy, RoutePolicy::Public);
    assert_eq!(
        exercise.credential_resolution,
        super::CredentialResolution::RehearsalCapability
    );
    assert_eq!(exercise.effect_policy, super::EffectPolicy::RehearsalGrant);
    assert_eq!(
        exercise.response_sensitivity,
        super::ResponseSensitivity::CredentialSecret
    );
}

#[tokio::test]
async fn production_rehearsal_operation_refuses_before_admin_and_body_details() {
    let mut snapback = LocalSnapback::memory().expect("production rehearsal HTTP fixture");
    let keyring = Arc::new(AuthKeyringStore::in_memory());
    snapback
        .remainder_auth_fixture()
        .activate_catalog(keyring.as_ref(), super::now_millis(), &OsRandom)
        .expect("activate auth catalog");
    let provider = Arc::new(
        AuthProvider::new(AuthProviderProfile::Test, keyring).expect("construct auth provider"),
    );
    let mut context = ServerContext::detached();
    context.record_bound_address("127.0.0.1:4287".parse().unwrap());
    context.profile = ServerProfile::Prod;
    let state = test_app_state_from_snapback(snapback, context)
        .with_policy_auth_mode(PolicyAuthMode::Sessions)
        .try_with_auth_provider(provider)
        .expect("auth provider app state");
    let router = app(state);
    let body = serde_json::to_vec(&json!({
        "operation": "auth.rehearsal.mint",
        "function": "must-not-be-resolved",
        "args": { "malformed": true },
    }))
    .unwrap();
    let absent = router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/_snapback/api/host-ops")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body.clone()))
                .unwrap(),
        )
        .await
        .unwrap();
    let malformed = router
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/_snapback/api/host-ops")
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-snapback-admin-token", "malformed-admin")
                .header(
                    crate::admin_impersonation::IMPERSONATION_CAPABILITY_HEADER,
                    "sbic_malformed",
                )
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(malformed.status(), absent.status());
    let absent = response_json(absent).await;
    let malformed = response_json(malformed).await;
    let absent_diagnostic = absent
        .pointer("/diagnostic")
        .or_else(|| absent.pointer("/diagnostics/0"))
        .expect("typed absent-carrier rehearsal profile diagnostic");
    let malformed_diagnostic = malformed
        .pointer("/diagnostic")
        .or_else(|| malformed.pointer("/diagnostics/0"))
        .expect("typed malformed-carrier rehearsal profile diagnostic");
    assert_eq!(
        absent_diagnostic["code"],
        "SNAPBACK_AUTH_REHEARSAL_PROFILE_FORBIDDEN"
    );
    assert_eq!(malformed_diagnostic, absent_diagnostic);
}

#[tokio::test]
async fn rehearsal_capability_manifest_reports_absent_available_and_active() {
    let mut snapback = LocalSnapback::memory().expect("rehearsal manifest fixture");
    let keyring = Arc::new(AuthKeyringStore::in_memory());
    snapback
        .remainder_auth_fixture()
        .activate_catalog(keyring.as_ref(), super::now_millis(), &OsRandom)
        .expect("activate auth catalog");
    let provider = Arc::new(
        AuthProvider::new(AuthProviderProfile::Test, keyring).expect("construct auth provider"),
    );
    let mut context = ServerContext::detached();
    context.record_bound_address("127.0.0.1:4287".parse().unwrap());
    context.profile = ServerProfile::Test;
    let mut state = test_app_state_from_snapback(snapback, context)
        .try_with_auth_provider(provider)
        .expect("auth provider app state")
        .with_auth_runtime_facts(
            settled_sessions_state(),
            AuthProgramReadiness::new(true, true, true, true, true, true, true),
        )
        .expect("install settled rehearsal sessions posture");

    assert_eq!(projected_rehearsal_status(&state).await, "available");
    state
        .auth_coordinator
        .as_ref()
        .expect("rehearsal coordinator")
        .publish_rehearsal_window(&crate::auth::rehearsal::AuthRehearsalWindowV1 {
            kind: "test".to_owned(),
            window_id: "window-active".to_owned(),
            grant_id: "grant-active".to_owned(),
            window_plan_id: "plan-active".to_owned(),
            namespace_digest: "test".to_owned(),
            instance_id: "instance-active".to_owned(),
            boot_nonce: "boot-active".to_owned(),
            app_id: "app-active".to_owned(),
            activation_digest: "test".to_owned(),
            created_at: super::now_millis(),
            expires_at: super::now_millis() + 60_000,
            revoked_at: None,
        });
    assert_eq!(projected_rehearsal_status(&state).await, "active");
    Arc::make_mut(&mut state.server).profile = ServerProfile::Prod;
    assert_eq!(projected_rehearsal_status(&state).await, "absent");
}

#[test]
fn rehearsal_host_op_future_sizes_stay_heap_bounded() {
    let (state, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
    let Extension(route_admission) = test_route_admission(&state);
    let request: crate::host_ops::HostOpsRequest = serde_json::from_value(json!({
        "operation": "auth.rehearsal.exercise",
        "args": {
            "effect": "challenge.capture",
            "idempotencyKey": "future-size",
            "challengeId": "challenge-size-fixture",
        },
    }))
    .expect("rehearsal exercise request");
    let headers = HeaderMap::new();

    let auth = super::execute_auth_host_operation(
        &state,
        &headers,
        None,
        &route_admission,
        None,
        request.clone(),
        None,
    );
    let auth_size = std::mem::size_of_val(&auth);
    drop(auth);
    let inner = super::host_ops_handler_inner(
        State(state.clone()),
        Some(Extension(route_admission.clone())),
        None,
        None,
        headers.clone(),
        Json(request.clone()),
    );
    let inner_size = std::mem::size_of_val(&inner);
    drop(inner);
    let outer = super::host_ops_handler(
        State(state),
        Some(Extension(route_admission)),
        None,
        None,
        headers,
        Json(request),
    );
    let outer_size = std::mem::size_of_val(&outer);
    drop(outer);

    eprintln!(
        "rehearsal host-op future sizes: execute_auth={auth_size}, inner={inner_size}, outer={outer_size}"
    );
    assert!(
        auth_size <= 23_000,
        "auth dispatcher future regrew beyond its owner-crate 22,560-byte size: {auth_size}"
    );
    assert!(
        inner_size <= 30_000,
        "host-op inner future regrew beyond its owner-crate 28,952-byte size: {inner_size}"
    );
    assert!(
        outer_size <= 9_000,
        "host-op outer future regrew beyond its recorded 8,224-byte size: {outer_size}"
    );
}

/// @ref LLP 0213#effect-execution-and-audit — the real provider mailbox is
/// released through rehearsal only after the protected attempt charge commits;
/// an exact request-bound retry returns the frozen outcome without new debt.
#[tokio::test]
async fn rehearsal_capture_releases_after_charge_and_exact_retry_is_free() {
    let mut snapback = LocalSnapback::memory().expect("rehearsal capture fixture");
    let keyring = Arc::new(AuthKeyringStore::in_memory());
    snapback
        .remainder_auth_fixture()
        .activate_catalog(keyring.as_ref(), super::now_millis(), &OsRandom)
        .expect("activate rehearsal capture catalog");
    let provider = Arc::new(
        AuthProvider::new(AuthProviderProfile::Test, keyring)
            .expect("construct rehearsal capture provider"),
    );
    let (registry, operator) = ImpersonationCapabilityRegistry::generate(
        "rehearsal-capture-fixture".to_owned(),
        &OsRandom,
    )
    .expect("generate rehearsal capture impersonation capability");
    let mut impersonation = None;
    operator
        .emit_once_to_terminal(|value| {
            impersonation = Some(value.to_owned());
            Ok(())
        })
        .expect("capture rehearsal test impersonation capability");
    let impersonation = impersonation.expect("captured rehearsal impersonation capability");
    let mut context = ServerContext::detached();
    context.record_bound_address("127.0.0.1:4287".parse().unwrap());
    context.profile = ServerProfile::Test;
    context.admin_token = Some("auth-http-admin".to_owned());
    let state = activate_test_sessions(
        test_app_state_from_snapback(snapback, context)
            .with_policy_auth_mode(PolicyAuthMode::Sessions)
            .with_impersonation_capabilities(registry)
            .try_with_auth_provider(provider)
            .expect("auth provider app state"),
    );
    let email = "rehearsal-capture@example.test";
    let provider = state.auth_provider.clone().expect("rehearsal provider");
    let admission = provider
        .admit_email(email)
        .await
        .expect("admit rehearsal capture address");
    let now_ms = provider.now_ms();
    let requested = with_snapback(&state.snapback, move |snapback| {
        snapback
            .remainder_auth_fixture()
            .request_code(&admission, now_ms)
    })
    .await
    .expect("request rehearsal capture challenge");
    let challenge_id = requested.challenge_id;
    let router = app(state);
    let address = crate::auth::crypto::CanonicalAddress::parse(email).unwrap();
    let expires_at = super::now_millis() + 60_000;
    let mint = router
        .clone()
        .oneshot(auth_http_request(
            "POST",
            "/_snapback/api/host-ops",
            serde_json::to_vec(&json!({
                "operation": "auth.rehearsal.mint",
                "requestId": "hop_rehearsal_capture_mint",
                "args": {
                    "scopes": ["challenge.capture"],
                    "effectSelectors": {
                        "challenge.capture": {
                            "contacts": [{
                                "kind": "exactContact",
                                "canonicalAddressDigest": crate::auth::rehearsal::contact_digest(&address),
                            }],
                        },
                    },
                    "limits": {
                        "challengeAttempts": 2,
                        "identityCreates": 0,
                        "sessionMints": 0,
                        "verificationSimulations": 0,
                        "windowInstalls": 0,
                        "clockAdvances": 0,
                        "allocationCeiling": 0,
                        "maxUses": 2,
                    },
                    "expiresAt": expires_at,
                    "idempotencyKey": "mint-rehearsal-capture",
                    "operatorAuditId": "operator-rehearsal-capture",
                },
            }))
            .unwrap(),
            true,
            Some("auth-http-admin"),
            Some(&impersonation),
        ))
        .await
        .expect("mint capture rehearsal grant");
    assert_eq!(mint.status(), StatusCode::OK);
    assert_eq!(mint.headers()[header::CACHE_CONTROL], "no-store, private");
    let mint = response_json(mint).await;
    assert_eq!(mint["ok"], true, "{mint:#}");
    let carrier = mint["data"]["carrier"]
        .as_str()
        .expect("one-time rehearsal carrier")
        .to_owned();
    let grant_id = mint["data"]["grant"]["grantId"]
        .as_str()
        .expect("rehearsal grant id")
        .to_owned();

    let exercise_body = serde_json::to_vec(&json!({
        "operation": "auth.rehearsal.exercise",
        "requestId": "hop_rehearsal_capture_exercise",
        "args": {
            "effect": "challenge.capture",
            "idempotencyKey": "capture-rehearsal-code",
            "challengeId": challenge_id,
        },
    }))
    .unwrap();
    let capture_request_with = |presented: Option<&str>| {
        let mut request = auth_http_request(
            "POST",
            "/_snapback/api/host-ops",
            exercise_body.clone(),
            true,
            None,
            None,
        );
        if let Some(presented) = presented {
            request.headers_mut().insert(
                crate::auth::rehearsal::AUTH_REHEARSAL_CAPABILITY_HEADER,
                HeaderValue::from_str(presented).unwrap(),
            );
        }
        request
    };
    let unknown = crate::auth::crypto::RehearsalBearer::generate(&OsRandom)
        .unwrap()
        .expose_secret()
        .to_owned();
    let mut carrier_refusal = None;
    for presented in [
        None,
        Some("sbrc_deliberately-malformed"),
        Some(unknown.as_str()),
    ] {
        let response = router
            .clone()
            .oneshot(capture_request_with(presented))
            .await
            .expect("non-enumerating rehearsal carrier refusal");
        assert_eq!(response.status(), StatusCode::OK);
        let response = response_json(response).await;
        assert_eq!(response["ok"], false, "{response:#}");
        assert_eq!(
            response["diagnostics"][0]["code"],
            "SNAPBACK_AUTH_REHEARSAL_CARRIER_REQUIRED"
        );
        match &carrier_refusal {
            Some(expected) => assert_eq!(&response["diagnostics"], expected),
            None => carrier_refusal = Some(response["diagnostics"].clone()),
        }
    }
    let capture_request = || capture_request_with(Some(&carrier));
    let captured = router
        .clone()
        .oneshot(capture_request())
        .await
        .expect("capture rehearsal code");
    let captured_status = captured.status();
    assert_eq!(
        captured.headers()[header::CACHE_CONTROL],
        "no-store, private"
    );
    let captured = response_json(captured).await;
    assert_eq!(captured_status, StatusCode::OK, "{captured:#}");
    assert_eq!(captured["ok"], true, "{captured:#}");
    assert_eq!(captured["data"]["challengeId"], challenge_id);
    assert!(captured["data"]["code"].as_str().is_some());

    let replay = router
        .clone()
        .oneshot(capture_request())
        .await
        .expect("replay exact rehearsal capture");
    assert_eq!(replay.status(), StatusCode::OK);
    assert_eq!(response_json(replay).await["data"], captured["data"]);

    let status = router
        .oneshot(auth_http_request(
            "POST",
            "/_snapback/api/host-ops",
            serde_json::to_vec(&json!({
                "operation": "auth.rehearsal.status",
                "requestId": "hop_rehearsal_capture_status",
                "args": { "grantId": grant_id },
            }))
            .unwrap(),
            true,
            Some("auth-http-admin"),
            None,
        ))
        .await
        .expect("inspect capture rehearsal budget");
    assert_eq!(status.status(), StatusCode::OK);
    let status = response_json(status).await;
    assert_eq!(status["ok"], true, "{status:#}");
    assert_eq!(
        status["data"]["grants"][0]["remaining"]["challengeAttempts"],
        1
    );
    assert_eq!(status["data"]["grants"][0]["remaining"]["uses"], 1);
}

#[tokio::test]
async fn remote_mcp_stateless_protocol_lists_and_calls_the_anonymous_external_set() {
    let state = sessions_activation_server_fixture_with_integrations_async().await;
    let runtime = state.clone();
    let router = app(state);

    let initialized = router
        .clone()
        .oneshot(mcp_protocol_request(
            "POST",
            json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2025-06-18",
                    "capabilities": {},
                    "clientInfo": { "name": "acceptance", "version": "1" }
                }
            }),
            None,
            None,
            Some("application/json, text/event-stream"),
        ))
        .await
        .unwrap();
    assert_eq!(initialized.status(), StatusCode::OK);
    assert!(initialized.headers().get("mcp-session-id").is_none());
    let initialized = response_json(initialized).await;
    assert_eq!(initialized["result"]["protocolVersion"], "2025-06-18");
    assert_eq!(
        initialized["result"]["capabilities"]["tools"]["listChanged"],
        false
    );
    assert_eq!(
        initialized["result"]["capabilities"]["resources"]["subscribe"],
        false
    );
    assert!(
        initialized["result"]["instructions"]
            .as_str()
            .unwrap()
            .contains("target-conditional")
    );
    assert!(
        initialized["result"]["instructions"]
            .as_str()
            .unwrap()
            .contains("synchronous MCP tool")
    );

    let mut rebound = mcp_protocol_request(
        "POST",
        json!({ "jsonrpc": "2.0", "id": 7, "method": "tools/list" }),
        None,
        None,
        None,
    );
    rebound.headers_mut().insert(
        header::ORIGIN,
        HeaderValue::from_static("https://dns-rebinding.invalid"),
    );
    let rebound = router.clone().oneshot(rebound).await.unwrap();
    assert_eq!(rebound.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        response_json(rebound).await["diagnostic"]["code"],
        "SNAPBACK_API_EXPOSURE_DENIED"
    );

    for method in ["GET", "DELETE"] {
        let response = router
            .clone()
            .oneshot(mcp_protocol_request(method, json!({}), None, None, None))
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            StatusCode::METHOD_NOT_ALLOWED,
            "{method}"
        );
        assert_eq!(response.headers()[header::ALLOW], "POST");
    }

    let listed = router
        .clone()
        .oneshot(mcp_protocol_request(
            "POST",
            json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }),
            None,
            None,
            None,
        ))
        .await
        .unwrap();
    assert_eq!(listed.status(), StatusCode::OK);
    let listed = response_json(listed).await;
    assert!(
        listed["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .find(|tool| tool["name"] == "run_code")
            .unwrap()["description"]
            .as_str()
            .unwrap()
            .contains("per-target conditional")
    );
    let tools = listed["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|tool| tool["name"].as_str().unwrap())
        .collect::<BTreeSet<_>>();
    assert_eq!(
        tools,
        BTreeSet::from([
            "describe_api",
            "run_code",
            "snapback_fn_fn_listitems",
            "snapback_fn_fn_liveitems",
        ])
    );
    assert_eq!(
        listed["result"]["_meta"]["snapback/ask"],
        "disabled-by-manifest"
    );

    let described = router
        .clone()
        .oneshot(mcp_protocol_request(
            "POST",
            json!({
                "jsonrpc": "2.0",
                "id": 8,
                "method": "tools/call",
                "params": { "name": "describe_api", "arguments": {} }
            }),
            None,
            None,
            None,
        ))
        .await
        .unwrap();
    let described = response_json(described).await;
    assert_eq!(
        described["result"]["structuredContent"]["runCode"]["path"],
        "/api/v1/run"
    );
    assert_eq!(
        described["result"]["structuredContent"]["ask"]["enabled"],
        false
    );

    let run_code = router
        .clone()
        .oneshot(mcp_protocol_request(
            "POST",
            json!({
                "jsonrpc": "2.0",
                "id": 9,
                "method": "tools/call",
                "params": {
                    "name": "run_code",
                    "arguments": {
                        "program": "return null",
                        "envelopeDigest": listed["result"]["_meta"]["snapback/envelopeDigest"],
                        "args": {}
                    }
                }
            }),
            None,
            None,
            None,
        ))
        .await
        .unwrap();
    let run_code = response_json(run_code).await;
    assert_eq!(run_code["result"]["isError"], true);
    assert_eq!(
        run_code["result"]["structuredContent"]["error"]["diagnostic"]["code"],
        "SNAPBACK_API_RUN_UNTRUSTED_CODE_UNSUPPORTED"
    );

    let resources = router
        .clone()
        .oneshot(mcp_protocol_request(
            "POST",
            json!({ "jsonrpc": "2.0", "id": 3, "method": "resources/list" }),
            None,
            None,
            None,
        ))
        .await
        .unwrap();
    assert_eq!(
        response_json(resources).await["result"]["resources"]
            .as_array()
            .unwrap()
            .len(),
        3
    );

    let declared_id = "mcp-client/ops@example.test";
    let called = router
        .clone()
        .oneshot(mcp_protocol_request(
            "POST",
            json!({
                "jsonrpc": "2.0",
                "id": 4,
                "method": "tools/call",
                "params": {
                    "name": "snapback_fn_fn_listitems",
                    "arguments": { "args": {} }
                }
            }),
            None,
            Some(declared_id),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(called.status(), StatusCode::OK);
    assert_eq!(
        called.headers()[super::SNAPBACK_CLIENT_ID_STATUS_HEADER],
        "accepted"
    );
    let called = response_json(called).await;
    assert_eq!(called["result"]["isError"], false);
    assert_eq!(
        called["result"]["structuredContent"]["rows"][0]["value"],
        "predecessor-visible"
    );

    let hidden = router
        .clone()
        .oneshot(mcp_protocol_request(
            "POST",
            json!({
                "jsonrpc": "2.0",
                "id": 5,
                "method": "tools/call",
                "params": {
                    "name": "snapback_fn_fn_queuedwrite",
                    "arguments": { "args": { "value": "must-not-write" } }
                }
            }),
            None,
            None,
            None,
        ))
        .await
        .unwrap();
    assert_eq!(hidden.status(), StatusCode::OK);
    let hidden = response_json(hidden).await;
    assert_eq!(hidden["result"]["isError"], true);
    assert_eq!(
        hidden["result"]["structuredContent"]["error"]["diagnostic"]["code"],
        "SNAPBACK_API_EXPOSURE_DENIED"
    );

    let sse = router
        .clone()
        .oneshot(mcp_protocol_request(
            "POST",
            json!({ "jsonrpc": "2.0", "id": 6, "method": "ping" }),
            None,
            None,
            Some("text/event-stream"),
        ))
        .await
        .unwrap();
    assert_eq!(sse.status(), StatusCode::OK);
    assert!(
        sse.headers()[header::CONTENT_TYPE]
            .to_str()
            .unwrap()
            .starts_with("text/event-stream")
    );
    let sse = String::from_utf8(to_bytes(sse.into_body(), 4096).await.unwrap().to_vec()).unwrap();
    assert!(sse.starts_with("event: message\ndata: {"));

    let declared_id = declared_id.to_owned();
    let row = with_snapback(&runtime.snapback, move |snapback| {
        snapback
            .remainder_auth_fixture()
            .declared_client_for_admission(&declared_id, super::now_millis())
    })
    .await
    .unwrap()
    .expect("MCP declared caller creates the shared ledger row");
    let caller_key = super::declared_client_caller_key(&row.normalized_id);
    let stats = runtime
        .telemetry
        .query_stats(&crate::telemetry_query::TelemetryStatsRequestV1 {
            filter: crate::telemetry_query::TelemetryStatsFilterV1 {
                kind: Some("function_run".to_owned()),
                name: Some("listItems".to_owned()),
                ..Default::default()
            },
            group_by_caller: true,
        })
        .unwrap();
    assert!(
        stats.caller_counts.iter().any(|row| {
            row.lane == "declared" && row.caller_key == caller_key && row.count >= 1
        })
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn dev_direct_functions_load_admission_closes_stage_race() {
    let (state, _) = tokio::task::spawn_blocking(|| {
        let _sanction = crate::exec_guard::BlockingSanction::acquire();
        auth_runtime_fixture(PolicyAuthMode::Dev)
    })
    .await
    .expect("construct dev fixture off async workers");
    let router = app(state.clone());
    let controller = state.auth_admission_controller();
    let app_lock = state.snapback.lock().await;
    let request = auth_http_request(
        "POST",
        "/_snapback/api/functions/load",
        serde_json::to_vec(&FunctionManifest::default()).unwrap(),
        true,
        Some("auth-http-admin"),
        None,
    );
    let load = tokio::spawn(async move {
        router
            .oneshot(request)
            .await
            .expect("paused dev function-load response")
    });
    tokio::time::timeout(Duration::from_secs(2), async {
        while controller.snapshot().in_flight == 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("direct load acquires managed admission before the app lock");

    let transition = tokio::task::spawn_blocking({
        let controller = controller.clone();
        move || {
            let guard = controller.begin_transition()?;
            drop(guard);
            Ok::<(), SnapbackError>(())
        }
    });
    tokio::time::timeout(Duration::from_secs(2), async {
        while controller.snapshot().accepting {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("stage closes new admission while load is paused after routing");
    assert!(!transition.is_finished());

    drop(app_lock);
    let response = tokio::time::timeout(Duration::from_secs(2), load)
        .await
        .expect("predecessor load reaches its response")
        .expect("load task joins");
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert!(
        !transition.is_finished(),
        "stage cannot reach its durable cut while the predecessor response body owns admission"
    );
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("drain predecessor load response");
    assert_eq!(
        serde_json::from_slice::<Value>(&body).expect("pending response JSON")["diagnostic"]["code"],
        "SNAPBACK_AUTH_MODE_PENDING"
    );
    tokio::time::timeout(Duration::from_secs(2), transition)
        .await
        .expect("stage resumes after the response drain")
        .expect("transition task joins")
        .expect("transition acquisition succeeds");
    assert!(controller.snapshot().accepting);
}

#[tokio::test(start_paused = true)]
async fn admitted_body_ingestion_times_out_strictly_below_quiescence_deadline() {
    let (state, _) = tokio::task::spawn_blocking(|| {
        let _sanction = crate::exec_guard::BlockingSanction::acquire();
        auth_runtime_fixture(PolicyAuthMode::Dev)
    })
    .await
    .expect("construct dev fixture off async workers");
    let router = app(state.clone());
    let controller = state.auth_admission_controller();
    let started = tokio::time::Instant::now();
    let response = router
        .oneshot(stalled_admitted_request("/mutation/missing_function"))
        .await
        .expect("stalled body reaches its deadline refusal");
    let elapsed = started.elapsed();
    assert!(
        elapsed >= Duration::from_millis(ADMITTED_BODY_INGEST_DEADLINE_MS),
        "ingest refusal arrived before the deadline: {elapsed:?}"
    );
    assert!(
        elapsed < Duration::from_millis(crate::auth::admission::AUTH_MODE_QUIESCENCE_TIMEOUT_MS),
        "admitted request lifetime reached the quiescence deadline: {elapsed:?}"
    );
    assert_eq!(response.status(), StatusCode::REQUEST_TIMEOUT);
    let body = response_json(response).await;
    assert_eq!(body["diagnostic"]["code"], "SNAPBACK_REQUEST_BODY_TIMEOUT");
    assert_eq!(
        body["diagnostic"]["details"]["deadlineMs"],
        json!(ADMITTED_BODY_INGEST_DEADLINE_MS)
    );
    assert_eq!(
        controller.snapshot().in_flight,
        0,
        "the deadline refusal must release its admission root"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn admitted_body_ingestion_cancels_when_admission_closes() {
    let (state, _) = tokio::task::spawn_blocking(|| {
        let _sanction = crate::exec_guard::BlockingSanction::acquire();
        auth_runtime_fixture(PolicyAuthMode::Dev)
    })
    .await
    .expect("construct dev fixture off async workers");
    let router = app(state.clone());
    let controller = state.auth_admission_controller();
    let request = stalled_admitted_request("/mutation/missing_function");
    let stalled = tokio::spawn(async move {
        router
            .oneshot(request)
            .await
            .expect("stalled body reaches its close refusal")
    });
    tokio::time::timeout(Duration::from_secs(2), async {
        while controller.snapshot().in_flight == 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("stalled body owns a managed admission root");

    // The full 30000 ms staging barrier must not be consumed: the close
    // cancels ingestion immediately instead of waiting out the deadline.
    let transition = tokio::spawn({
        let controller = controller.clone();
        async move { controller.begin_transition_async(|| Ok(())).await }
    });
    tokio::time::timeout(Duration::from_secs(2), async {
        while controller.snapshot().accepting {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("stage closes admission while the body is still arriving");

    // The refusal is a response on the still-connected client, not a
    // disconnect, and draining it releases the admission root.
    let response = tokio::time::timeout(Duration::from_secs(2), stalled)
        .await
        .expect("stalled request is refused at epoch close")
        .expect("stalled request task joins");
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    let body = response_json(response).await;
    assert_eq!(body["diagnostic"]["code"], "SNAPBACK_AUTH_MODE_PENDING");

    let transition = tokio::time::timeout(Duration::from_secs(5), transition)
        .await
        .expect("stage quiesces a stalled admitted body without timing out")
        .expect("transition task joins")
        .expect("transition acquisition succeeds");
    let reopened = transition
        .abort_and_reopen()
        .expect("reopen the unchanged generation");
    assert!(reopened.accepting);
    assert_eq!(reopened.in_flight, 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn direct_functions_load_quiesces_old_query_body_and_activates_complete_pair() {
    let state = sessions_activation_server_fixture_async().await;
    let router = app(state.clone());
    let controller = state.auth_admission_controller();
    let predecessor_admission = controller.snapshot();
    let predecessor_mode = state.auth_mode_state();
    let predecessor_bundle = predecessor_mode
        .active_deployment
        .as_ref()
        .expect("predecessor deployment")
        .bundle_hash
        .clone();

    let rejected = router
        .clone()
        .oneshot(auth_http_request(
            "POST",
            "/_snapback/api/functions/load",
            serde_json::to_vec(&legacy_v0_activation_bypass_manifest()).unwrap(),
            true,
            Some("auth-http-admin"),
            None,
        ))
        .await
        .expect("legacy direct load rejection");
    assert!(
        !rejected.status().is_success(),
        "sessions mode must never enter the raw v0 function loader"
    );
    let rejected = response_json(rejected).await;
    assert!(
        rejected["diagnostic"]["code"]
            .as_str()
            .is_some_and(|code| code.contains("ARTIFACT") || code.contains("CAPABILITY")),
        "complete-pair preflight must own the rejection: {rejected}"
    );
    assert_eq!(
        state
            .auth_mode_state()
            .active_deployment
            .as_ref()
            .expect("unchanged deployment")
            .bundle_hash,
        predecessor_bundle
    );

    let mut query = auth_http_request(
        "POST",
        "/query/listItems",
        br#"{}"#.to_vec(),
        true,
        None,
        None,
    );
    offer_auth_client_protocol(&mut query);
    let old_response = router
        .clone()
        .oneshot(query)
        .await
        .expect("predecessor query response");
    assert_eq!(old_response.status(), StatusCode::OK);

    let successor_functions = activation_functions('4', true);
    let successor_bundle = successor_functions
        .bundle_hash
        .clone()
        .expect("successor bundle");
    let activation_request = auth_http_request(
        "POST",
        "/_snapback/api/functions/load",
        serde_json::to_vec(&successor_functions).unwrap(),
        true,
        Some("auth-http-admin"),
        None,
    );
    let activation = tokio::spawn({
        let router = router.clone();
        async move {
            router
                .oneshot(activation_request)
                .await
                .expect("direct activation response")
        }
    });
    tokio::time::timeout(Duration::from_secs(2), async {
        while controller.snapshot().accepting {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("activation closes admission while old response is paused");
    assert_eq!(controller.snapshot().in_flight, 1);
    assert!(
        !activation.is_finished(),
        "the durable activation cannot overtake an unpolled predecessor query body"
    );

    let old_body = to_bytes(old_response.into_body(), usize::MAX)
        .await
        .expect("publish predecessor query body under its still-live epoch");
    let old_body: Value = serde_json::from_slice(&old_body).expect("old query JSON");
    assert_eq!(old_body["rows"].as_array().map(Vec::len), Some(1));

    let activated = tokio::time::timeout(Duration::from_secs(2), activation)
        .await
        .expect("activation resumes after predecessor response drains")
        .expect("activation task joins");
    assert_eq!(activated.status(), StatusCode::OK);
    let _ = response_json(activated).await;
    let reopened = controller.snapshot();
    assert!(reopened.accepting);
    assert_eq!(reopened.in_flight, 0);
    assert_ne!(
        reopened.admission_epoch,
        predecessor_admission.admission_epoch
    );
    assert_eq!(
        state
            .auth_mode_state()
            .active_deployment
            .as_ref()
            .expect("successor deployment")
            .bundle_hash,
        successor_bundle
    );

    let (durable_authorization, projected_authorization) =
        with_snapback(&state.snapback, |snapback| {
            (
                snapback
                    .remainder_auth_fixture()
                    .authorization_version()
                    .expect("durable activation authorization"),
                snapback
                    .auth_invalidation_expectation_for_test()
                    .expect("projected activation authorization"),
            )
        })
        .await;
    assert_eq!(projected_authorization, durable_authorization);

    let mut successor_query = auth_http_request(
        "POST",
        "/query/listItems",
        br#"{}"#.to_vec(),
        true,
        None,
        None,
    );
    offer_auth_client_protocol(&mut successor_query);
    let successor_response = router
        .oneshot(successor_query)
        .await
        .expect("successor query response");
    assert_eq!(successor_response.status(), StatusCode::OK);
    assert_eq!(
        response_json(successor_response).await["rows"],
        json!([]),
        "every query admitted after activation observes the successor policy"
    );
}

#[tokio::test]
async fn host_ops_functions_load_cannot_bypass_complete_pair_activation() {
    let state = sessions_activation_server_fixture_async().await;
    let router = app(state.clone());
    let controller = state.auth_admission_controller();
    let predecessor_admission = controller.snapshot();
    let predecessor = state.auth_mode_state();
    let predecessor_bundle = predecessor
        .active_deployment
        .as_ref()
        .expect("predecessor deployment")
        .bundle_hash
        .clone();

    let rejected = router
        .clone()
        .oneshot(auth_http_request(
            "POST",
            "/_snapback/api/host-ops",
            serde_json::to_vec(&json!({
                "operation": "functions.load",
                "functions": legacy_v0_activation_bypass_manifest(),
            }))
            .unwrap(),
            true,
            Some("auth-http-admin"),
            None,
        ))
        .await
        .expect("host-op legacy load rejection");
    assert_eq!(rejected.status(), StatusCode::OK);
    let rejected = response_json(rejected).await;
    assert_eq!(rejected["ok"], false);
    assert!(
        rejected["diagnostics"][0]["code"]
            .as_str()
            .is_some_and(|code| code.contains("ARTIFACT") || code.contains("CAPABILITY")),
        "host-op must expose complete-pair preflight rejection: {rejected}"
    );
    assert_eq!(
        state
            .auth_mode_state()
            .active_deployment
            .as_ref()
            .expect("unchanged deployment")
            .bundle_hash,
        predecessor_bundle
    );

    let successor_functions = activation_functions('5', true);
    let successor_bundle = successor_functions
        .bundle_hash
        .clone()
        .expect("successor bundle");
    let activated = router
        .oneshot(auth_http_request(
            "POST",
            "/_snapback/api/host-ops",
            serde_json::to_vec(&json!({
                "operation": "functions.load",
                "functions": successor_functions,
            }))
            .unwrap(),
            true,
            Some("auth-http-admin"),
            None,
        ))
        .await
        .expect("coordinated host-op activation response");
    assert_eq!(activated.status(), StatusCode::OK);
    let activated = response_json(activated).await;
    assert_eq!(activated["ok"], true, "{activated}");
    assert_eq!(activated["data"]["loaded"], true);
    assert_eq!(
        state
            .auth_mode_state()
            .active_deployment
            .as_ref()
            .expect("successor deployment")
            .bundle_hash,
        successor_bundle
    );
    let reopened = controller.snapshot();
    assert!(reopened.accepting);
    assert_ne!(
        reopened.admission_epoch,
        predecessor_admission.admission_epoch
    );
}

#[tokio::test]
async fn app_api_current_projections_share_the_dev_unavailable_refusal() {
    let (state, _) = auth_runtime_fixture(PolicyAuthMode::Dev);
    let router = app(state);
    for path in ["/app-api/openapi.json", "/app-api/agent-skill"] {
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri(path)
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::NOT_FOUND, "{path}");
        assert_eq!(
            response_json(response).await["diagnostic"]["code"],
            "SNAPBACK_APP_API_UNAVAILABLE",
            "{path}"
        );
    }
}

#[tokio::test]
async fn ready_queued_replay_names_a_missing_client_offer_as_a_400() {
    let (state, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
    let state = state
        .with_auth_runtime_facts(
            settled_sessions_state(),
            AuthProgramReadiness::new(true, true, true, true, true, true, true),
        )
        .expect("install item-7 sessions fixture");
    let response = app(state)
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/mutation/does-not-exist")
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-snapback-auth-client-protocol", "1")
                .via_hosted_terminator(TEST_HOSTED_CLIENT_SOURCE)
                .body(Body::from(r#"{"args":{},"clientMutationId":"queued-1"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body = response_json(response).await;
    assert_eq!(
        body["diagnostic"]["code"],
        "SNAPBACK_AUTH_PROFILE_CLIENT_UNSUPPORTED"
    );
    assert_eq!(body["diagnostic"]["details"]["capability"], "queuedReplay");
    assert_eq!(
        body["diagnostic"]["details"]["minimumAuthorityDescriptorProtocol"],
        1
    );
}

#[tokio::test]
async fn hosted_shared_throttle_keys_challenge_and_exchange_subjects_before_crypto() {
    let (state, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
    let mut state = state
        .with_auth_runtime_facts(
            settled_sessions_state(),
            AuthProgramReadiness::new(true, true, true, true, false, false, false),
        )
        .expect("install hosted sender sessions posture");
    Arc::make_mut(&mut state.server).auth_deployment =
        crate::auth::deployment::AuthDeploymentTarget::Hosted;
    let provider = state
        .auth_provider
        .as_ref()
        .expect("hosted fixture provider")
        .clone();
    let now_ms = provider.now_ms();
    let generous = AuthenticationBucketPolicy {
        interval_ms: 1,
        burst: 10_000,
        maximum_denial_debt_attempts: 100,
    };
    let state = state
        .with_hosted_serving_authority(hosted_serving_authority_with_throttle(
            now_ms,
            SharedAuthenticationThrottleConfig {
                retention_ms: 900_000,
                maximum_key_count: 100_000,
                global: generous,
                source: generous,
                subject: AuthenticationBucketPolicy {
                    interval_ms: 1_000,
                    burst: 1,
                    maximum_denial_debt_attempts: 4,
                },
                source_subject: generous,
                family: generous,
            },
        ))
        .expect("install hosted subject throttle authority");
    let router = app(state);

    let mut request_code = auth_http_request(
        "POST",
        "/auth/request-code",
        serde_json::to_vec(&json!({"email": "subject-throttle@example.com"})).unwrap(),
        true,
        None,
        None,
    );
    offer_auth_client_protocol(&mut request_code);
    // Distinct from the exchange sources below: the assertion is that the
    // SUBJECT bucket keys on the challenge id across different sources.
    let request_code = via_hosted_terminator(request_code, "192.0.2.20");
    let request_code = router
        .clone()
        .oneshot(request_code)
        .await
        .expect("request hosted sender code");
    assert_eq!(request_code.status(), StatusCode::OK);
    let challenge_id = response_json(request_code).await["challengeId"]
        .as_str()
        .expect("hosted sender challenge id")
        .to_owned();
    let mailbox =
        serde_json::to_value(provider.mailbox_entry(&challenge_id).await.unwrap()).unwrap();
    let code = mailbox["code"]
        .as_str()
        .expect("hosted sender mailbox code")
        .to_owned();
    let public_jwk = HostedSenderProofKey::generate().public_jwk();
    let exchange = |source: &str| {
        let mut request = auth_http_request(
            "POST",
            "/auth/exchange",
            serde_json::to_vec(&json!({
                "challengeId": challenge_id,
                "code": code,
                "senderConstraint": {
                    "protocol": "snapback.sender-issuance.v2",
                    "publicJwk": public_jwk,
                    "proof": "not-a-compact-proof",
                },
            }))
            .unwrap(),
            true,
            None,
            None,
        );
        offer_auth_client_protocol(&mut request);
        via_hosted_terminator(request, source)
    };

    let invalid_proof = router
        .clone()
        .oneshot(exchange("192.0.2.21"))
        .await
        .expect("first exchange reaches sender proof verification");
    assert_eq!(invalid_proof.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        response_json(invalid_proof).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_SENDER_PROOF_INVALID",
    );

    let denied = router
        // A different source again: only the shared subject key can carry
        // the denial debt from the first exchange to this one.
        .oneshot(exchange("192.0.2.22"))
        .await
        .expect("second exchange denied by shared subject bucket");
    assert_eq!(denied.status(), StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(
        response_json(denied).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_THROTTLED",
    );
}

/// The fail-closed half of the D-1 hoist: a function name the published
/// manifest does not contain can never legitimately serve any caller, so
/// an absent carrier refuses identically to an `authenticated` function
/// — before the body poll, and indistinguishable from the authenticated
/// refusal (no function-existence oracle).
#[tokio::test]
async fn hosted_absent_carrier_on_unknown_function_refuses_before_body_poll() {
    let router = app(hosted_function_route_state());
    let refused = router
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/query/noSuchFunction")
                .via_hosted_terminator(TEST_HOSTED_CLIENT_SOURCE)
                .body(Body::new(PanicOnPollBody))
                .expect("absent carrier unknown-function request"),
        )
        .await
        .expect("absent carrier unknown-function response");
    assert_eq!(refused.status(), StatusCode::UNAUTHORIZED);
    assert!(refused.headers().get(super::SENDER_NONCE_HEADER).is_none());
    assert_eq!(
        response_json(refused).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_REQUIRED",
    );
}

/// @ref LLP 0146#d7-typed-remediations-and-type-aware-suggestion — the
/// direct HTTP projection enriches its existing diagnostic details from
/// the exact served manifest generation; the ruled carrier remains nested
/// there and does not add an outer wire member.
#[tokio::test]
async fn served_http_refusals_project_typed_candidates_and_argument_contracts() {
    let (state, _) = auth_runtime_fixture_with(PolicyAuthMode::Dev, |snapback| {
        let schema_source = read_generated_demo_fixture(
            "../../../../demos/todo/snapback/generated/schema.manifest.json",
            "todo",
        );
        let schema: SchemaManifest =
            serde_json::from_str(&schema_source).expect("parse served suggestion schema");
        snapback
            .apply_schema(schema)
            .expect("load suggestion schema");
        let functions_source = read_generated_demo_fixture(
            "../../../../demos/todo/snapback/generated/functions.manifest.json",
            "todo",
        );
        let functions: FunctionManifest =
            serde_json::from_str(&functions_source).expect("parse served suggestion functions");
        let diagnostics = snapback.load_functions(functions);
        assert!(
            !diagnostics.iter().any(|diagnostic| matches!(
                diagnostic.severity,
                crate::diagnostic::DiagnosticSeverity::Error
                    | crate::diagnostic::DiagnosticSeverity::Fatal
            )),
            "served suggestion fixture loads: {diagnostics:?}",
        );
    });
    let router = app(state);
    let request = |path: &str, args: Value| {
        Request::builder()
            .method("POST")
            .uri(path)
            .header(header::CONTENT_TYPE, "application/json")
            .header("x-snapback-auth-client-protocol", "1")
            .body(Body::from(
                serde_json::to_vec(&json!({ "args": args })).expect("serialize args"),
            ))
            .expect("served refusal request")
    };

    let mut unknown = Value::Null;
    for _ in 0..3 {
        let response = router
            .clone()
            .oneshot(request("/query/listTods", json!({})))
            .await
            .expect("unknown function response");
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        unknown = response_json(response).await;
    }
    let details = &unknown["diagnostic"]["details"];
    assert_eq!(unknown["diagnostic"]["code"], "SNAPBACK_UNKNOWN_FUNCTION");
    assert_eq!(details["candidateFunctions"][0]["name"], "listTodos");
    assert_eq!(details["candidateFunctions"][0]["kind"], "LiveQuery");
    // The todo source carries no authority profile. This is the checked-in
    // todo artifact, not a separately authored test value (re-pinned
    // 2026-08-25 after the checked-in application projections were
    // coherently regenerated).
    assert_eq!(details["artifactHash"], "sha256:2652be777fb62392");
    assert_eq!(
        details["remediationSet"]["schemaVersion"],
        "snapback.remediation-set.v1"
    );
    assert_eq!(
        details["remediationSet"]["artifactHash"],
        details["artifactHash"]
    );
    assert_eq!(
        details["remediationSet"]["items"][0]["action"]["replacement"],
        "listTodos"
    );
    assert!(
        details["localMissSummary"]["sameMissCount"]
            .as_u64()
            .unwrap()
            >= 3
    );
    assert!(
        !serde_json::to_string(&unknown)
            .unwrap()
            .contains("listTods")
    );

    let response = router
        .clone()
        .oneshot(request(
            "/mutation/createTodo",
            json!({ "titel": "not disclosed" }),
        ))
        .await
        .expect("unknown argument field response");
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let unknown_field = response_json(response).await;
    let details = &unknown_field["diagnostic"]["details"];
    assert_eq!(
        unknown_field["diagnostic"]["code"], "SNAPBACK_FUNCTION_ARGS_CONTRACT_VIOLATION",
        "{unknown_field}"
    );
    assert_eq!(details["candidateFields"][0]["name"], "title");
    assert_eq!(details["candidateFields"][0]["expected"], "string");
    assert_eq!(
        details["remediationSet"]["items"][0]["action"]["replacement"],
        "title"
    );
    assert!(details["expectedArgumentContract"].is_object());
    assert!(
        !serde_json::to_string(&unknown_field)
            .unwrap()
            .contains("titel")
    );

    let response = router
        .oneshot(request("/mutation/createTodo", json!({ "title": 42 })))
        .await
        .expect("wrong argument shape response");
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let wrong_shape = response_json(response).await;
    let details = &wrong_shape["diagnostic"]["details"];
    assert_eq!(details["expected"], "string");
    assert_eq!(details["actual"], "number");
    assert_eq!(details["candidateFields"][0]["name"], "title");
    assert_eq!(details["candidateFields"][0]["expected"], "string");
}

/// The load-bearing other half of the D-1 fix: functions the published
/// manifest statically declares `public` or `optional-user` must keep
/// admitting anonymous callers on the hosted origin — the hoist must not
/// flip genuinely anonymous-capable routes to required.
#[tokio::test]
async fn hosted_absent_carrier_on_anonymous_capable_functions_still_admits() {
    let router = app(hosted_function_route_state());
    for name in ["listOptionalNotes", "listPublicNotes"] {
        let admitted = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/query/{name}"))
                    .header(header::CONTENT_TYPE, "application/json")
                    .via_hosted_terminator(TEST_HOSTED_CLIENT_SOURCE)
                    .body(Body::from(r#"{"args":{}}"#))
                    .expect("anonymous function request"),
            )
            .await
            .expect("anonymous function response");
        assert_eq!(admitted.status(), StatusCode::OK, "{name}");
    }
}

#[tokio::test]
async fn snapback_static_pages_ship_a_hash_pinned_restrictive_csp() {
    let (state, _) = auth_runtime_fixture(PolicyAuthMode::Dev);
    let response = app(state)
        .oneshot(
            Request::builder()
                .uri("/_snapback/admin/setup")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let csp = response
        .headers()
        .get("content-security-policy")
        .and_then(|value| value.to_str().ok())
        .unwrap()
        .to_owned();
    assert!(csp.contains("default-src 'none'"), "{csp}");
    assert!(csp.contains("object-src 'none'"), "{csp}");
    assert!(csp.contains("frame-ancestors 'none'"), "{csp}");
    assert!(csp.contains("require-trusted-types-for 'script'"), "{csp}");
    assert!(!csp.contains("unsafe-eval"), "{csp}");
    let script_directive = csp
        .split(';')
        .find(|directive| directive.trim_start().starts_with("script-src "))
        .unwrap();
    assert!(!script_directive.contains("unsafe-inline"), "{csp}");
    assert_eq!(response.headers()["x-content-type-options"], "nosniff");
    assert_eq!(response.headers()["referrer-policy"], "no-referrer");
    assert_eq!(response.headers()["x-frame-options"], "DENY");
    assert_eq!(
        response.headers()["cross-origin-resource-policy"],
        "same-origin"
    );

    let bytes = to_bytes(response.into_body(), 2 * 1024 * 1024)
        .await
        .unwrap();
    let html = std::str::from_utf8(&bytes).unwrap();
    let script = html
        .split_once("<script>")
        .and_then(|(_, suffix)| suffix.split_once("</script>"))
        .map(|(script, _)| script)
        .expect("one embedded setup script");
    let digest = base64::engine::general_purpose::STANDARD.encode(Sha256::digest(script));
    assert!(
        csp.contains(&format!("'sha256-{digest}'")),
        "the served inline script changed without updating its CSP hash: {csp}"
    );

    // The built Exact shell has build-specific inline manifest/bootstrap
    // blocks. Its handler must hash the exact served bytes and the shared
    // middleware must preserve that response-specific policy.
    let dist = tempfile::tempdir().unwrap();
    let admin_html = concat!(
        "<!doctype html><script type=\"application/json\">\n",
        "{\"buildId\":\"fixture\"}\n",
        "</script><script>\n",
        "globalThis.__exactAppBasePath = '/_snapback/admin';\n",
        "</script><script type=\"module\" src=\"/assets/main.js\"></script>",
    );
    std::fs::write(dist.path().join("index.html"), admin_html).unwrap();
    let expected_digests = crate::admin::inline_script_sha256_digests(admin_html.as_bytes());
    assert_eq!(expected_digests.len(), 2);
    let (mut state, _) = auth_runtime_fixture(PolicyAuthMode::Dev);
    Arc::make_mut(&mut state.server).admin_dist = Some(dist.path().to_owned());
    let response = app(state)
        .oneshot(
            Request::builder()
                .uri("/_snapback/admin")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let csp = response
        .headers()
        .get("content-security-policy")
        .and_then(|value| value.to_str().ok())
        .unwrap()
        .to_owned();
    for digest in &expected_digests {
        assert!(
            csp.contains(&format!("'sha256-{digest}'")),
            "built admin inline bytes are not admitted by their response CSP: {csp}"
        );
    }
    let script_directive = csp
        .split(';')
        .find(|directive| directive.trim_start().starts_with("script-src "))
        .unwrap();
    assert_eq!(script_directive.matches("'sha256-").count(), 2, "{csp}");
    assert!(!script_directive.contains("unsafe-inline"), "{csp}");
    assert!(csp.contains("require-trusted-types-for 'script'"), "{csp}");
    let body = to_bytes(response.into_body(), 2 * 1024 * 1024)
        .await
        .unwrap();
    assert_eq!(body.as_ref(), admin_html.as_bytes());
}

#[tokio::test]
async fn dev_body_impersonation_requires_a_trusted_browser_origin_but_not_an_origin_header() {
    async fn echo_authority(Extension(authority): Extension<PreparedAuthority>) -> Json<Value> {
        Json(json!({ "userId": authority.projection().user_id() }))
    }

    let (mut state, _) = auth_runtime_fixture(PolicyAuthMode::Dev);
    let context = Arc::make_mut(&mut state.server);
    context.record_bound_address("127.0.0.1:43621".parse().unwrap());
    context.allow_dev_auth_origin_for_test("http://127.0.0.1:8081");
    let router = super::router_from_registrations(
        vec![super::RegisteredRoute::new(
            super::app_auth_route("POST", "/query/{name}"),
            axum::routing::post(echo_authority),
        )],
        state.clone(),
    )
    .with_state(state);
    let request = |origin: Option<&'static str>| {
        let mut builder = Request::builder()
            .method("POST")
            .uri("/query/authority")
            .header(header::CONTENT_TYPE, "application/json");
        if let Some(origin) = origin {
            builder = builder.header(header::ORIGIN, origin);
        }
        builder
            .body(Body::from(r#"{"args":{},"auth":{"user_id":"user-1"}}"#))
            .unwrap()
    };

    for origin in [
        None,
        Some("http://127.0.0.1:43621"),
        Some("http://127.0.0.1:8081"),
    ] {
        let response = router.clone().oneshot(request(origin)).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK, "origin {origin:?}");
        assert_eq!(response_json(response).await["userId"], "user-1");
    }

    let response = router
        .oneshot(request(Some("http://localhost:5173")))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        response_json(response).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_DEV_ORIGIN_REFUSED"
    );

    let (sessions_state, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
    let sessions_router = super::router_from_registrations(
        vec![super::RegisteredRoute::new(
            super::app_auth_route("POST", "/query/{name}"),
            axum::routing::post(echo_authority),
        )],
        sessions_state.clone(),
    )
    .with_state(sessions_state);
    let response = sessions_router
        .oneshot(request(Some("http://127.0.0.1:8081")))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_json(response).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_BODY_AUTH_UNSUPPORTED",
        "the Dev Origin rule must not weaken or reorder Sessions body closure"
    );
}

#[tokio::test]
async fn loopback_any_dev_body_origin_admits_literal_loopback_and_refuses_foreign_hosts() {
    async fn echo_authority(Extension(authority): Extension<PreparedAuthority>) -> Json<Value> {
        Json(json!({ "userId": authority.projection().user_id() }))
    }

    let (mut state, _) = auth_runtime_fixture(PolicyAuthMode::Dev);
    Arc::make_mut(&mut state.server).use_loopback_any_dev_admission_for_test();
    let router = super::router_from_registrations(
        vec![super::RegisteredRoute::new(
            super::app_auth_route("POST", "/query/{name}"),
            axum::routing::post(echo_authority),
        )],
        state.clone(),
    )
    .with_state(state);
    let request = |origin: Option<&'static str>| {
        let mut builder = Request::builder()
            .method("POST")
            .uri("/query/authority")
            .header(header::CONTENT_TYPE, "application/json");
        if let Some(origin) = origin {
            builder = builder.header(header::ORIGIN, origin);
        }
        builder
            .body(Body::from(r#"{"args":{},"auth":{"user_id":"user-1"}}"#))
            .unwrap()
    };

    let originless = router.clone().oneshot(request(None)).await.unwrap();
    assert_eq!(originless.status(), StatusCode::OK);

    let admitted = router
        .clone()
        .oneshot(request(Some("http://localhost:59999")))
        .await
        .unwrap();
    assert_eq!(admitted.status(), StatusCode::OK);

    let refused = router
        .oneshot(request(Some("http://attacker.dev")))
        .await
        .unwrap();
    assert_eq!(refused.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        response_json(refused).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_DEV_ORIGIN_REFUSED"
    );

    let (mut explicit_state, _) = auth_runtime_fixture(PolicyAuthMode::Dev);
    let context = Arc::make_mut(&mut explicit_state.server);
    context.dev_admission_posture = Some(crate::admin::DevAdmissionPosture::ExplicitList);
    context.dev_auth_origins = BTreeSet::from(["https://lane.trycloudflare.com".to_owned()]);
    let explicit_router = super::router_from_registrations(
        vec![super::RegisteredRoute::new(
            super::app_auth_route("POST", "/query/{name}"),
            axum::routing::post(echo_authority),
        )],
        explicit_state.clone(),
    )
    .with_state(explicit_state);
    let originless = explicit_router.oneshot(request(None)).await.unwrap();
    assert_eq!(originless.status(), StatusCode::OK);
}

#[tokio::test]
async fn dev_client_asserted_capability_verifies_when_present_and_warns_when_absent() {
    async fn echo_authority(Extension(authority): Extension<PreparedAuthority>) -> Json<Value> {
        Json(json!({ "userId": authority.projection().user_id() }))
    }

    let (state, _) = auth_runtime_fixture(PolicyAuthMode::Dev);
    let (registry, capability) = dev_identity_capability_fixture();
    let (_other_registry, other_capability) = dev_identity_capability_fixture();
    let warning_witness = registry.clone();
    let state = state.with_dev_identity_capabilities(registry);
    let router = super::router_from_registrations(
        vec![super::RegisteredRoute::new(
            super::app_auth_route("POST", "/query/{name}"),
            axum::routing::post(echo_authority),
        )],
        state.clone(),
    )
    .with_state(state);
    let request = |presented: Option<&str>| {
        let mut builder = Request::builder()
            .method("POST")
            .uri("/query/authority")
            .header(header::CONTENT_TYPE, "application/json");
        if let Some(presented) = presented {
            builder = builder.header(
                crate::dev_identity::DEV_IDENTITY_CAPABILITY_HEADER,
                presented,
            );
        }
        builder
            .body(Body::from(r#"{"args":{},"auth":{"user_id":"user-1"}}"#))
            .unwrap()
    };

    let valid = router
        .clone()
        .oneshot(request(Some(&capability)))
        .await
        .unwrap();
    assert_eq!(valid.status(), StatusCode::OK);
    assert_eq!(
        valid.headers()[crate::dev_identity::DEV_IDENTITY_CAPABILITY_WITNESS_HEADER],
        "true"
    );
    assert_eq!(response_json(valid).await["userId"], "user-1");

    let absent = router.clone().oneshot(request(None)).await.unwrap();
    assert_eq!(absent.status(), StatusCode::OK);
    assert_eq!(
        absent.headers()[crate::dev_identity::DEV_IDENTITY_CAPABILITY_WITNESS_HEADER],
        "false"
    );
    assert!(
        !warning_witness.warn_unwitnessed_assertion_once(),
        "the accepted absent-capability assertion emitted the boot warning"
    );

    let refused = router
        .oneshot(request(Some(&other_capability)))
        .await
        .unwrap();
    assert_eq!(refused.status(), StatusCode::FORBIDDEN);
    let refused = response_json(refused).await;
    assert_eq!(
        refused["diagnostic"]["code"],
        "SNAPBACK_DEV_IDENTITY_REFUSED"
    );
    assert_eq!(
        refused["diagnostic"]["message"],
        "developer identity capability refused"
    );
    assert!(
        !refused.to_string().contains("/operator/"),
        "custody-path remediation remains server-local"
    );
}

#[test]
fn optional_json_rejects_non_objects_and_duplicate_struct_fields() {
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    let error = parse_optional_json::<OpenConnectionRequest>(
        &headers,
        Ok(Bytes::from_static(br#"["sequence-as-connection-id"]"#)),
    )
    .expect_err("optional JSON routes accept objects, never serde struct sequences");
    assert_eq!(error.0.diagnostic.code, "SNAPBACK_REQUEST_JSON_INVALID");
    assert_eq!(
        error.0.diagnostic.message,
        "request body was not valid JSON for this operation"
    );
    assert_eq!(
        error.0.diagnostic.details["error"],
        "request body must be a JSON object"
    );

    let duplicate = parse_optional_json::<OpenConnectionRequest>(
        &headers,
        Ok(Bytes::from_static(
            br#"{"connectionId":"first","connectionId":"second"}"#,
        )),
    )
    .expect_err("duplicate capability fields must not silently use the last value");
    assert_eq!(duplicate.0.diagnostic.code, "SNAPBACK_REQUEST_JSON_INVALID");
    assert!(
        duplicate.0.diagnostic.details["error"]
            .as_str()
            .is_some_and(|message| message.contains("duplicate field")),
        "typed serde visitor should preserve the duplicate-field diagnostic: {}",
        duplicate.0.diagnostic.details["error"]
    );
}

/// @ref LLP 0057#catalog-write-and-lifecycle-rules — the dedicated reset holds
/// exclusive maintenance, clears capture plaintext only after commit, and
/// retains both catalog and keyring (proved by issuing again afterward).
#[tokio::test]
async fn direct_app_reset_clears_mailbox_on_commit_and_preserves_it_on_rejection() {
    let (router, _, provider) = auth_http_fixture_with_provider(PolicyAuthMode::Sessions);
    let committed_challenge =
        request_captured_challenge(&router, "direct-commit@example.com").await;
    let committed = router
        .clone()
        .oneshot(auth_http_request(
            "POST",
            "/_snapback/api/app/reset",
            b"{}".to_vec(),
            true,
            Some("auth-http-admin"),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(committed.status(), StatusCode::OK);
    assert_eq!(
        provider
            .mailbox_entry(&committed_challenge)
            .await
            .unwrap_err()
            .diagnostic()
            .code,
        "SNAPBACK_AUTH_MAILBOX_ENTRY_NOT_FOUND"
    );

    let rejected_challenge = request_captured_challenge(&router, "direct-reject@example.com").await;
    let rejected = router
        .clone()
        .oneshot(auth_http_request(
            "POST",
            "/_snapback/api/app/reset",
            serde_json::to_vec(&serde_json::json!({
                "seed": {"tables": {"missing_table": [{}]}}
            }))
            .unwrap(),
            true,
            Some("auth-http-admin"),
            None,
        ))
        .await
        .unwrap();
    assert_ne!(rejected.status(), StatusCode::OK);
    assert_eq!(
        provider
            .mailbox_entry(&rejected_challenge)
            .await
            .expect("rejected reset preserves capture plaintext")
            .challenge_id,
        rejected_challenge
    );
}

/// @ref LLP 0215#32-charge-axes — enumeration may partition by recipient,
/// while hash-CPU must remain on the source/resource axis so rotating valid
/// addresses cannot obtain fresh KDF headroom.
#[tokio::test]
async fn rotating_recipients_exhaust_signup_and_claim_hash_cpu_on_local_and_hosted_targets() {
    let tombstone = GuestCleanupContractV1::Declarative {
        default: GuestCleanupActionV1::Tombstone,
        tables: BTreeMap::new(),
    };
    let source: std::net::IpAddr = "192.0.2.91".parse().unwrap();
    for (hosted, path) in [
        (false, "/auth/password/signup"),
        (false, "/auth/guest/claim/password"),
        (true, "/auth/password/signup"),
        (true, "/auth/guest/claim/password"),
    ] {
        let mut program = guest_auth_program(true, tombstone.clone());
        let hash_cpu = program
            .abuse_budgets
            .as_mut()
            .expect("guest budget policy")
            .budgets
            .get_mut("auth.hash-cpu")
            .expect("hash-CPU budget")
            .profiles
            .get_mut("test")
            .expect("test hash-CPU terms");
        hash_cpu.limit = 2;
        hash_cpu.window_ms = 60_000;
        resign_guest_auth_budget_policy(&mut program);

        let mut state = guest_sessions_custom_activation_server_fixture_async(program).await;
        if hosted {
            Arc::make_mut(&mut state.server).auth_deployment =
                crate::auth::deployment::AuthDeploymentTarget::Hosted;
        }
        let spec = super::core_route_registrations()
            .into_iter()
            .find(|route| route.spec.path == path)
            .unwrap_or_else(|| panic!("registered route {path}"))
            .spec;
        for index in 0..3 {
            let body = json!({
                "email": format!("rotating-{hosted}-{index}@example.com"),
                "password": "rotating-recipient-password-123!",
            });
            let result = super::charge_hosted_body_auth_attempt(
                spec,
                &state,
                hosted.then_some(source),
                Some(&body),
            )
            .await;
            if index < 2 {
                assert!(result.is_ok(), "hosted={hosted} path={path} index={index}");
            } else {
                let refusal = result.expect_err("rotating recipient must exhaust hash CPU");
                assert_eq!(refusal.status(), StatusCode::TOO_MANY_REQUESTS);
                let refusal = response_json(refusal).await;
                assert_eq!(refusal["diagnostic"]["code"], "SNAPBACK_AUTH_THROTTLED");
                assert_eq!(
                    refusal["diagnostic"]["details"]["budgetName"], "auth.hash-cpu",
                    "hosted={hosted} path={path}"
                );
            }
        }
    }
}

#[tokio::test]
async fn integration_key_holder_retires_the_complete_installed_family() {
    let state = sessions_activation_server_fixture_with_integrations_async().await;
    with_snapback(&state.snapback, |snapback| {
        snapback
            .remainder_auth_fixture()
            .reconcile_auth_scope_bases(&activation_functions('2', false))
    })
    .await
    .unwrap();
    let owner = mint_test_credential(&state, "integration-owner@example.com").await;
    let bearer = owner["token"].as_str().unwrap().to_owned();
    let router = app(state.clone());
    let registered = router
        .clone()
        .oneshot(agent_registration_http_request(json!({
        "class": "integration",
        "displayName": "Journey Integration",
        "origin": "https://integration.example.test",
        "redirectUris": ["https://integration.example.test/callback"]
        })))
        .await
        .unwrap();
    let registered_status = registered.status();
    let registered = response_json(registered).await;
    assert_eq!(registered_status, StatusCode::OK, "{registered}");
    let integration_id = registered["userId"].as_str().unwrap().to_owned();
    let credential = registered["credential"].as_str().unwrap().to_owned();

    let mut planted_authority = auth_http_request(
        "POST",
        "/auth/integrations/retire",
        serde_json::to_vec(&json!({
        "credential": credential,
        "auth": { "userId": "planted" },
        }))
        .unwrap(),
        true,
        None,
        None,
    );
    offer_auth_client_protocol(&mut planted_authority);
    let planted_authority = router.clone().oneshot(planted_authority).await.unwrap();
    assert_eq!(planted_authority.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_json(planted_authority).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_REQUEST_INVALID"
    );

    let pairing = router
        .clone()
        .oneshot(session_auth_http_request(
            "/auth/pairing-codes",
            br#"{}"#.to_vec(),
            &bearer,
        ))
        .await
        .unwrap();
    let pairing = response_json(pairing).await;
    let pairing_request_id = pairing["pairingRequestId"].as_str().unwrap().to_owned();
    let mut pair_request = auth_http_request(
        "POST",
        "/auth/agents/pair",
        serde_json::to_vec(&json!({
        "credential": credential,
        "pairingRequestId": pairing_request_id,
        "pairingCode": pairing["pairingCode"],
        "requestedScopes": [{ "tier": "query" }],
        }))
        .unwrap(),
        true,
        None,
        None,
    );
    offer_auth_client_protocol(&mut pair_request);
    let paired = router.clone().oneshot(pair_request).await.unwrap();
    let paired_status = paired.status();
    let paired = response_json(paired).await;
    assert_eq!(paired_status, StatusCode::OK, "{paired}");
    let approved = router
        .clone()
        .oneshot(session_auth_http_request(
            &format!("/auth/grant-requests/{pairing_request_id}/approve"),
            br#"{}"#.to_vec(),
            &bearer,
        ))
        .await
        .unwrap();
    let approved_status = approved.status();
    let approved = response_json(approved).await;
    assert_eq!(approved_status, StatusCode::OK, "{approved}");
    let grant_id = approved["grantId"].as_str().unwrap().to_owned();

    let mut token_request = auth_http_request(
        "POST",
        "/auth/agents/token",
        serde_json::to_vec(&json!({
        "credential": credential,
        "grantId": grant_id,
        }))
        .unwrap(),
        true,
        None,
        None,
    );
    offer_auth_client_protocol(&mut token_request);
    let token = router.clone().oneshot(token_request).await.unwrap();
    let token_status = token.status();
    let token = response_json(token).await;
    assert_eq!(token_status, StatusCode::OK, "{token}");
    let scoped_token = token["token"].as_str().unwrap().to_owned();
    let integration_principal = integration_id.clone();
    let integration_caller_key = with_snapback(&state.snapback, move |snapback| {
        Ok::<_, SnapbackError>(
            snapback
                .remainder_auth_fixture()
                .integration_record_if_present(&integration_principal)?
                .unwrap()
                .integration_id,
        )
    })
    .await
    .unwrap();

    let attributed_query = Request::builder()
        .method("POST")
        .uri("/api/v1/query/listItems")
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::AUTHORIZATION, format!("Bearer {scoped_token}"))
        .header("x-snapback-auth-client-protocol", "1")
        .via_hosted_terminator(TEST_HOSTED_CLIENT_SOURCE)
        .body(Body::from(r#"{"args":{}}"#))
        .unwrap();
    let attributed_query = router.clone().oneshot(attributed_query).await.unwrap();
    assert_eq!(attributed_query.status(), StatusCode::OK);
    let integration_stats = state
        .telemetry
        .query_stats(&crate::telemetry_query::TelemetryStatsRequestV1 {
            filter: crate::telemetry_query::TelemetryStatsFilterV1 {
                kind: Some("function_run".to_owned()),
                name: Some("listItems".to_owned()),
                caller_key: Some(integration_caller_key.clone()),
                lane: Some("integration".to_owned()),
                ..Default::default()
            },
            group_by_caller: true,
        })
        .unwrap();
    assert_eq!(integration_stats.caller_counts.len(), 1);
    assert_eq!(integration_stats.caller_counts[0].count, 1);

    let opened = router
        .clone()
        .oneshot(connection_open_request(
            Some(&scoped_token),
            json!({ "authInvalidationProtocol": 1 }),
        ))
        .await
        .unwrap();
    assert_eq!(opened.status(), StatusCode::OK);
    let opened = response_json(opened).await;
    let connection_id = opened["connectionId"].as_str().unwrap();
    let connection_token = opened["connectionToken"].as_str().unwrap();
    let subscribed = router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/live/liveItems/subscribe")
                .header(header::CONTENT_TYPE, "application/json")
                .header(super::CONNECTION_TOKEN_HEADER, connection_token)
                .header("x-snapback-auth-client-protocol", "1")
                .via_hosted_terminator(TEST_HOSTED_CLIENT_SOURCE)
                .header("x-snapback-auth-invalidation-protocol", "1")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                    "connection_id": connection_id,
                    "input": { "args": {} },
                    "authorizationNamespace": {
                    "clientStoreId": "integration-attribution-store",
                    "queryKey": "liveItems:{}",
                    "queryInstanceId": 1,
                    },
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let subscribed_status = subscribed.status();
    let subscribed = response_json(subscribed).await;
    assert_eq!(subscribed_status, StatusCode::OK, "{subscribed}");
    let live_events = state
        .telemetry
        .query_events(&crate::telemetry_query::TelemetryEventsRequestV1 {
            filter: crate::telemetry_query::TelemetryFilterV1 {
                kind: Some("live_subscribe".to_owned()),
                name: Some("liveItems".to_owned()),
                ..Default::default()
            },
            limit: crate::telemetry_query::MAX_EVENT_LIMIT,
            ..Default::default()
        })
        .unwrap();
    assert!(live_events.events.iter().any(|event| {
        event.details.as_ref().is_some_and(|details| {
            details["callerLane"] == "integration" && details["callerKey"] == integration_caller_key
        })
    }));

    let integrations = Request::builder()
        .uri("/_snapback/api/auth/integrations")
        .header("x-snapback-admin-token", "auth-http-admin")
        .body(Body::empty())
        .unwrap();
    let integrations = router.clone().oneshot(integrations).await.unwrap();
    assert_eq!(integrations.status(), StatusCode::OK);
    let integrations = response_json(integrations).await;
    let integration = integrations["integrations"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["principalUserId"].as_str() == Some(integration_id.as_str()))
        .unwrap();
    assert_eq!(integration["callerKey"], integration_caller_key);
    assert_eq!(integration["status"], "active");
    assert!(matches!(
        integration["ownerClaimState"].as_str(),
        Some("provisional" | "unclaimed" | "claimed")
    ));
    assert!(integration["recentUsage"]["count"].as_u64().unwrap() >= 1);

    let pending_installation = router
        .clone()
        .oneshot(session_auth_http_request(
            "/auth/pairing-codes",
            br#"{}"#.to_vec(),
            &bearer,
        ))
        .await
        .unwrap();
    let pending_installation = response_json(pending_installation).await;
    let pending_installation_id = pending_installation["pairingRequestId"]
        .as_str()
        .unwrap()
        .to_owned();
    let mut pending_installation_request = auth_http_request(
        "POST",
        "/auth/agents/pair",
        serde_json::to_vec(&json!({
        "credential": credential,
        "pairingRequestId": pending_installation_id,
        "pairingCode": pending_installation["pairingCode"],
        "requestedScopes": [{ "tier": "query" }],
        }))
        .unwrap(),
        true,
        None,
        None,
    );
    offer_auth_client_protocol(&mut pending_installation_request);
    let pending_installation_request = router
        .clone()
        .oneshot(pending_installation_request)
        .await
        .unwrap();
    let pending_installation_status = pending_installation_request.status();
    let pending_installation_request = response_json(pending_installation_request).await;
    assert_eq!(
        pending_installation_status,
        StatusCode::OK,
        "{pending_installation_request}"
    );

    let suspend = Request::builder()
        .method("POST")
        .uri(format!(
            "/_snapback/api/auth/integrations/{integration_id}/suspend"
        ))
        .header("x-snapback-admin-token", "auth-http-admin")
        .body(Body::empty())
        .unwrap();
    let suspend = router.clone().oneshot(suspend).await.unwrap();
    let suspend_status = suspend.status();
    let suspend = response_json(suspend).await;
    assert_eq!(suspend_status, StatusCode::OK, "{suspend}");
    assert_eq!(suspend["status"], "suspended");
    let suspended_query = Request::builder()
        .method("POST")
        .uri("/query/listItems")
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::AUTHORIZATION, format!("Bearer {scoped_token}"))
        .header("x-snapback-auth-client-protocol", "1")
        .via_hosted_terminator(TEST_HOSTED_CLIENT_SOURCE)
        .body(Body::from(r#"{"args":{}}"#))
        .unwrap();
    let suspended_query = router.clone().oneshot(suspended_query).await.unwrap();
    assert_eq!(suspended_query.status(), StatusCode::FORBIDDEN);
    let suspended_query = response_json(suspended_query).await;
    assert_eq!(
        suspended_query["diagnostic"]["code"],
        "SNAPBACK_AUTH_INTEGRATION_SUSPENDED"
    );
    assert!(
        suspended_query["diagnostic"]["message"]
            .as_str()
            .unwrap()
            .contains("suspended")
    );

    let blocked_approval = router
        .clone()
        .oneshot(session_auth_http_request(
            &format!("/auth/grant-requests/{pending_installation_id}/approve"),
            br#"{}"#.to_vec(),
            &bearer,
        ))
        .await
        .unwrap();
    assert_eq!(blocked_approval.status(), StatusCode::FORBIDDEN);
    let blocked_approval = response_json(blocked_approval).await;
    assert_eq!(
        blocked_approval["diagnostic"]["code"],
        "SNAPBACK_AUTH_INTEGRATION_SUSPENDED"
    );
    assert!(
        !blocked_approval["diagnostic"]["message"]
            .as_str()
            .unwrap()
            .contains("revok")
    );

    let blocked_pairing = router
        .clone()
        .oneshot(session_auth_http_request(
            "/auth/pairing-codes",
            br#"{}"#.to_vec(),
            &bearer,
        ))
        .await
        .unwrap();
    let blocked_pairing = response_json(blocked_pairing).await;
    let blocked_pairing_id = blocked_pairing["pairingRequestId"]
        .as_str()
        .unwrap()
        .to_owned();
    let blocked_pairing_code = blocked_pairing["pairingCode"].as_str().unwrap().to_owned();
    let make_blocked_pairing_request = || {
        let mut request = auth_http_request(
            "POST",
            "/auth/agents/pair",
            serde_json::to_vec(&json!({
            "credential": credential,
            "pairingRequestId": blocked_pairing_id,
            "pairingCode": blocked_pairing_code,
            "requestedScopes": [{ "tier": "query" }],
            }))
            .unwrap(),
            true,
            None,
            None,
        );
        offer_auth_client_protocol(&mut request);
        request
    };
    let blocked_pairing_response = router
        .clone()
        .oneshot(make_blocked_pairing_request())
        .await
        .unwrap();
    assert_eq!(blocked_pairing_response.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        response_json(blocked_pairing_response).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_INTEGRATION_SUSPENDED"
    );

    let resume = Request::builder()
        .method("POST")
        .uri(format!(
            "/_snapback/api/auth/integrations/{integration_id}/resume"
        ))
        .header("x-snapback-admin-token", "auth-http-admin")
        .body(Body::empty())
        .unwrap();
    let resume = router.clone().oneshot(resume).await.unwrap();
    let resume_status = resume.status();
    let resume = response_json(resume).await;
    assert_eq!(resume_status, StatusCode::OK, "{resume}");
    assert_eq!(resume["status"], "active");
    let resumed_approval = router
        .clone()
        .oneshot(session_auth_http_request(
            &format!("/auth/grant-requests/{pending_installation_id}/approve"),
            br#"{}"#.to_vec(),
            &bearer,
        ))
        .await
        .unwrap();
    let resumed_approval_status = resumed_approval.status();
    let resumed_approval = response_json(resumed_approval).await;
    assert_eq!(
        resumed_approval_status,
        StatusCode::OK,
        "{resumed_approval}"
    );
    let resumed_grant_id = resumed_approval["grantId"].as_str().unwrap().to_owned();
    let resumed_pairing = router
        .clone()
        .oneshot(make_blocked_pairing_request())
        .await
        .unwrap();
    let resumed_pairing_status = resumed_pairing.status();
    let resumed_pairing = response_json(resumed_pairing).await;
    assert_eq!(resumed_pairing_status, StatusCode::OK, "{resumed_pairing}");
    let resumed_query = Request::builder()
        .method("POST")
        .uri("/query/listItems")
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::AUTHORIZATION, format!("Bearer {scoped_token}"))
        .header("x-snapback-auth-client-protocol", "1")
        .via_hosted_terminator(TEST_HOSTED_CLIENT_SOURCE)
        .body(Body::from(r#"{"args":{}}"#))
        .unwrap();
    let resumed_query = router.clone().oneshot(resumed_query).await.unwrap();
    let resumed_status = resumed_query.status();
    let resumed_query = response_json(resumed_query).await;
    assert_eq!(resumed_status, StatusCode::OK, "{resumed_query}");

    let mut retire = auth_http_request(
        "POST",
        "/auth/integrations/retire",
        serde_json::to_vec(&json!({ "credential": credential })).unwrap(),
        true,
        None,
        None,
    );
    offer_auth_client_protocol(&mut retire);
    assert_eq!(
        router.clone().oneshot(retire).await.unwrap().status(),
        StatusCode::NO_CONTENT
    );

    let dead_query = Request::builder()
        .method("POST")
        .uri("/query/listItems")
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::AUTHORIZATION, format!("Bearer {scoped_token}"))
        .header("x-snapback-auth-client-protocol", "1")
        .via_hosted_terminator(TEST_HOSTED_CLIENT_SOURCE)
        .body(Body::from(r#"{"args":{}}"#))
        .unwrap();
    assert_eq!(
        router.clone().oneshot(dead_query).await.unwrap().status(),
        StatusCode::UNAUTHORIZED
    );

    let mut remint = auth_http_request(
        "POST",
        "/auth/agents/token",
        serde_json::to_vec(&json!({
        "credential": credential,
        "grantId": grant_id,
        }))
        .unwrap(),
        true,
        None,
        None,
    );
    offer_auth_client_protocol(&mut remint);
    assert_eq!(
        router.oneshot(remint).await.unwrap().status(),
        StatusCode::UNAUTHORIZED
    );
    let facts = with_snapback(&state.snapback, move |snapback| {
        let mut db = snapback.remainder_auth_fixture();
        let record = db.integration_record_for_test(&integration_id)?.unwrap();
        let revoked = db.integration_grant_revoked_for_test(&grant_id)?;
        let resumed_revoked = db.integration_grant_revoked_for_test(&resumed_grant_id)?;
        Ok::<_, SnapbackError>((record.status, revoked, resumed_revoked))
    })
    .await
    .unwrap();
    assert_eq!(
        facts.0,
        crate::storage::auth_integrations::IntegrationStatus::Revoked
    );
    assert!(facts.1);
    assert!(facts.2);
}

/// Each reviewed family must remain exactly aligned with the runtime mapper.
#[test]
fn s5_d10_reviewed_http_families_match_mapper() {
    for (expected_status, codes) in HTTP_STATUS_FAMILIES {
        for code in *codes {
            assert_eq!(
                status_for_diagnostic_code(code),
                *expected_status,
                "{code} drifted out of its reviewed HTTP family"
            );
        }
    }
    for (expected_status, codes) in NONSTANDARD_STATUS_DIAGNOSTICS {
        for code in *codes {
            assert_eq!(
                status_for_diagnostic_code(code).as_u16(),
                *expected_status,
                "{code} drifted out of its reviewed nonstandard status"
            );
        }
    }

    // Production remains fail-safe between reviews: a genuinely new code
    // is 500, never the pre-ENG-24357 blanket 400.
    for unknown in ["SNAPBACK_INTERNAL_ERROR", "SNAPBACK_FUTURE_DIAGNOSTIC"] {
        assert_eq!(
            status_for_diagnostic_code(unknown),
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }
}

#[test]
fn effect_budget_diagnostics_pin_http_recovery_classes() {
    for code in ["SNAPBACK_AUTH_RATE_BUDGET", "SNAPBACK_AUTH_QUOTA_BUDGET"] {
        assert_eq!(
            status_for_diagnostic_code(code),
            StatusCode::TOO_MANY_REQUESTS
        );
    }
    assert_eq!(
        status_for_diagnostic_code("SNAPBACK_AUTH_IDEMPOTENCY_CONFLICT"),
        StatusCode::CONFLICT
    );
    assert_eq!(
        status_for_diagnostic_code("SNAPBACK_AUTH_BUDGET_AUTHORITY_UNAVAILABLE"),
        StatusCode::SERVICE_UNAVAILABLE
    );
    assert_eq!(
        status_for_diagnostic_code("SNAPBACK_AUTH_BUDGET_POLICY_INVALID"),
        StatusCode::INTERNAL_SERVER_ERROR
    );
    assert_eq!(
        status_for_diagnostic_code("SNAPBACK_AUTH_BUDGET_STATE_INVALID"),
        StatusCode::INTERNAL_SERVER_ERROR
    );
    assert_eq!(
        status_for_diagnostic_code("SNAPBACK_AUTH_GUEST_CATALOG_UNAVAILABLE"),
        StatusCode::SERVICE_UNAVAILABLE
    );
}

/// LLP 0132 vector errors distinguish unchanged-request terminal classes,
/// durable-state conflicts, readiness recovery, and server invariants.
/// The status is the public retry posture: 400/500 are not blindly
/// retryable, 409 waits for a corpus-state change, and 503 waits for index
/// readiness to change.
#[test]
fn s5_d10_vector_diagnostics_pin_http_and_retry_posture() {
    for (code, expected_status) in [
        ("SNAPBACK_VECTOR_INDEX_INVALID", StatusCode::BAD_REQUEST),
        ("SNAPBACK_VECTOR_QUERY_INVALID", StatusCode::BAD_REQUEST),
        (
            "SNAPBACK_VECTOR_QUERY_PLAN_INVALID",
            StatusCode::BAD_REQUEST,
        ),
        ("SNAPBACK_VECTOR_VALUE_INVALID", StatusCode::BAD_REQUEST),
        ("SNAPBACK_VECTOR_MAINTENANCE_LIMIT", StatusCode::BAD_REQUEST),
        ("SNAPBACK_VECTOR_CORPUS_BOUND", StatusCode::CONFLICT),
        (
            "SNAPBACK_VECTOR_INDEX_UNAVAILABLE",
            StatusCode::SERVICE_UNAVAILABLE,
        ),
        (
            "SNAPBACK_VECTOR_INDEX_CORRUPT",
            StatusCode::INTERNAL_SERVER_ERROR,
        ),
        (
            "SNAPBACK_VECTOR_MAINTENANCE_FAILED",
            StatusCode::INTERNAL_SERVER_ERROR,
        ),
        (
            "SNAPBACK_VECTOR_WORK_LIMIT",
            StatusCode::INTERNAL_SERVER_ERROR,
        ),
    ] {
        assert_eq!(
            status_for_diagnostic_code(code),
            expected_status,
            "{code} drifted out of its LLP 0132 HTTP/retry class"
        );
    }
}

/// Server capability/readiness faults remain retryable 503s, while a
/// concrete client that omitted an exact required offer gets an actionable
/// non-retryable 400. Exercise `IntoResponse`, not only the mapper.
#[tokio::test]
async fn served_capability_and_client_profile_refusals_have_distinct_statuses() {
    for (code, expected) in [
        (
            "SNAPBACK_CAPABILITY_UNSUPPORTED",
            StatusCode::SERVICE_UNAVAILABLE,
        ),
        (
            "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
            StatusCode::SERVICE_UNAVAILABLE,
        ),
        (
            "SNAPBACK_AUTH_PROFILE_CLIENT_UNSUPPORTED",
            StatusCode::BAD_REQUEST,
        ),
        (
            "SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED",
            StatusCode::BAD_REQUEST,
        ),
    ] {
        let response = super::ApiError::from(SnapbackError::error(
            code,
            "auth",
            "client capability is unsupported",
        ))
        .into_response();
        assert_eq!(response.status(), expected, "{code}");
        let body: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 64 * 1024).await.unwrap())
                .unwrap();
        assert_eq!(body["diagnostic"]["code"], code);
    }
}

/// LLP 0032 S5.D10 / ENG-24357 — derive the actually emitted `SNAPBACK_*`
/// literals from production Rust ASTs (including helper arguments and macro
/// token streams), normalize the one audited format family, and require every
/// emitted code to belong to the classified set. The classified registry may
/// include codes owned by source modules that are not compiled into this crate;
/// a hand-curated emitted subset cannot satisfy this completeness proof.
#[test]
fn s5_d10_all_emitted_diagnostics_have_reviewed_http_status() {
    let mut emitted = production_snapback_literals();
    // LLP 0276 split former remainder modules into owner crates. HTTP
    // exhaustiveness remains scoped to the server plus explicitly imported
    // wire registries, while a non-diagnostic exclusion is stale only when it
    // has disappeared from all authored production Rust.
    let workspace_literals = workspace_production_snapback_literals();
    let mut exclusions = BTreeSet::new();
    for (literal, reason) in NON_DIAGNOSTIC_SNAPBACK_LITERALS {
        assert!(!reason.is_empty(), "{literal} exclusion needs a reason");
        assert!(
            exclusions.insert(*literal),
            "duplicate non-diagnostic exclusion: {literal}"
        );
        assert!(
            emitted.remove(*literal) || workspace_literals.contains(*literal),
            "stale exclusion: {literal}"
        );
    }

    for (template, expansions) in DYNAMIC_DIAGNOSTIC_TEMPLATES {
        assert!(
            emitted.remove(*template) || workspace_literals.contains(*template),
            "dynamic diagnostic template changed or disappeared: {template}"
        );
        assert!(
            !expansions.is_empty(),
            "{template} needs explicit expansions"
        );
        for code in *expansions {
            assert!(
                code.starts_with(template),
                "{code} is not an expansion of {template}"
            );
            assert!(
                emitted.contains(*code),
                "{code} must be explicit in the HTTP mapper as well as the format family"
            );
        }
    }

    let expected = expected_http_diagnostic_codes();
    let unclassified = emitted.difference(&expected).collect::<Vec<_>>();
    let stale = expected.difference(&workspace_literals).collect::<Vec<_>>();
    assert!(
        unclassified.is_empty() && stale.is_empty(),
        "production diagnostics and the reviewed HTTP table drifted; \
             unclassified={unclassified:?}; stale={stale:?}"
    );
}

#[test]
fn s5_d10_stale_artifact_diagnostics_are_bad_requests() {
    let schema_kind = SchemaManifest {
        artifact_kind: "functionManifest".to_owned(),
        ..SchemaManifest::default()
    };
    let schema_version = SchemaManifest {
        schema_version: "snapback.v999".to_owned(),
        ..SchemaManifest::default()
    };
    let function_kind = FunctionManifest {
        artifact_kind: "schemaManifest".to_owned(),
        ..FunctionManifest::default()
    };
    let function_version = FunctionManifest {
        schema_version: "snapback.v999".to_owned(),
        ..FunctionManifest::default()
    };

    let emitted = [
        schema_kind
            .validate_artifact()
            .expect_err("schema kind")
            .diagnostic
            .code,
        schema_version
            .validate_artifact()
            .expect_err("schema version")
            .diagnostic
            .code,
        function_kind
            .validate_artifact()
            .expect_err("function kind")
            .diagnostic
            .code,
        function_version
            .validate_artifact()
            .expect_err("function version")
            .diagnostic
            .code,
    ];
    let expected = [
        "SNAPBACK_STALE_SCHEMA_ARTIFACT_KIND",
        "SNAPBACK_STALE_SCHEMA_ARTIFACT_VERSION",
        "SNAPBACK_STALE_FUNCTION_ARTIFACT_KIND",
        "SNAPBACK_STALE_FUNCTION_ARTIFACT_VERSION",
    ];

    assert_eq!(emitted, expected);
    for code in emitted {
        assert_eq!(status_for_diagnostic_code(&code), StatusCode::BAD_REQUEST);
    }
}

#[test]
fn action_watchdog_timeout_clamps_untrusted_environment_values() {
    assert_eq!(
        parse_action_watchdog_timeout(None),
        ACTION_WATCHDOG_DEFAULT_MS
    );
    assert_eq!(
        parse_action_watchdog_timeout(Some("not-a-number")),
        ACTION_WATCHDOG_DEFAULT_MS
    );
    assert_eq!(
        parse_action_watchdog_timeout(Some("0")),
        ACTION_WATCHDOG_DEFAULT_MS
    );
    assert_eq!(parse_action_watchdog_timeout(Some("1")), 1);
    assert_eq!(
        parse_action_watchdog_timeout(Some(&u64::MAX.to_string())),
        ACTION_WATCHDOG_MAX_MS
    );

    assert_eq!(
        configured_action_worker_limit(None),
        ACTION_WORKER_LIMIT_DEFAULT
    );
    assert_eq!(
        configured_action_worker_limit(Some("not-a-number")),
        ACTION_WORKER_LIMIT_DEFAULT
    );
    assert_eq!(
        configured_action_worker_limit(Some("0")),
        ACTION_WORKER_LIMIT_DEFAULT
    );
    assert_eq!(configured_action_worker_limit(Some("1")), 1);
    assert_eq!(
        configured_action_worker_limit(Some(&usize::MAX.to_string())),
        ACTION_WORKER_LIMIT_MAX
    );

    assert_eq!(
        configured_cron_dispatch_concurrency(None),
        CRON_DISPATCH_CONCURRENCY_DEFAULT
    );
    assert_eq!(
        configured_cron_dispatch_concurrency(Some("not-a-number")),
        CRON_DISPATCH_CONCURRENCY_DEFAULT
    );
    assert_eq!(
        configured_cron_dispatch_concurrency(Some("0")),
        CRON_DISPATCH_CONCURRENCY_DEFAULT
    );
    assert_eq!(configured_cron_dispatch_concurrency(Some("1")), 1);
    assert_eq!(
        configured_cron_dispatch_concurrency(Some(&usize::MAX.to_string())),
        CRON_DISPATCH_CONCURRENCY_MAX
    );
}

/// A deferred pre-cut fanout can wake the socket after terminal retirement
/// has acquired the registry but before it installs the typed event. The
/// wake may observe no event, but its exact act then queues behind that
/// registry owner; removal cannot become visible until the event is.
///
/// @ref LLP 0059#typed-terminal-auth-error — registry-linearized terminal
/// installation closes every notifier source, not only purge-generated
/// wakes.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn preterminal_wake_blocked_on_registry_observes_typed_event_after_retirement() {
    let state = test_detached_app_state(LocalSnapback::memory().expect("terminal wake state"));
    let opened = state
        .connections
        .open(Some("terminal-wake-registry".to_owned()), None, true)
        .expect("open predecessor grant");
    let prepared = state
        .connections
        .prepare_act(
            &opened.connection_id,
            Some(&opened.connection_token),
            None,
            true,
            super::now_millis(),
            Instant::now(),
        )
        .expect("prepare predecessor act");
    let notifier = state.ephemeral.delivery_notifier();
    let (generation, waker) = notifier
        .register_bound(&opened.connection_id, prepared.grant_id.clone())
        .expect("register predecessor socket");
    let event = crate::ephemeral::DeliveryTerminalEvent {
        code: crate::live_wire::LiveAuthErrorCode::StreamReset,
        reason: crate::live_wire::LiveAuthErrorReason::Reset,
        authority_disposition: crate::live_wire::LiveAuthorityDisposition::DurableDelete,
        close_by: Instant::now() + Duration::from_secs(5),
    };
    let (preterminal_observed, observation) = std::sync::mpsc::channel();

    let waiter_notifier = notifier.clone();
    let waiter_connection_id = opened.connection_id.clone();
    let waiter_registry = state.connections.clone();
    let waiter = tokio::spawn(async move {
        tokio::time::timeout(Duration::from_secs(1), waker.notified())
            .await
            .expect("injected preterminal fanout wakes the socket");
        assert!(
            waiter_notifier
                .terminal_if_current(&waiter_connection_id, generation)
                .is_none(),
            "the deterministic wake lands before terminal installation"
        );
        preterminal_observed
            .send(())
            .expect("release registry terminal installation");
        let act = tokio::task::spawn_blocking(move || {
            prepared.try_act(
                &waiter_registry,
                super::now_millis(),
                Instant::now(),
                || Ok(()),
            )
        })
        .await
        .expect("blocked exact act task completes");
        assert!(act.is_err(), "retirement wins the exact grant");
        waiter_notifier
            .terminal_if_current(&waiter_connection_id, generation)
            .expect("the socket exit observes the registry-installed event")
    });

    let terminal_registry = state.connections.clone();
    let terminal_ephemeral = state.ephemeral.clone();
    let terminal_notifier = notifier.clone();
    let terminal_connection_id = opened.connection_id.clone();
    let captures = tokio::task::spawn_blocking(move || {
        terminal_registry.clear_after_committed_reset_inner(|capture| {
            assert_eq!(capture.connection_id, terminal_connection_id);
            // This models an after-Local callback whose authority cut was
            // honestly preterminal but whose notifier wake was deferred.
            terminal_ephemeral.enqueue_durable_for_test(
                &terminal_connection_id,
                b"preterminal-deferred-wake".to_vec(),
            );
            observation
                .recv_timeout(Duration::from_secs(1))
                .expect("socket consumes the preterminal wake first");
            super::install_bound_terminal_before_retirement(&terminal_notifier, capture, event);
        })
    })
    .await
    .expect("registry-linearized terminal retirement completes");
    for capture in captures {
        super::purge_connection_capture(&state.ephemeral, &capture, false);
        super::cleanup_mint_only_retired_connection(
            state.ephemeral.clone(),
            state.snapback.clone(),
            capture,
        )
        .await;
    }

    assert_eq!(
        waiter.await.expect("socket witness task"),
        event,
        "the pre-event wake converges on the exact typed terminal event"
    );
}

/// Whole-ID auth cleanup is justified by the same registry mutation that
/// permanently enables mint-only containment. A caller requesting the old
/// readable id receives a distinct successor, whose activity/outbox state
/// survives the predecessor's asynchronous post-Local sweep.
#[tokio::test]
async fn terminal_retired_whole_id_cleanup_preserves_typed_event_and_minted_successor() {
    let state = test_detached_app_state(LocalSnapback::memory().expect("terminal cleanup state"));
    let predecessor = state
        .connections
        .open(Some("terminal-whole-id".to_owned()), None, true)
        .expect("open predecessor grant");
    let predecessor_grant_id = state
        .connections
        .lock()
        .grants
        .get(&predecessor.connection_id)
        .expect("predecessor record")
        .grant_id
        .clone();
    state.ephemeral.touch_connection(&predecessor.connection_id);
    state
        .ephemeral
        .enqueue_durable_for_test(&predecessor.connection_id, b"predecessor".to_vec());
    let notifier = state.ephemeral.delivery_notifier();
    let (generation, waker) = notifier
        .register_bound(&predecessor.connection_id, predecessor_grant_id)
        .expect("register predecessor socket");
    let close_by = Instant::now() + Duration::from_secs(5);

    state
        .auth_terminal_lifecycle
        .committed_stream_reset(crate::live_wire::LiveAuthErrorReason::Reset, close_by);
    tokio::time::timeout(Duration::from_secs(1), waker.notified())
        .await
        .expect("typed terminal event wakes predecessor");
    let event = notifier
        .terminal_if_current(&predecessor.connection_id, generation)
        .expect("typed terminal event remains installed");
    assert_eq!(event.code, crate::live_wire::LiveAuthErrorCode::StreamReset);
    assert_eq!(event.close_by, close_by);

    let successor = state
        .connections
        .open(Some(predecessor.connection_id.clone()), None, true)
        .expect("mint successor under containment");
    assert_ne!(
        successor.connection_id, predecessor.connection_id,
        "mint-only containment forbids same-readable-id adoption during whole cleanup"
    );
    state.ephemeral.touch_connection(&successor.connection_id);
    state
        .ephemeral
        .enqueue_durable_for_test(&successor.connection_id, b"successor".to_vec());

    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            if state.ephemeral.active_connection_count_for_test() == 1
                && !state
                    .ephemeral
                    .has_connection_residue_for_test(&predecessor.connection_id)
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("predecessor whole-ID cleanup finishes");
    assert_eq!(
        notifier.terminal_if_current(&predecessor.connection_id, generation),
        Some(event),
        "whole-ID cleanup cannot erase the typed terminal notifier event"
    );
    let successor_messages = state.ephemeral.drain_outbox(&successor.connection_id);
    assert!(matches!(
        successor_messages.as_slice(),
        [RealtimeEnvelope::Durable(message)] if message.payload == b"successor"
    ));
}

#[tokio::test]
async fn committed_reset_keeps_a_queued_managed_writer_out_until_successor_install() {
    let state = auth_invalidation_reset_fixture_with_context(ServerContext::detached());
    let (reset_committed, release_reset) =
        install_committed_reset_handoff_test_hook(&state.snapback);
    let reset_state = state.clone();
    let reset_admission = test_route_admission(&state).0;
    let reset =
        tokio::spawn(
            async move { coordinated_app_reset(&reset_state, &reset_admission, None).await },
        );

    tokio::time::timeout(Duration::from_secs(2), reset_committed.notified())
        .await
        .expect("reset reaches the post-finalizer handoff gap");

    let writer_state = state.snapback.clone();
    let (writer_started_tx, writer_started_rx) = tokio::sync::oneshot::channel();
    let (writer_entered_tx, mut writer_entered_rx) = tokio::sync::oneshot::channel();
    let writer = tokio::spawn(async move {
        writer_started_tx.send(()).unwrap();
        super::with_snapback_authorization_write(
            &writer_state,
            |_| Ok(crate::storage::AuthorizationCommitPreflight::AllProtectedRooms),
            move |snapback| {
                writer_entered_tx.send(()).unwrap();
                snapback.seed(SeedData {
                    tables: BTreeMap::from([(
                        "resetPermissions".to_owned(),
                        vec![serde_json::Map::from_iter([
                            ("_id".to_owned(), json!("queued-writer")),
                            ("subject".to_owned(), json!("successor")),
                        ])],
                    )]),
                })
            },
        )
        .await
        .and_then(|result| result)
    });
    writer_started_rx.await.expect("queued writer task started");

    assert!(
        tokio::time::timeout(Duration::from_millis(100), &mut writer_entered_rx)
            .await
            .is_err(),
        "a managed writer entered after reset finalization but before successor issuer install"
    );

    release_reset.notify_one();
    let reset_output = tokio::time::timeout(Duration::from_secs(2), reset)
        .await
        .expect("reset resumes after the test barrier")
        .expect("reset task joins")
        .expect("reset succeeds");
    assert!(reset_output.is_none());

    tokio::time::timeout(Duration::from_secs(2), &mut writer_entered_rx)
        .await
        .expect("queued writer enters after reset publication")
        .expect("queued writer reports entry");
    let output = writer
        .await
        .expect("queued writer task joins")
        .expect("queued authorization write commits under the successor issuer");
    assert_eq!(output.changed_count, 1);
}

#[tokio::test]
async fn postcommit_reset_finalize_failure_clears_issuers_and_stays_globally_closed() {
    let state = auth_invalidation_reset_fixture_with_context(ServerContext::detached());
    let managed_handoff =
        with_snapback(&state.snapback, |snapback| snapback.managed_local_handoff()).await;
    let writer_queued =
        super::writer_gate::install_managed_handoff_waiter_test_hook(&managed_handoff);
    let coordinator = state.auth_coordinator.clone().expect("reset coordinator");
    let predecessor = coordinator
        .authorization_stream_incarnation()
        .expect("predecessor incarnation");
    coordinator.inject_finalize_failure();
    let (reset_committed, release_reset) =
        install_committed_reset_handoff_test_hook(&state.snapback);
    let route_admission = test_route_admission(&state).0;
    let reset_state = state.clone();
    let reset =
        tokio::spawn(
            async move { coordinated_app_reset(&reset_state, &route_admission, None).await },
        );
    tokio::time::timeout(Duration::from_secs(2), reset_committed.notified())
        .await
        .expect("reset reaches its closed post-finalizer handoff");

    let writer_state = state.snapback.clone();
    let (writer_started_tx, writer_started_rx) = tokio::sync::oneshot::channel();
    let (writer_entered_tx, mut writer_entered_rx) = tokio::sync::oneshot::channel();
    let writer = tokio::spawn(async move {
        writer_started_tx.send(()).unwrap();
        super::with_snapback_authorization_write(
            &writer_state,
            |_| Ok(crate::storage::AuthorizationCommitPreflight::AllProtectedRooms),
            move |snapback| {
                writer_entered_tx.send(()).unwrap();
                snapback.seed(SeedData {
                    tables: BTreeMap::from([(
                        "resetPermissions".to_owned(),
                        vec![serde_json::Map::from_iter([
                            ("_id".to_owned(), json!("must-not-commit")),
                            ("subject".to_owned(), json!("closed")),
                        ])],
                    )]),
                })
            },
        )
        .await
        .and_then(|result| result)
    });
    writer_started_rx.await.expect("queued writer task started");
    tokio::time::timeout(Duration::from_secs(2), writer_queued.notified())
        .await
        .expect("writer registers as a waiter on the closed reset handoff");
    assert!(managed_handoff.is_closed());
    assert!(
        tokio::time::timeout(Duration::from_millis(100), &mut writer_entered_rx)
            .await
            .is_err(),
        "writer must be queued on the closed handoff before reset finalization fails"
    );

    release_reset.notify_one();
    let error = tokio::time::timeout(Duration::from_secs(2), reset)
        .await
        .expect("postcommit finalize failure returns without wedging")
        .expect("reset task joins")
        .expect_err("injected postcommit finalize failure");
    assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_REVOCATION_UNCERTAIN");
    let refused = tokio::time::timeout(Duration::from_secs(2), writer)
        .await
        .expect("queued writer wakes after fail-closed reset")
        .expect("queued writer task joins")
        .expect_err("queued writer observes the lasting typed refusal");
    assert_eq!(
        refused.diagnostic.code,
        "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE"
    );
    assert!(
        writer_entered_rx.await.is_err(),
        "the refused writer never enters its committing Local closure"
    );
    let durable = tokio::time::timeout(
        Duration::from_secs(2),
        with_snapback(&state.snapback, |snapback| {
            snapback
                .remainder_auth_fixture()
                .authorization_version()
                .expect("durable committed successor")
        }),
    )
    .await
    .expect("fail-closed reset releases the transient writer handoff");
    assert_ne!(durable.incarnation, predecessor);
    assert_eq!(
        coordinator
            .authorization_stream_incarnation()
            .expect_err("coordinator stays globally closed")
            .diagnostic
            .code,
        "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE",
    );
    assert!(
        state
            .auth_invalidation
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .is_none(),
        "router issuer is cleared",
    );
    assert!(
        state
            .connections
            .invalidation_expectation_for_test()
            .is_none(),
        "connection issuer is cleared",
    );
    assert!(
        state
            .ephemeral
            .authorization_expectation_for_test()
            .is_none(),
        "room issuer is cleared",
    );
    assert!(
        with_snapback(&state.snapback, |snapback| {
            snapback.auth_invalidation_expectation_for_test()
        })
        .await
        .is_none(),
        "query issuer is cleared",
    );
}

#[tokio::test]
async fn postcommit_reset_clear_failure_releases_queued_writer_to_typed_refusal() {
    let state = auth_invalidation_reset_fixture_with_context(ServerContext::detached());
    with_snapback(&state.snapback, |snapback| {
        snapback.inject_installed_auth_invalidation_clear_failure();
    })
    .await;
    let managed_handoff =
        with_snapback(&state.snapback, |snapback| snapback.managed_local_handoff()).await;
    let writer_queued =
        super::writer_gate::install_managed_handoff_waiter_test_hook(&managed_handoff);
    let coordinator = state.auth_coordinator.clone().expect("reset coordinator");
    coordinator.inject_finalize_failure();
    let (reset_committed, release_reset) =
        install_committed_reset_handoff_test_hook(&state.snapback);
    let route_admission = test_route_admission(&state).0;
    let reset_state = state.clone();
    let reset =
        tokio::spawn(
            async move { coordinated_app_reset(&reset_state, &route_admission, None).await },
        );
    tokio::time::timeout(Duration::from_secs(2), reset_committed.notified())
        .await
        .expect("reset reaches its closed post-finalizer handoff");

    let writer_state = state.snapback.clone();
    let (writer_entered_tx, mut writer_entered_rx) = tokio::sync::oneshot::channel();
    let writer = tokio::spawn(async move {
        super::with_snapback_authorization_write(
            &writer_state,
            |_| Ok(crate::storage::AuthorizationCommitPreflight::AllProtectedRooms),
            move |snapback| {
                writer_entered_tx.send(()).unwrap();
                snapback.seed(SeedData {
                    tables: BTreeMap::from([(
                        "resetPermissions".to_owned(),
                        vec![serde_json::Map::from_iter([
                            (
                                "_id".to_owned(),
                                json!("must-not-commit-after-clear-failure"),
                            ),
                            ("subject".to_owned(), json!("closed")),
                        ])],
                    )]),
                })
            },
        )
        .await
        .and_then(|result| result)
    });
    tokio::time::timeout(Duration::from_secs(2), writer_queued.notified())
        .await
        .expect("writer registers as a waiter on the closed reset handoff");
    assert!(managed_handoff.is_closed());
    assert!(
        tokio::time::timeout(Duration::from_millis(100), &mut writer_entered_rx)
            .await
            .is_err(),
        "writer must be queued when installed-issuer cleanup fails"
    );

    release_reset.notify_one();
    let reset_error = tokio::time::timeout(Duration::from_secs(2), reset)
        .await
        .expect("installed-issuer clear failure returns from reset")
        .expect("reset task joins")
        .expect_err("injected successor clear failure");
    let refused = tokio::time::timeout(Duration::from_secs(2), writer)
        .await
        .expect("queued writer wakes after best-effort clear fails")
        .expect("queued writer task joins")
        .expect_err("queued writer observes the lasting typed refusal");
    assert_eq!(
        refused.diagnostic.code,
        "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE"
    );
    assert!(
        writer_entered_rx.await.is_err(),
        "the refused writer never enters its committing Local closure"
    );
    assert_eq!(
        reset_error.diagnostic.code,
        "SNAPBACK_AUTH_REVOCATION_UNCERTAIN"
    );
    assert_eq!(
        coordinator
            .authorization_stream_incarnation()
            .expect_err("coordinator stays globally closed")
            .diagnostic
            .code,
        "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE",
    );
    assert!(
        state
            .ephemeral
            .authorization_expectation_for_test()
            .is_none(),
        "room issuer stays suspended after exact successor cleanup fails",
    );
    assert!(
        with_snapback(&state.snapback, |snapback| {
            snapback.auth_invalidation_expectation_for_test()
        })
        .await
        .is_none(),
        "query issuer stays suspended after exact successor cleanup fails",
    );
}

/// LLP 0031 §The invariant — the declared registry holds the boundary: every
/// app-data entry is a root path, every system entry is under the reserved
/// prefix, system-api entries are admin-gated except the LLP 0301 public
/// identity fact, static console/guide entries are public presentation, and
/// no privileged operation lives at the root.
#[test]
fn s1_route_registry_matches_the_invariant() {
    let registry = route_registry();
    assert!(!registry.is_empty());
    let mut seen = std::collections::BTreeSet::new();
    for route in &registry {
        assert!(
            seen.insert((route.method, route.path)),
            "duplicate registry entry: {} {}",
            route.method,
            route.path
        );
        let reserved = route.path.starts_with(RESERVED_PREFIX);
        match route.class {
            RouteClass::AppData => {
                assert!(
                    !reserved,
                    "app-data route must live at the root: {}",
                    route.path
                );
                assert!(
                    matches!(
                        route.policy,
                        RoutePolicy::Public
                            | RoutePolicy::AppAuth
                            | RoutePolicy::ConnectionAuth
                            | RoutePolicy::SessionAuth
                    ),
                    "app-data route carries a system-admin policy: {}",
                    route.path
                );
            }
            RouteClass::SystemStatic => {
                // The llms.txt convention pins this one system-static guide
                // projection to the served root.
                assert!(
                    route.path.starts_with("/_snapback/admin")
                        || route.path.starts_with("/_snapback/guide")
                        || route.path == "/llms.txt",
                    "system-static must be console or guide presentation: {}",
                    route.path
                );
                assert_eq!(
                    route.policy,
                    RoutePolicy::Public,
                    "console shell is public presentation: {}",
                    route.path
                );
            }
            RouteClass::SystemApi => {
                assert!(
                    route.path.starts_with("/_snapback/api/"),
                    "system-api must live under /_snapback/api/: {}",
                    route.path
                );
                let public_identity = route.method == "GET"
                    && route.path == "/_snapback/api/app/identity"
                    && route.policy == RoutePolicy::Public;
                assert!(
                    public_identity
                        || matches!(
                            route.policy,
                            RoutePolicy::AdminRead
                                | RoutePolicy::AdminWrite
                                | RoutePolicy::AdminSecretRead
                        ),
                    "system-api must be admin-gated or the public identity fact: {}",
                    route.path
                );
            }
        }
    }
}

#[test]
fn watch_anchor_renewal_route_is_session_only_and_surface_mapped() {
    let matching = route_registry()
        .into_iter()
        .filter(|route| route.method == "POST" && route.path == "/watches/{id}/renew")
        .collect::<Vec<_>>();
    assert_eq!(
        matching.len(),
        1,
        "renewal has exactly one registered route"
    );
    let route = matching[0];
    assert_eq!(route.class, RouteClass::AppData);
    assert_eq!(route.policy, RoutePolicy::SessionAuth);
    assert_eq!(
        route.credential_resolution,
        super::CredentialResolution::RequiredSessionBearer,
        "fresh recurring consent cannot be supplied by an integration carrier",
    );
    assert_eq!(
        super::registered_invocation_source(route),
        Some(InvocationSource::WatchManagement),
        "the surface map must prepare renewal under watch management authority",
    );
}

/// LLP 0031 §Enforcement — every operation multiplexed over the app-data
/// `/live/*` socket is itself app-data, and the declared list matches the
/// enum's variants (the exhaustive `live_socket_operation_name` forces a new
/// variant to be classified).
#[test]
fn s1_live_socket_operations_are_all_app_data() {
    let declared = live_socket_operations();
    for (name, class) in &declared {
        assert_eq!(
            *class,
            RouteClass::AppData,
            "live-socket operation {name} must be app-data"
        );
    }

    let scope = Scope::from_pairs([("roomId", "room_1")]);
    let samples = [
        LiveSocketClientMessage::EphemeralSubscribe {
            request_id: None,
            request: SubscribeRequest {
                collection: "c".to_owned(),
                scope: scope.clone(),
                connection_id: "conn".to_owned(),
                auth: Default::default(),
                since_chunk: None,
            },
        },
        LiveSocketClientMessage::EphemeralPublish {
            request_id: None,
            request: PublishRequest {
                collection: "c".to_owned(),
                scope: scope.clone(),
                connection_id: "conn".to_owned(),
                session_id: None,
                user_id: None,
                custom_key: None,
                value: Vec::new(),
                ttl_ms: None,
                auth: Default::default(),
            },
        },
        LiveSocketClientMessage::EphemeralDelete {
            request_id: None,
            request: DeleteRequest {
                collection: "c".to_owned(),
                scope: scope.clone(),
                connection_id: "conn".to_owned(),
                session_id: None,
                user_id: None,
                custom_key: None,
                expected_scope_epoch: None,
                expected_entry_generation: None,
                auth: Default::default(),
            },
        },
        LiveSocketClientMessage::EphemeralUnsubscribe {
            request_id: None,
            request: SubscribeRequest {
                collection: "c".to_owned(),
                scope,
                connection_id: "conn".to_owned(),
                auth: Default::default(),
                since_chunk: None,
            },
        },
        LiveSocketClientMessage::Ping { request_id: None },
    ];
    let sample_names: std::collections::BTreeSet<_> =
        samples.iter().map(live_socket_operation_name).collect();
    let declared_names: std::collections::BTreeSet<_> =
        declared.iter().map(|(name, _)| *name).collect();
    assert_eq!(
        sample_names, declared_names,
        "every LiveSocketClientMessage variant must be a declared app-data operation"
    );
}

#[test]
fn live_socket_rejects_oversized_control_frames_before_json_decode() {
    let snapback = LocalSnapback::memory().expect("memory instance");
    let ephemeral = snapback.ephemeral_api();
    let frame = "x".repeat(super::MAX_LIVE_SOCKET_FRAME_BYTES + 1);
    let response = super::handle_live_socket_text(
        &ephemeral,
        "conn",
        &frame,
        super::PolicyAuthMode::Dev,
        false,
        &ResolvedAppAuthority::Anonymous,
    );
    let response: serde_json::Value =
        serde_json::from_str(&response.text).expect("typed socket error");
    assert_eq!(
        response["diagnostic"]["code"],
        "SNAPBACK_WEBSOCKET_MESSAGE_TOO_LARGE"
    );
    assert_eq!(response["diagnostic"]["details"]["boundKind"], "live-frame");
    assert_eq!(
        response["diagnostic"]["details"]["bytes"],
        super::MAX_LIVE_SOCKET_FRAME_BYTES + 1
    );
    assert_eq!(
        response["diagnostic"]["details"]["maxBytes"],
        super::MAX_LIVE_SOCKET_FRAME_BYTES
    );
}

#[test]
fn dev_live_identity_frames_record_connection_witness_and_warn_once_when_unwitnessed() {
    let snapback = LocalSnapback::memory().expect("memory instance");
    let ephemeral = snapback.ephemeral_api();
    let frame = json!({
        "type": "ephemeral_subscribe",
        "requestId": "dev-identity-witness",
        "request": {
            "collection": "missing-is-fine-for-witness-test",
            "scope": { "room": "one" },
            "connection_id": "conn",
            "auth": {
                "principal": "asserted",
                "session_id": null,
                "user_id": "asserted",
                "permissions": []
            }
        }
    })
    .to_string();

    let (unwitnessed, _capability) = dev_identity_capability_fixture();
    let warning = unwitnessed.clone();
    let _ = super::handle_live_socket_text_authorized(
        &ephemeral,
        "conn",
        &frame,
        PolicyAuthMode::Dev,
        false,
        &ResolvedAppAuthority::Anonymous,
        super::LiveSocketEffectContext {
            dev_identity_capabilities: Some(&unwitnessed),
            dev_identity_witnessed: false,
            ..Default::default()
        },
    );
    assert!(
        !warning.warn_unwitnessed_assertion_once(),
        "unwitnessed identity frame consumed the one boot warning"
    );

    let (witnessed, _capability) = dev_identity_capability_fixture();
    let untouched = witnessed.clone();
    let _ = super::handle_live_socket_text_authorized(
        &ephemeral,
        "conn",
        &frame,
        PolicyAuthMode::Dev,
        false,
        &ResolvedAppAuthority::Anonymous,
        super::LiveSocketEffectContext {
            dev_identity_capabilities: Some(&witnessed),
            dev_identity_witnessed: true,
            ..Default::default()
        },
    );
    assert!(
        untouched.warn_unwitnessed_assertion_once(),
        "witnessed connection must not consume the compatibility warning"
    );
}
