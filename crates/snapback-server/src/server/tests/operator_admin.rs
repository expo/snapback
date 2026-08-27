// Complete test items included at `server::tests` module scope.

/// @ref LLP 0184#c-administrator-ephemeral-entry-delete--add-now — the
/// HTTP receipt must call the operation an unevaluated operator bypass,
/// and the process nonce is an enforced server-side fence.
#[tokio::test]
async fn operator_delete_http_checks_startup_nonce_and_discloses_bypass() {
    let state = operator_delete_server_fixture(ServerProfile::Test, false);
    let now_ms = super::now_millis();
    let published = state
        .ephemeral
        .publish(
            PublishRequest {
                collection: "boardCursors".to_owned(),
                scope: Scope::from_pairs([("boardId", "board-1")]),
                connection_id: "owner".to_owned(),
                session_id: None,
                user_id: None,
                custom_key: None,
                value: b"cursor".to_vec(),
                ttl_ms: None,
                auth: crate::ephemeral::AuthContext::default(),
            },
            now_ms,
        )
        .expect("publish inspected entry");
    let request_body = |startup_nonce: &str| {
        serde_json::to_vec(&json!({
            "collection": published.room.collection.clone(),
            "scope": published.room.scope.clone(),
            "entryKey": published.key.0.clone(),
            "expectedScopeEpoch": published.scope_epoch,
            "expectedEntryGeneration": published.entry_version,
            "reason": "repair stuck presence",
            "startupNonce": startup_nonce,
        }))
        .unwrap()
    };

    let stale = super::operator_delete_ephemeral(
        State(state.clone()),
        operator_delete_headers(),
        Ok(Bytes::from(request_body("wrong-process"))),
    )
    .await
    .expect_err("stale process identity must refuse before deletion")
    .into_response();
    assert_eq!(stale.status(), StatusCode::CONFLICT);
    assert_eq!(
        response_json(stale).await["diagnostic"]["code"],
        "SNAPBACK_EPHEMERAL_OPERATOR_DELETE_STALE_STARTUP_NONCE"
    );

    let receipt = super::operator_delete_ephemeral(
        State(state),
        operator_delete_headers(),
        Ok(Bytes::from(request_body("operator-delete-startup"))),
    )
    .await
    .expect("matching process, epoch, and generation delete")
    .0;
    assert_eq!(receipt["operation"], "ephemeral.operatorDelete");
    assert_eq!(receipt["authorityMode"], "operatorBypass");
    assert_eq!(receipt["authorizationEvaluated"], false);
    assert_eq!(receipt["bypass"], true);
    assert_eq!(receipt["ok"], true);
    assert!(
        receipt["note"]
            .as_str()
            .is_some_and(|note| note.contains("not an authorization decision"))
    );
}

#[tokio::test]
async fn operator_delete_refuses_production_and_derived_before_body_parsing() {
    for (state, expected_code) in [
        (
            operator_delete_server_fixture(ServerProfile::Prod, false),
            "SNAPBACK_EPHEMERAL_OPERATOR_DELETE_TARGET_REFUSED_HOSTED",
        ),
        (
            operator_delete_server_fixture(ServerProfile::Test, true),
            "SNAPBACK_EPHEMERAL_OPERATOR_DELETE_TARGET_REFUSED_DERIVED",
        ),
    ] {
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-snapback-admin-token",
            HeaderValue::from_static("operator-delete-admin"),
        );
        let response = super::operator_delete_ephemeral(State(state), headers, Ok(Bytes::new()))
            .await
            .expect_err("target posture must refuse malformed body without parsing it")
            .into_response();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert_eq!(
            response_json(response).await["diagnostic"]["code"],
            expected_code
        );
    }
}

#[tokio::test]
async fn dev_transport_and_prod_profile_fail_closed_but_keep_health_available() {
    let (mut non_loopback, _) = auth_runtime_fixture(PolicyAuthMode::Dev);
    Arc::make_mut(&mut non_loopback.server)
        .record_bound_address("0.0.0.0:4287".parse().expect("non-loopback address"));
    let router = app(non_loopback.clone());
    let refused = router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/inspect")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(refused.status(), StatusCode::INTERNAL_SERVER_ERROR);
    let refused = response_json(refused).await;
    assert_eq!(
        refused["diagnostic"]["code"],
        "SNAPBACK_AUTH_TRANSPORT_INSECURE"
    );
    assert!(
        refused["diagnostic"]["message"]
            .as_str()
            .unwrap()
            .contains("SNAPBACK_PROFILE")
    );
    assert_eq!(
        refused["diagnostic"]["details"]["profileEnvVar"],
        "SNAPBACK_PROFILE"
    );
    let health = router
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(health.status(), StatusCode::OK);

    let allowed = non_loopback.with_insecure_dev_auth_override(true);
    let inspect = app(allowed)
        .oneshot(
            Request::builder()
                .uri("/inspect")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(inspect.status(), StatusCode::OK);

    let (mut prod, _) = auth_runtime_fixture(PolicyAuthMode::Dev);
    Arc::make_mut(&mut prod.server).profile = ServerProfile::Prod;
    let refused = app(prod)
        .oneshot(
            Request::builder()
                .uri("/inspect")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(refused.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        response_json(refused).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_POLICY_UNAVAILABLE"
    );

    let (mut sessions, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
    Arc::make_mut(&mut sessions.server)
        .record_bound_address("0.0.0.0:4287".parse().expect("non-loopback address"));
    let sessions = sessions.with_insecure_dev_auth_override(true);
    let refused = app(sessions)
        .oneshot(
            Request::builder()
                .uri("/inspect")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(refused.status(), StatusCode::INTERNAL_SERVER_ERROR);
    let refused = response_json(refused).await;
    assert_eq!(
        refused["diagnostic"]["code"],
        "SNAPBACK_AUTH_TRANSPORT_INSECURE"
    );
    assert!(
        refused["diagnostic"]["message"]
            .as_str()
            .unwrap()
            .contains("SNAPBACK_PROFILE")
    );
    assert_eq!(
        refused["diagnostic"]["details"]["overrideAppliesToSessions"],
        false
    );
}

/// The first served-origin run found `/_snapback/*` answering 503 while the
/// admission attested `operatorSurface: "disabled"` — an attested fact with
/// no enforcing code behind it. This pins the enforcement.
///
/// @ref LLP 0098#81-first-served-origin-run--2026-07-25
#[tokio::test]
async fn hosted_admission_enforces_the_operator_surface_it_attests() {
    let (mut state, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
    Arc::make_mut(&mut state.server).auth_deployment =
        crate::auth::deployment::AuthDeploymentTarget::Hosted;
    let state = state
        .with_hosted_serving_authority(hosted_serving_authority(super::now_millis()))
        .expect("install hosted serving authority");
    let router = app(state);

    // Every operator route is a fixed, body-free 404 — including with a
    // valid admin token, and identically for pages and API routes so the
    // response cannot distinguish a present route from an absent one.
    // NOTE: the method must match each route's registration. A
    // method-mismatched request is rejected by axum's method router with
    // 405 *before* this middleware runs, so a wrong-method probe still
    // distinguishes a present operator route from an absent one. That
    // residual is recorded in LLP 0098 §8.1 rather than papered over here.
    for (method, path) in [
        ("GET", "/_snapback/admin"),
        ("GET", "/_snapback/api/inspect"),
        ("POST", "/_snapback/api/schema/load"),
        ("GET", "/_snapback/not-registered"),
    ] {
        let disabled = router
            .clone()
            .oneshot(via_hosted_terminator(
                Request::builder()
                    .method(method)
                    .uri(path)
                    .header("x-snapback-admin-token", "auth-http-admin")
                    .body(Body::empty())
                    .unwrap(),
                TEST_HOSTED_CLIENT_SOURCE,
            ))
            .await
            .unwrap();
        assert_eq!(
            disabled.status(),
            StatusCode::NOT_FOUND,
            "{path} must be a fixed 404 under an attested disabled operator surface"
        );
        let body = axum::body::to_bytes(disabled.into_body(), usize::MAX)
            .await
            .expect("read disabled operator body");
        assert!(body.is_empty(), "{path} must expose no body");
    }

    // The capability projection stays reachable: disabling the operator
    // surface must not also hide the descriptor a hosted deployment
    // publishes about itself.
    let inspect = router
        .clone()
        .oneshot(via_hosted_terminator(
            Request::builder()
                .uri("/inspect")
                .header("x-snapback-admin-token", "auth-http-admin")
                .body(Body::empty())
                .unwrap(),
            TEST_HOSTED_CLIENT_SOURCE,
        ))
        .await
        .unwrap();
    assert_eq!(inspect.status(), StatusCode::OK);
}

#[tokio::test]
async fn public_and_admin_inspect_project_exact_auth_program_readiness() {
    let readiness = AuthProgramReadiness::new(true, true, true, true, true, true, true);
    let expected = serde_json::to_value(&readiness).unwrap();
    let (state, _) = auth_runtime_fixture(PolicyAuthMode::Dev);
    let state = state
        .with_auth_runtime_facts(AuthModeStateRecord::initial_dev(None), readiness)
        .expect("install readiness");
    let router = app(state);
    for (uri, admin) in [
        ("/inspect", None),
        ("/_snapback/api/inspect", Some("auth-http-admin")),
    ] {
        let mut request = Request::builder().uri(uri);
        if let Some(admin) = admin {
            request = request.header("x-snapback-admin-token", admin);
        }
        let response = router
            .clone()
            .oneshot(request.body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK, "{uri}");
        let body = response_json(response).await;
        assert_eq!(
            body["capabilityManifest"]["runtimeFacts"]["authProgramReadiness"], expected,
            "{uri}"
        );
    }
}

#[tokio::test]
async fn inspect_projects_missing_external_ibex_cli_without_startup_notice() {
    let mut snapback = LocalSnapback::memory().expect("missing CLI inspect fixture");
    snapback.force_ibex_cli_unavailable_for_test();
    let router = app(test_detached_app_state(snapback));

    for uri in ["/inspect", "/_snapback/api/inspect"] {
        let response = router
            .clone()
            .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK, "{uri}");
        let body = response_json(response).await;
        assert_eq!(body["runtime"]["ibexCli"]["available"], false, "{uri}");
        assert!(
            body["capabilityGaps"]
                .as_array()
                .is_some_and(|gaps| gaps.iter().any(|gap| gap == "ibex_cli")),
            "{uri}: {body}"
        );
        assert!(
            body["recentDiagnostics"]
                .as_array()
                .is_some_and(|diagnostics| diagnostics
                    .iter()
                    .all(|diagnostic| { diagnostic["code"] != "SNAPBACK_IBEX_CLI_UNAVAILABLE" })),
            "{uri}: {body}"
        );
    }
}

/// @ref LLP 0057#concurrency-locks-and-linearization — the multiplexed reset
/// projection observes the same post-commit mailbox boundary as its direct
/// route; a negative host-op envelope is not a committed reset.
#[tokio::test]
async fn host_ops_app_reset_clears_mailbox_only_for_a_success_envelope() {
    let (router, _, provider) = auth_http_fixture_with_provider(PolicyAuthMode::Sessions);
    let committed_challenge = request_captured_challenge(&router, "host-commit@example.com").await;
    let committed = router
        .clone()
        .oneshot(auth_http_request(
            "POST",
            "/_snapback/api/host-ops",
            serde_json::to_vec(&serde_json::json!({"operation": "app.reset"})).unwrap(),
            true,
            Some("auth-http-admin"),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(committed.status(), StatusCode::OK);
    assert_eq!(response_json(committed).await["ok"], true);
    assert_eq!(
        provider
            .mailbox_entry(&committed_challenge)
            .await
            .unwrap_err()
            .diagnostic()
            .code,
        "SNAPBACK_AUTH_MAILBOX_ENTRY_NOT_FOUND"
    );

    let rejected_challenge = request_captured_challenge(&router, "host-reject@example.com").await;
    let rejected = router
        .clone()
        .oneshot(auth_http_request(
            "POST",
            "/_snapback/api/host-ops",
            serde_json::to_vec(&serde_json::json!({
                "operation": "app.reset",
                "seed": {"tables": {"missing_table": [{}]}}
            }))
            .unwrap(),
            true,
            Some("auth-http-admin"),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(rejected.status(), StatusCode::OK);
    assert_eq!(response_json(rejected).await["ok"], false);
    assert_eq!(
        provider
            .mailbox_entry(&rejected_challenge)
            .await
            .expect("negative host-op envelope preserves capture plaintext")
            .challenge_id,
        rejected_challenge
    );
}

#[tokio::test]
async fn unknown_host_operation_middleware_does_not_echo_caller_bytes() {
    const SENTINEL: &str = "sbs_HTTP_DIAGNOSTIC_SMUGGLING_SENTINEL";
    let (router, _) = auth_http_fixture(PolicyAuthMode::Sessions);
    let response = router
        .oneshot(auth_http_request(
            "POST",
            "/_snapback/api/host-ops",
            serde_json::to_vec(&serde_json::json!({ "operation": SENTINEL })).unwrap(),
            true,
            Some("auth-http-admin"),
            None,
        ))
        .await
        .unwrap();
    let payload = response_json(response).await;
    let serialized = serde_json::to_string(&payload).unwrap();
    assert_eq!(payload["diagnostic"]["code"], "SNAPBACK_HOST_OP_UNKNOWN");
    assert_eq!(
        payload["diagnostic"]["details"]["operation"],
        "unrecognized"
    );
    assert!(!serialized.contains(SENTINEL), "{serialized}");
}

/// @ref LLP 0162#3-safe-current-head-forks — lifecycle dispatch is reachable
///   only after the production host carrier resolves AdminWrite authority;
///   an unauthenticated request never reaches the branch dispatcher.
#[tokio::test]
async fn managed_branch_host_operations_are_admin_write_before_dispatch() {
    let (router, _) = auth_http_fixture(PolicyAuthMode::Sessions);
    let cases = [
        (
            "branch.create.v1",
            json!({
                "schemaVersion": 1,
                "allowedFunctions": ["safeAction"],
                "ttlMs": 60_000
            }),
        ),
        (
            "branch.execute.v1",
            json!({
                "schemaVersion": 1,
                "branchId": "branch-v1:test",
                "function": "safeAction",
                "args": {}
            }),
        ),
        ("branch.list.v1", json!({"schemaVersion": 1})),
        ("branch.reap.v1", json!({"schemaVersion": 1})),
        (
            "branch.inspect.v1",
            json!({"schemaVersion": 1, "branchId": "branch-v1:test"}),
        ),
        (
            "branch.drop.v1",
            json!({"schemaVersion": 1, "branchId": "branch-v1:test"}),
        ),
    ];
    for (operation, input) in cases {
        let spec = super::host_ops_operation_spec(operation, None, false)
            .unwrap_or_else(|| panic!("registered branch operation {operation}"));
        assert_eq!(spec.class, RouteClass::SystemApi, "{operation}");
        assert_eq!(spec.path_policy, RoutePolicy::AdminWrite, "{operation}");
        assert_eq!(
            spec.credential_resolution,
            super::CredentialResolution::AdminCredential,
            "{operation}"
        );
        assert_eq!(
            spec.invocation_authority,
            super::InvocationAuthority::Operator,
            "{operation}"
        );
        assert_eq!(
            spec.transport,
            super::OperationTransport::HostOps,
            "{operation}"
        );

        let response = router
            .clone()
            .oneshot(auth_http_request(
                "POST",
                "/_snapback/api/host-ops",
                serde_json::to_vec(&json!({
                    "operation": operation,
                    "input": input,
                }))
                .unwrap(),
                true,
                None,
                None,
            ))
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            StatusCode::UNAUTHORIZED,
            "{operation} must refuse before dispatch"
        );
    }
}

/// @ref LLP 0024#http-projection — the pinned-but-unbuilt operations and
/// the CLI-owned `host.*` verbs are registered: an authenticated request
/// reaches the honest `SNAPBACK_HOST_OP_UNIMPLEMENTED` /
/// `SNAPBACK_HOST_OP_CLI_ONLY` envelope over HTTP, while unauthenticated
/// and truly unknown requests keep failing closed at the AdminWrite gate.
#[tokio::test]
async fn pinned_unbuilt_and_cli_only_host_operations_return_honest_envelopes() {
    let (router, _) = auth_http_fixture(PolicyAuthMode::Dev);
    let host_op = |body: serde_json::Value, admin: Option<&str>| {
        auth_http_request(
            "POST",
            "/_snapback/api/host-ops",
            serde_json::to_vec(&body).unwrap(),
            true,
            admin,
            None,
        )
    };

    for operation in ["acceptance.run", "schema.reload", "functions.reload"] {
        let response = router
            .clone()
            .oneshot(host_op(
                json!({ "operation": operation }),
                Some("auth-http-admin"),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK, "{operation}");
        let payload = response_json(response).await;
        assert_eq!(payload["resultKind"], "hostOpsResult", "{payload}");
        assert_eq!(payload["operation"], operation);
        assert_eq!(payload["ok"], false);
        assert_eq!(
            payload["diagnostics"][0]["code"],
            "SNAPBACK_HOST_OP_UNIMPLEMENTED"
        );
        assert_eq!(payload["diagnostics"][0]["subsystem"], "host-ops");
        assert_eq!(payload["diagnostics"][0]["details"]["operation"], operation);
        assert_eq!(payload["authority"]["mode"], "none");
    }

    let restart = router
        .clone()
        .oneshot(host_op(
            json!({ "operation": "host.restart" }),
            Some("auth-http-admin"),
        ))
        .await
        .unwrap();
    assert_eq!(restart.status(), StatusCode::OK);
    let restart = response_json(restart).await;
    assert_eq!(restart["ok"], false);
    assert_eq!(
        restart["diagnostics"][0]["code"],
        "SNAPBACK_HOST_OP_CLI_ONLY"
    );
    assert_eq!(
        restart["diagnostics"][0]["details"]["operation"],
        "host.restart"
    );

    // Authentication precedes the envelope builder: no honest envelope
    // (and no operation echo) for an unauthenticated caller.
    let unauthenticated = router
        .clone()
        .oneshot(host_op(json!({ "operation": "acceptance.run" }), None))
        .await
        .unwrap();
    assert_eq!(unauthenticated.status(), StatusCode::UNAUTHORIZED);

    // Truly unknown operations stay unregistered and fail closed at the
    // AdminWrite gate: authentication first, then the pre-dispatch
    // unknown refusal, never a 200 envelope.
    let unknown_unauthenticated = router
        .clone()
        .oneshot(host_op(json!({ "operation": "app.nonsense" }), None))
        .await
        .unwrap();
    assert_eq!(unknown_unauthenticated.status(), StatusCode::UNAUTHORIZED);
    let unknown = router
        .clone()
        .oneshot(host_op(
            json!({ "operation": "app.nonsense" }),
            Some("auth-http-admin"),
        ))
        .await
        .unwrap();
    assert_ne!(unknown.status(), StatusCode::OK);
    assert_eq!(
        response_json(unknown).await["diagnostic"]["code"],
        "SNAPBACK_HOST_OP_UNKNOWN"
    );

    // Deliberate: pinned-unbuilt requests now reach the handler, but the
    // LLP 0042 ring records function runs and artifact loads only, so the
    // refused verbs above leave `recentInvocations` empty.
    let inspect = router
        .oneshot(host_op(
            json!({ "operation": "app.inspect" }),
            Some("auth-http-admin"),
        ))
        .await
        .unwrap();
    let inspect = response_json(inspect).await;
    assert_eq!(inspect["ok"], true, "{inspect}");
    assert_eq!(inspect["data"]["recentInvocations"], json!([]), "{inspect}");
}

/// @ref LLP 0042#diagnostics-reading--an-appinspect-extension-not-a-new-operation —
/// function runs and artifact loads land in the process-wide bounded ring
/// and `app.inspect` projects it as `data.recentInvocations`, most recent
/// first, with the failing diagnostic code as each entry's outcome.
#[tokio::test]
async fn host_ops_inspect_projects_recent_invocations_ring() {
    let (state, _) = auth_runtime_fixture(PolicyAuthMode::Dev);
    let router = app(state.clone());
    let host_op = |body: serde_json::Value| {
        auth_http_request(
            "POST",
            "/_snapback/api/host-ops",
            serde_json::to_vec(&body).unwrap(),
            true,
            Some("auth-http-admin"),
            None,
        )
    };

    // Exercise the recording wrapper directly without a middleware-prepared
    // authority. This is the host-op core's missing-authority refusal, not an
    // HTTP authentication failure before the wrapper can observe it.
    let mut missing_authority_headers = HeaderMap::new();
    missing_authority_headers.insert(
        HeaderName::from_static("x-snapback-admin-token"),
        HeaderValue::from_static("auth-http-admin"),
    );
    let missing_authority_request = serde_json::from_value(json!({
        "operation": "function.run",
        "function": "missing-authority",
    }))
    .expect("missing-authority host-op request");
    let Json(missing_authority) = super::host_ops_handler(
        State(state.clone()),
        Some(test_route_admission(&state)),
        None,
        None,
        missing_authority_headers,
        Json(missing_authority_request),
    )
    .await
    .expect("recorded missing-authority refusal");
    assert_eq!(missing_authority.ok, false);
    assert_eq!(
        missing_authority.diagnostics[0].code,
        "SNAPBACK_AUTH_POLICY_UNAVAILABLE"
    );

    let load = router
        .clone()
        .oneshot(host_op(json!({ "operation": "functions.load" })))
        .await
        .expect("recorded functions.load refusal");
    assert_eq!(load.status(), StatusCode::OK);
    assert_eq!(response_json(load).await["ok"], false);

    let missing_function = router
        .clone()
        .oneshot(host_op(json!({ "operation": "function.run" })))
        .await
        .expect("recorded missing-function-id refusal");
    assert_eq!(missing_function.status(), StatusCode::OK);
    let missing_function = response_json(missing_function).await;
    assert_eq!(missing_function["ok"], false);
    assert_eq!(
        missing_function["diagnostics"][0]["code"],
        "SNAPBACK_HOST_OP_INPUT_MISSING"
    );

    let mut run_request = host_op(json!({ "operation": "function.run", "function": "missing" }));
    // @ref LLP 0262#rulings-author-2026-08-16 — OQ2 keeps the capability off
    // admin-token-gated host operations; even a malformed app-plane carrier
    // cannot alter `function.run`'s existing authority result.
    run_request.headers_mut().insert(
        crate::dev_identity::DEV_IDENTITY_CAPABILITY_HEADER,
        HeaderValue::from_static("sbdev_present-but-wrong"),
    );
    let unknown_function = router
        .clone()
        .oneshot(run_request)
        .await
        .expect("recorded unknown-function refusal");
    assert_eq!(unknown_function.status(), StatusCode::OK);
    let unknown_function = response_json(unknown_function).await;
    assert_eq!(unknown_function["ok"], false);
    let run_code = unknown_function["diagnostics"][0]["code"]
        .as_str()
        .expect("failing function.run diagnostic code")
        .to_owned();

    let inspect = router
        .oneshot(host_op(json!({ "operation": "app.inspect" })))
        .await
        .expect("inspect with recent invocations");
    assert_eq!(inspect.status(), StatusCode::OK);
    let inspect = response_json(inspect).await;
    assert_eq!(inspect["ok"], true, "{inspect}");
    let recent = inspect["data"]["recentInvocations"]
        .as_array()
        .expect("recentInvocations array");
    assert_eq!(recent.len(), 4, "{inspect}");
    assert_eq!(recent[0]["operation"], "function.run");
    assert_eq!(recent[0]["functionId"], "missing");
    assert_eq!(recent[0]["outcome"], run_code);
    assert_eq!(recent[1]["operation"], "function.run");
    assert_eq!(recent[1]["outcome"], "SNAPBACK_HOST_OP_INPUT_MISSING");
    assert_eq!(recent[2]["operation"], "functions.load");
    assert_eq!(recent[2]["outcome"], "SNAPBACK_HOST_OP_INPUT_MISSING");
    assert_eq!(recent[3]["operation"], "function.run");
    assert_eq!(recent[3]["functionId"], "missing-authority");
    assert_eq!(recent[3]["outcome"], "SNAPBACK_AUTH_POLICY_UNAVAILABLE");
    for entry in recent {
        assert!(
            entry["startedAt"]
                .as_str()
                .is_some_and(|at| at.ends_with('Z'))
        );
        assert!(entry["durationMs"].is_u64());
        assert!(entry["diagnostics"].is_array());
        assert_ne!(entry["operation"], "app.inspect");
    }
    for entry in recent
        .iter()
        .filter(|entry| entry["operation"] == "function.run")
    {
        assert_eq!(
            entry["conformance"],
            json!({
                "missingReads": [],
                "missingWrites": [],
                "extraReads": [],
                "extraWrites": [],
                "readProvenance": "incomplete",
                "writeProvenance": "incomplete",
            }),
            "every recorded function.run refusal carries the complete D1 shape: {entry}"
        );
    }
}

/// @ref LLP 0146#d1-declarationobservation-conformance — direct app-data
/// query and mutation paths retain their authoritative captured dependency
/// evidence in the same bounded diagnostic ring, while every query, mutation,
/// and action refusal emits the unconditional six-field incomplete report.
/// @ref LLP 0042#diagnostics-reading--an-appinspect-extension-not-a-new-operation —
/// the existing `app.inspect` projection remains the one public ring reader.
#[tokio::test]
async fn app_data_invocations_join_recent_invocations_ring() {
    let state = sessions_activation_server_fixture_async().await;
    let credential = mint_test_credential(&state, "recent-ring@example.test").await;
    let bearer = credential["token"].as_str().expect("session bearer");
    let recent_ring = state.recent_invocations.clone();
    let router = app(state);

    let query = router
        .clone()
        .oneshot(session_auth_http_request(
            "/query/listItems",
            br#"{"args":{}}"#.to_vec(),
            bearer,
        ))
        .await
        .expect("recorded app-data query");
    assert_eq!(query.status(), StatusCode::OK);

    let mutation = router
        .clone()
        .oneshot(session_auth_http_request(
            "/mutation/queuedWrite",
            br#"{"args":{"value":"recent-ring"}}"#.to_vec(),
            bearer,
        ))
        .await
        .expect("recorded app-data mutation");
    assert_eq!(mutation.status(), StatusCode::OK);

    let action = router
        .clone()
        .oneshot(session_auth_http_request(
            "/action/missingAction",
            br#"{"args":{}}"#.to_vec(),
            bearer,
        ))
        .await
        .expect("recorded app-data action refusal");
    assert_ne!(action.status(), StatusCode::OK);

    let missing_query = router
        .clone()
        .oneshot(session_auth_http_request(
            "/query/missingQuery",
            br#"{"args":{}}"#.to_vec(),
            bearer,
        ))
        .await
        .expect("recorded app-data query refusal");
    assert_ne!(missing_query.status(), StatusCode::OK);

    let missing_mutation = router
        .clone()
        .oneshot(session_auth_http_request(
            "/mutation/missingMutation",
            br#"{"args":{}}"#.to_vec(),
            bearer,
        ))
        .await
        .expect("recorded app-data mutation refusal");
    assert_ne!(missing_mutation.status(), StatusCode::OK);

    let recent = recent_ring.snapshot();
    assert_eq!(recent.len(), 5, "success and refusal paths enter the ring");
    for (entry, operation, function) in [
        (&recent[0], "mutation", "missingMutation"),
        (&recent[1], "query", "missingQuery"),
        (&recent[2], "action", "missingAction"),
    ] {
        assert_eq!(entry.operation, operation);
        assert_eq!(entry.function_id.as_deref(), Some(function));
        assert_eq!(
            entry.conformance.as_ref().expect("failure conformance"),
            &json!({
                "missingReads": [],
                "missingWrites": [],
                "extraReads": [],
                "extraWrites": [],
                "readProvenance": "incomplete",
                "writeProvenance": "incomplete",
            })
        );
    }
    assert_eq!(recent[3].operation, "mutation");
    assert_eq!(recent[3].function_id.as_deref(), Some("queuedWrite"));
    let mutation_conformance = recent[3]
        .conformance
        .as_ref()
        .expect("mutation conformance");
    assert_eq!(mutation_conformance["readProvenance"], "complete");
    assert_eq!(mutation_conformance["writeProvenance"], "complete");
    assert_eq!(recent[4].operation, "query");
    assert_eq!(recent[4].function_id.as_deref(), Some("listItems"));
    let query_conformance = recent[4].conformance.as_ref().expect("query conformance");
    assert_eq!(query_conformance["readProvenance"], "complete");
    assert_eq!(query_conformance["writeProvenance"], "complete");
}

#[tokio::test]
async fn public_health_revalidates_provider_readiness_without_leaking_keyring_details() {
    let directory = tempfile::tempdir().unwrap();
    let database_path = directory.path().join("health.sqlite3");
    let mut snapback = LocalSnapback::open(&database_path).unwrap();
    let keyring = Arc::new(AuthKeyringStore::file_for_database(&database_path));
    snapback
        .remainder_auth_fixture()
        .activate_catalog(keyring.as_ref(), super::now_millis(), &OsRandom)
        .unwrap();
    let provider = Arc::new(AuthProvider::new(AuthProviderProfile::Test, keyring).unwrap());
    let keyring_path = AuthKeyringStore::keyring_path(&database_path);
    let retained = std::fs::read(&keyring_path).unwrap();
    let router = app(
        test_app_state_from_snapback(snapback, bound_loopback_context())
            .try_with_auth_provider(provider)
            .expect("auth provider app state"),
    );

    let available = router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response_json(available).await["authProvider"], "available");

    std::fs::remove_file(&keyring_path).unwrap();
    let unavailable = router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let unavailable = response_json(unavailable).await;
    assert_eq!(unavailable["authProvider"], "unavailable");
    let serialized = serde_json::to_string(&unavailable).unwrap();
    assert!(!serialized.contains("keyring"));
    assert!(!serialized.contains(database_path.to_string_lossy().as_ref()));

    crate::secure_file::write_new_owner_only(&keyring_path, &retained).unwrap();
    let repaired = router
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response_json(repaired).await["authProvider"], "available");
}

#[tokio::test]
async fn password_public_invalid_refusal_is_uniform_and_admin_unlock_clears_early_lockout() {
    const HTTP_TIMING_ENVELOPE: Duration = Duration::from_millis(250);
    let state = password_sessions_activation_server_fixture_async().await;
    let provider = state.auth_provider.clone().expect("password provider");
    let router = app(state.clone());
    let password = "uniform-password-route-123!";
    for email in ["wrong-password@example.com", "locked-password@example.com"] {
        let response = router
            .clone()
            .oneshot(password_auth_http_request(
                "/auth/password/signup",
                json!({ "email": email, "password": password }),
            ))
            .await
            .expect("uniform-refusal signup");
        assert_eq!(response.status(), StatusCode::OK);
    }
    let now_ms = provider.now_ms();
    with_snapback(&state.snapback, move |snapback| {
        snapback
            .remainder_auth_fixture()
            .insert_password_attempt_for_test(
                "locked-password@example.com",
                now_ms,
                99,
                Some(now_ms + 60_000),
            )
    })
    .await
    .expect("install early-unlock fixture");

    let attempts = [
        ("wrong-password@example.com", "definitely-wrong-password!"),
        ("missing-password@example.com", "definitely-wrong-password!"),
        ("locked-password@example.com", password),
    ];
    let mut observations = Vec::new();
    for (email, presented) in attempts {
        let started = Instant::now();
        let response = router
            .clone()
            .oneshot(password_auth_http_request(
                "/auth/password/signin",
                json!({ "email": email, "password": presented }),
            ))
            .await
            .expect("uniform password refusal");
        let elapsed = started.elapsed();
        let status = response.status();
        let cache = response.headers()[header::CACHE_CONTROL].clone();
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("uniform refusal bytes");
        observations.push((status, cache, body, elapsed));
    }
    let first = &observations[0];
    for observation in &observations[1..] {
        assert_eq!(observation.0, first.0);
        assert_eq!(observation.1, first.1);
        assert_eq!(observation.2, first.2);
        assert!(
            observation.3.abs_diff(first.3) <= HTTP_TIMING_ENVELOPE,
            "public password refusals exceeded the declared {HTTP_TIMING_ENVELOPE:?} envelope: {:?}",
            observations.iter().map(|entry| entry.3).collect::<Vec<_>>()
        );
    }
    assert_eq!(first.0, StatusCode::UNAUTHORIZED);
    assert_eq!(first.1, "no-store, private");
    let body: Value = serde_json::from_slice(&first.2).unwrap();
    assert_eq!(
        body["diagnostic"]["code"],
        "SNAPBACK_AUTH_CREDENTIAL_INVALID"
    );
    assert!(!body.to_string().contains("locked"));

    let projection = router
        .clone()
        .oneshot(auth_http_request(
            "POST",
            "/_snapback/api/auth/password/attempt",
            serde_json::to_vec(&json!({ "email": "locked-password@example.com" })).unwrap(),
            true,
            Some("auth-http-admin"),
            None,
        ))
        .await
        .expect("admin password-attempt projection");
    assert_eq!(projection.status(), StatusCode::OK);
    let projection = response_json(projection).await;
    assert_eq!(projection["failureThreshold"], 10);
    assert_eq!(projection["attempt"]["failedCount"], 99);
    assert_eq!(projection["attempt"]["locked"], true);
    assert_eq!(
        projection["attempt"]["canonicalIdentifier"],
        "locked-password@example.com"
    );

    let unlock = router
        .clone()
        .oneshot(auth_http_request(
            "POST",
            "/_snapback/api/auth/password/unlock",
            serde_json::to_vec(&json!({ "email": "locked-password@example.com" })).unwrap(),
            true,
            Some("auth-http-admin"),
            None,
        ))
        .await
        .expect("admin password unlock");
    assert_eq!(unlock.status(), StatusCode::OK);
    assert_eq!(response_json(unlock).await["unlocked"], true);
    let signin = router
        .oneshot(password_auth_http_request(
            "/auth/password/signin",
            json!({ "email": "locked-password@example.com", "password": password }),
        ))
        .await
        .expect("signin after admin unlock");
    assert_eq!(signin.status(), StatusCode::OK);
}

#[tokio::test]
async fn production_operator_retirement_requires_process_bound_agent_destroy_capability() {
    let mut state = sessions_activation_server_fixture_with_integrations_async().await;
    Arc::make_mut(&mut state.server).profile = ServerProfile::Prod;
    let (registry, operator) =
        crate::admin_agent_destroy::AgentDestroyCapabilityRegistry::generate(
            "integration-retire-http".to_owned(),
            &OsRandom,
        )
        .unwrap();
    let destroy_capability = operator.expose_secret().to_owned();
    let (_, unrelated) = crate::admin_agent_destroy::AgentDestroyCapabilityRegistry::generate(
        "integration-retire-http".to_owned(),
        &OsRandom,
    )
    .unwrap();
    let unrelated = unrelated.expose_secret().to_owned();
    state = state.with_agent_destroy_capabilities(registry);
    let router = app(state);
    let request = |capability: Option<&str>| {
        let mut builder = Request::builder()
            .method("POST")
            .uri("/_snapback/api/auth/integrations/not-an-integration/retire")
            .header("x-snapback-admin-token", "auth-http-admin");
        if let Some(capability) = capability {
            builder = builder.header(
                crate::admin_agent_destroy::AGENT_DESTROY_CAPABILITY_HEADER,
                capability,
            );
        }
        builder.body(Body::empty()).unwrap()
    };
    let missing = router.clone().oneshot(request(None)).await.unwrap();
    assert_eq!(missing.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        response_json(missing).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_AGENT_DESTROY_CAPABILITY_REQUIRED"
    );
    let wrong = router
        .clone()
        .oneshot(request(Some(&unrelated)))
        .await
        .unwrap();
    assert_eq!(wrong.status(), StatusCode::FORBIDDEN);
    let admitted = router
        .oneshot(request(Some(&destroy_capability)))
        .await
        .unwrap();
    assert_eq!(admitted.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        response_json(admitted).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_INTEGRATION_UNKNOWN"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn background_scheduler_allows_overlap_but_no_overlap_skips() {
    let dispatcher = Arc::new(Semaphore::new(4));
    let allow = slow_cron_state(CronOverlapPolicy::Allow);
    assert_eq!(
        dispatch_cron_tick_background(&allow, &dispatcher, 4, 60_000)
            .await
            .unwrap(),
        1
    );
    wait_for_dispatcher_permits(&dispatcher, 3).await;
    assert_eq!(
        dispatch_cron_tick_background(&allow, &dispatcher, 4, 120_000)
            .await
            .unwrap(),
        1,
        "the next automatic Allow slot must dispatch before the prior run finishes"
    );
    wait_for_dispatcher_permits(&dispatcher, 2).await;
    wait_for_dispatcher_permits(&dispatcher, 4).await;

    let no_overlap = slow_cron_state(CronOverlapPolicy::NoOverlap);
    assert_eq!(
        dispatch_cron_tick_background(&no_overlap, &dispatcher, 4, 60_000)
            .await
            .unwrap(),
        1
    );
    wait_for_dispatcher_permits(&dispatcher, 3).await;
    assert_eq!(
        dispatch_cron_tick_background(&no_overlap, &dispatcher, 4, 120_000)
            .await
            .unwrap(),
        0,
        "NoOverlap must skip while its prior automatic run is active"
    );
    let inspect = super::inspect_snapback(&no_overlap).await.unwrap();
    assert!(inspect.cron.recent_runs.iter().any(|run| {
        run.outcome == CronRunOutcome::Skipped
            && run
                .diagnostic
                .as_ref()
                .is_some_and(|diagnostic| diagnostic.code == "SNAPBACK_CRON_RUN_SKIPPED_OVERLAP")
    }));
    wait_for_dispatcher_permits(&dispatcher, 4).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn disabled_scheduler_claims_nothing_while_manual_ticks_still_run() {
    let state = armed_due_cron_state();
    // The job is armed and already due (seeded most-recent-slot nominal,
    // jitter disabled): an enabled scheduler's first 1 s tick would
    // claim it.
    let inspect = super::inspect_snapback(&state).await.unwrap();
    let job = inspect
        .cron
        .jobs
        .iter()
        .find(|job| job.name == "inert")
        .expect("definitions still load and inspect under the disable switch");
    assert_eq!(
        job.activation_state,
        crate::cron::CronActivationState::Armed
    );
    assert!(
        job.next_due_at_ms
            .is_some_and(|due| due <= super::now_millis()),
        "fixture job must be past due: {:?}",
        job.next_due_at_ms
    );

    let scheduler = super::spawn_cron_scheduler(state.clone(), true);
    tokio::time::sleep(Duration::from_millis(CRON_DISABLE_OBSERVATION_MS)).await;
    let inspect = super::inspect_snapback(&state).await.unwrap();
    assert!(
        inspect.cron.recent_runs.is_empty(),
        "no autonomous run may commit under the disable switch: {:?}",
        inspect.cron.recent_runs
    );
    let job = inspect
        .cron
        .jobs
        .iter()
        .find(|job| job.name == "inert")
        .expect("job stays inspectable");
    assert_eq!(job.last_run_at_ms, None);
    assert_eq!(job.in_flight_run_id, None);

    // The admin manual tick keeps working: it claims and executes the due
    // run deterministically.
    let runs = super::cron_tick_detached(&state, super::now_millis())
        .await
        .unwrap();
    assert_eq!(runs.len(), 1, "manual tick must claim the due job");
    assert_eq!(runs[0].outcome, CronRunOutcome::Succeeded);
    let inspect = super::inspect_snapback(&state).await.unwrap();
    assert_eq!(inspect.cron.recent_runs.len(), 1);
    scheduler.abort();
}

/// Control for the disabled test above: an enabled scheduler commits the
/// same fixture's armed due run inside the observation window, so the
/// disabled test's empty ledger cannot pass vacuously.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn enabled_scheduler_fires_the_armed_due_job_within_the_disable_window() {
    let state = armed_due_cron_state();
    let scheduler = super::spawn_cron_scheduler(state.clone(), false);
    tokio::time::timeout(
            Duration::from_millis(CRON_DISABLE_OBSERVATION_MS),
            async {
                loop {
                    let inspect = super::inspect_snapback(&state).await.unwrap();
                    if !inspect.cron.recent_runs.is_empty() {
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(50)).await;
                }
            },
        )
        .await
        .expect("an enabled scheduler must fire the armed due job within the window the disabled test holds open");
    scheduler.abort();
}

/// LLP 0070's first acceptance bullet, verbatim CV-9 exit criterion: a
/// rolled-back mutation provably schedules nothing — and the rejected
/// receipt carries no enqueue facts (the inspectable absence).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn rolled_back_mutation_schedules_nothing() {
    let state = tokio::task::spawn_blocking(|| {
        let _sanction = crate::exec_guard::BlockingSanction::acquire();
        jobs_test_state()
    })
    .await
    .expect("fixture builds off the async worker");
    let (result, receipt) = with_snapback(&state, |snapback| {
        snapback.invoke_mutation_recording(
            "scheduleEvent",
            HandlerInput {
                args: serde_json::json!({ "name": "boom", "delayMs": 0, "fail": true }),
                ..HandlerInput::default()
            },
        )
    })
    .await;
    assert!(result.is_err(), "the failing handler must reject");
    let receipt_value = receipt.into_value();
    assert_eq!(receipt_value["outcome"], "rejected");
    assert!(
        receipt_value.get("enqueues").is_none(),
        "a rejected mutation receipt never carries enqueue facts: {receipt_value}"
    );
    let inspect = with_snapback(&state, |snapback| snapback.jobs_inspect(50))
        .await
        .expect("jobs inspect");
    assert_eq!(
        inspect["jobs"].as_array().map(Vec::len),
        Some(0),
        "rollback must leave no job rows: {inspect}"
    );
    // Nothing is claimable at any clock: the forced drain over an empty
    // ledger returns no receipts.
    let drained = super::jobs_drain_detached(
        &state,
        u64::MAX >> 12,
        1,
        crate::local::DiagnosticBoundary::Attached,
    )
    .await
    .expect("drain runs");
    assert!(drained.is_empty(), "nothing may drain after rollback");
}

/// CV-9's second exit criterion: an injected-clock forced drain claims due
/// one-off jobs — exactly once per attempt fence — executes the admitted
/// action callee (which applies its durable effect through a nested
/// mutation), and leaves receipts in the job/attempt ledger. No sleeps:
/// due-ness is a pure function of the supplied clock.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn forced_drain_claims_due_jobs_exactly_once_with_receipts() {
    let state = tokio::task::spawn_blocking(|| {
        let _sanction = crate::exec_guard::BlockingSanction::acquire();
        jobs_test_state()
    })
    .await
    .expect("fixture builds off the async worker");
    let (result, receipt) = with_snapback(&state, |snapback| {
        snapback.invoke_mutation_recording(
            "scheduleEvent",
            HandlerInput {
                args: serde_json::json!({ "name": "drill", "delayMs": 60_000 }),
                ..HandlerInput::default()
            },
        )
    })
    .await;
    let output = result.expect("enqueueing mutation commits");
    let job_id = output.result["jobId"]
        .as_str()
        .expect("enqueue returns the job id")
        .to_owned();
    let available_at = output.result["availableAtMs"]
        .as_u64()
        .expect("enqueue returns availableAtMs");
    assert_eq!(output.result["deduplicated"], serde_json::json!(false));

    // The confirmed mutation receipt embeds its enqueue association
    // (0127 decision 7's mutation-side half).
    let receipt_value = receipt.into_value();
    assert_eq!(receipt_value["outcome"], "confirmed");
    assert_eq!(
        receipt_value["enqueues"][0]["jobId"],
        serde_json::json!(job_id)
    );
    assert_eq!(receipt_value["enqueues"][0]["action"], "notify");
    assert_eq!(
        receipt_value["enqueues"][0]["availableAtMs"],
        serde_json::json!(available_at)
    );
    let receipt_mutation_id = receipt_value["mutationId"]
        .as_str()
        .expect("receipt mutation id")
        .to_owned();
    let receipt_snapshot_version = receipt_value["snapshotVersion"]
        .as_u64()
        .expect("confirmed receipt snapshot version");

    // The job row carries the producer association (the job-side half).
    let shown = with_snapback(&state, {
        let job_id = job_id.clone();
        move |snapback| snapback.job_show(&job_id)
    })
    .await
    .expect("job show")
    .expect("job exists");
    assert_eq!(shown["job"]["state"], "pending");
    assert_eq!(
        shown["job"]["producerMutationId"],
        serde_json::json!(receipt_mutation_id)
    );
    assert_eq!(
        shown["job"]["producerSnapshotVersion"],
        serde_json::json!(receipt_snapshot_version)
    );
    assert_eq!(shown["job"]["producerFunction"], "scheduleEvent");

    // Before the delay elapses (injected clock), nothing is due.
    let early = super::jobs_drain_detached(
        &state,
        available_at - 1,
        1,
        crate::local::DiagnosticBoundary::Attached,
    )
    .await
    .expect("early drain");
    assert!(
        early.is_empty(),
        "the delayed job must not be claimable early"
    );

    // At the injected due clock, the forced drain claims and executes.
    let drained = super::jobs_drain_detached(
        &state,
        available_at,
        1,
        crate::local::DiagnosticBoundary::Attached,
    )
    .await
    .expect("due drain");
    assert_eq!(drained.len(), 1, "exactly the one due job is claimed");
    assert_eq!(drained[0].job_id, job_id);
    assert_eq!(drained[0].attempt, 1);
    assert_eq!(drained[0].fence, 1);
    assert_eq!(drained[0].disposition, "succeeded");

    // Exactly once per attempt fence: a second drain at the same clock
    // claims nothing.
    let again = super::jobs_drain_detached(
        &state,
        available_at,
        1,
        crate::local::DiagnosticBoundary::Attached,
    )
    .await
    .expect("repeat drain");
    assert!(again.is_empty(), "a settled job must not be re-claimed");

    // The action's nested mutation committed the durable effect.
    let events = with_snapback(&state, |snapback| snapback.scan_table("events", 10, 0))
        .await
        .expect("scan events");
    assert_eq!(events.total, 1, "the notify action's nested mutation lands");

    // Job + attempt receipts are present and shaped.
    let shown = with_snapback(&state, {
        let job_id = job_id.clone();
        move |snapback| snapback.job_show(&job_id)
    })
    .await
    .expect("job show")
    .expect("job exists");
    assert_eq!(shown["job"]["state"], "succeeded");
    assert_eq!(shown["job"]["attemptCount"], 1);
    let attempts = shown["attempts"].as_array().expect("attempt ledger");
    assert_eq!(attempts.len(), 1);
    assert_eq!(attempts[0]["attempt"], 1);
    assert_eq!(attempts[0]["fence"], 1);
    assert_eq!(attempts[0]["drive"], "forced-drain");
    assert_eq!(attempts[0]["outcome"], "succeeded");
    assert_eq!(attempts[0]["claimedAtMs"], serde_json::json!(available_at));
}

/// LLP 0131 acceptance 14's enqueue-side code target (replay lane 3;
/// issues/20260731-0131-implementation-divergences.md item 6): scheduled-
/// work admission validates the enqueued action's args against that
/// action's declared contract AT ENQUEUE TIME, inside the producing
/// mutation's transaction — a violating enqueue refuses the whole
/// mutation under `SNAPBACK_FUNCTION_ARGS_CONTRACT_VIOLATION` with no job
/// row and no partial write, while a contract-less callee preserves the
/// legacy (vacuously valid) behavior. Attempts then execute the retained
/// enqueue-validated bytes with no shape revalidation, and any successor
/// surface re-enters the same admission (its own fresh enqueue).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn enqueue_validates_callee_args_contract_transactionally() {
    use crate::manifest::{
        FieldManifest, FieldType, FunctionArgsContract, ResultObjectFieldContract,
        ResultValueContract, SchemaManifest, TableManifest, args_contract_hash,
    };
    let state =
        tokio::task::spawn_blocking(|| {
            let _sanction = crate::exec_guard::BlockingSanction::acquire();
            let mut snapback = LocalSnapback::memory().expect("jobs contract test state");
            snapback
                .apply_schema(SchemaManifest {
                    tables: vec![TableManifest {
                        name: "events".to_owned(),
                        fields: vec![FieldManifest {
                            name: "name".to_owned(),
                            field_type: FieldType::String,
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
                .expect("apply jobs contract schema");
            let contract = FunctionArgsContract {
                fields: vec![ResultObjectFieldContract {
                    name: "name".to_owned(),
                    required: true,
                    value: ResultValueContract::String { max_bytes: 256 },
                }],
            };
            let mut notify = FunctionDefinition::new(
                "notify",
                FunctionKind::Action,
                FunctionRuntime::IbexModule(IbexModule {
                    source: "globalThis.__snapbackHandlers = {\
                         async notify(ctx, args) { return null; } };"
                        .to_owned(),
                    export: "notify".to_owned(),
                }),
            );
            notify.args_contract_hash = Some(args_contract_hash(&contract).expect("contract hash"));
            notify.args_contract = Some(contract);
            notify
                .required_capabilities
                .push("args_contract_v1".to_owned());
            let notify_legacy = FunctionDefinition::new(
                "notifyLegacy",
                FunctionKind::Action,
                FunctionRuntime::IbexModule(IbexModule {
                    source: "globalThis.__snapbackHandlers = {\
                         async notifyLegacy(ctx, args) { return null; } };"
                        .to_owned(),
                    export: "notifyLegacy".to_owned(),
                }),
            );
            let manifest = FunctionManifest {
                functions: vec![
                    FunctionDefinition::new(
                        "scheduleAny",
                        FunctionKind::Mutation,
                        FunctionRuntime::IbexModule(IbexModule {
                            source: "globalThis.__snapbackHandlers = {\
                                 async scheduleAny(ctx, args) {\
                                   await ctx.db.insert('events', { name: 'pre-enqueue' });\
                                   return await ctx.jobs.enqueue(\
                                     args.action, args.payload, { delayMs: 60000 });\
                                 } };"
                                .to_owned(),
                            export: "scheduleAny".to_owned(),
                        }),
                    ),
                    notify,
                    notify_legacy,
                ],
                acknowledged_experimental_capabilities: vec!["args_contract_v1".to_owned()],
                ..FunctionManifest::default()
            };
            let diagnostics = snapback.load_functions(manifest);
            assert!(
                diagnostics.iter().all(|diagnostic| diagnostic.severity
                    != crate::diagnostic::DiagnosticSeverity::Error),
                "jobs contract fixture must install: {diagnostics:?}"
            );
            Arc::new(Mutex::new(snapback))
        })
        .await
        .expect("fixture builds off the async worker");

    // A violating enqueue refuses the WHOLE mutation transactionally:
    // the handler's earlier db.insert does not land, and no job exists.
    let (result, receipt) = with_snapback(&state, |snapback| {
        snapback.invoke_mutation_recording(
            "scheduleAny",
            HandlerInput {
                args: serde_json::json!({
                    "action": "notify",
                    "payload": { "name": 123 },
                }),
                ..HandlerInput::default()
            },
        )
    })
    .await;
    let error = result.expect_err("a contract-violating enqueue refuses the mutation");
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_FUNCTION_ARGS_CONTRACT_VIOLATION"
    );
    assert_eq!(error.diagnostic.details["path"], "/name");
    let receipt_value = receipt.into_value();
    assert_eq!(receipt_value["outcome"], "rejected");
    assert!(
        receipt_value.get("enqueues").is_none(),
        "a rejected mutation receipt never carries enqueue facts"
    );
    let events = with_snapback(&state, |snapback| snapback.scan_table("events", 10, 0))
        .await
        .expect("scan events");
    assert_eq!(events.total, 0, "no partial write survives the refusal");
    let inspect = with_snapback(&state, |snapback| snapback.jobs_inspect(50))
        .await
        .expect("jobs inspect");
    assert_eq!(
        inspect["jobs"].as_array().map(Vec::len),
        Some(0),
        "no job row survives the refusal: {inspect}"
    );

    // A conforming payload against the same contract commits.
    let conforming = with_snapback(&state, |snapback| {
        snapback.invoke_mutation(
            "scheduleAny",
            HandlerInput {
                args: serde_json::json!({
                    "action": "notify",
                    "payload": { "name": "ok" },
                }),
                ..HandlerInput::default()
            },
        )
    })
    .await
    .expect("conforming enqueue commits");
    assert!(conforming.result["jobId"].is_string());

    // A contract-less callee keeps the legacy behavior: any payload
    // enqueues (no invented refusal for pre-v2 apps).
    let legacy = with_snapback(&state, |snapback| {
        snapback.invoke_mutation(
            "scheduleAny",
            HandlerInput {
                args: serde_json::json!({
                    "action": "notifyLegacy",
                    "payload": { "anything": true, "nested": { "deep": [1, 2, 3] } },
                }),
                ..HandlerInput::default()
            },
        )
    })
    .await
    .expect("contract-less callee enqueues under legacy behavior");
    assert!(legacy.result["jobId"].is_string());
    let inspect = with_snapback(&state, |snapback| snapback.jobs_inspect(50))
        .await
        .expect("jobs inspect");
    assert_eq!(inspect["jobs"].as_array().map(Vec::len), Some(2));
}

macro_rules! watch_management_race_tests {
    ($logout_test:ident, $reservation_test:ident, $site:expr) => {
        #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
        async fn $logout_test() {
            watch_management_logout_wins($site).await;
        }

        #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
        async fn $reservation_test() {
            watch_management_reservation_wins($site).await;
        }
    };
}

watch_management_race_tests!(
    watch_delete_logout_wins_before_reservation,
    watch_delete_reservation_wins_before_logout,
    WatchManagementRaceSite::Delete
);

watch_management_race_tests!(
    watch_suspend_logout_wins_before_reservation,
    watch_suspend_reservation_wins_before_logout,
    WatchManagementRaceSite::Suspend
);

watch_management_race_tests!(
    watch_resume_logout_wins_before_reservation,
    watch_resume_reservation_wins_before_logout,
    WatchManagementRaceSite::Resume
);

watch_management_race_tests!(
    watch_renew_logout_wins_before_reservation,
    watch_renew_reservation_wins_before_logout,
    WatchManagementRaceSite::Renew
);

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn watch_renewal_samples_durable_timestamp_after_the_writer_wait() {
    let mut fixture = watch_management_race_fixture(WatchManagementRaceSite::Renew).await;
    let before = watch_management_facts(&fixture).await;
    let pause = install_test_finite_authority_pause(
        TestFiniteAuthorityPausePoint::AfterAuthorizedEffectReservation,
    );
    fixture
        .request
        .as_mut()
        .expect("watch renewal timestamp request")
        .headers_mut()
        .insert(
            HeaderName::from_static(TEST_FINITE_AUTHORITY_PAUSE_HEADER),
            HeaderValue::from_str(pause.id()).expect("watch renewal reservation pause header"),
        );
    let request = fixture
        .request
        .take()
        .expect("watch renewal timestamp request");
    let router = fixture.router.clone();
    let renewal = tokio::spawn(async move {
        router
            .oneshot(request)
            .await
            .expect("queued watch renewal response")
    });
    tokio::time::timeout(Duration::from_secs(5), pause.wait_until_reached())
        .await
        .expect("watch renewal reserves before waiting for Local");
    let writer = fixture.state.snapback.clone().lock_owned().await;
    pause.release().await;

    // Keep the request queued long enough that a submission-time sample is
    // observably stale, then record a lower bound immediately before Local
    // becomes available to the capsule transaction.
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(!renewal.is_finished());
    let writer_release_floor_ms = super::now_millis();
    drop(writer);

    let response = tokio::time::timeout(Duration::from_secs(5), renewal)
        .await
        .expect("queued watch renewal completes within its capsule budget")
        .expect("queued watch renewal task joins");
    assert_eq!(response.status(), StatusCode::OK);
    let after = watch_management_facts(&fixture).await;
    assert_watch_management_effect(WatchManagementRaceSite::Renew, &before, &after);
    assert!(
        after.watch.updated_at_ms >= writer_release_floor_ms,
        "renewal sampled {} before the writer was released at {}",
        after.watch.updated_at_ms,
        writer_release_floor_ms
    );
}

/// LLP 0031 §Enforcement — the retired/moved privileged operations must not
/// reappear at the root in the declared registry.
#[test]
fn s1_retired_root_operations_are_absent_from_the_registry() {
    let registry = route_registry();
    for banned in [
        "/admin/schema",
        "/admin/functions",
        "/admin/reset",
        "/admin/seed",
        "/ephemeral/collections",
        "/ephemeral/cleanup",
        "/connections/{connection_id}/disconnect",
    ] {
        assert!(
            !registry.iter().any(|route| route.path == banned),
            "{banned} must not be a registered root route after migration"
        );
    }
}

#[test]
fn approval_item_is_never_applied_as_a_machine_repair() {
    let snapback = crate::local::LocalSnapback::memory().expect("memory remediation fixture");
    let surfaces = remediation_served_surfaces(&snapback);
    let error = crate::remediation::apply_remediation(
        &surfaces,
        crate::remediation::RemediationApplyInputV1 {
            schema_version: crate::remediation::REMEDIATION_APPLY_SCHEMA_VERSION.to_owned(),
            artifact_hash: "sha256:0123456789abcdef".to_owned(),
            item: crate::remediation::RemediationItemV1::request_grant(
                "function:query:fn_list_todos",
            ),
        },
    )
    .expect_err("approval remediation cannot be machine-applied");
    assert_eq!(
        error.diagnostic.code,
        crate::remediation::REMEDIATION_APPROVAL_REQUIRED_CODE
    );
}

#[test]
fn stale_apply_has_no_durable_effect() {
    let snapback = crate::local::LocalSnapback::memory().expect("memory remediation fixture");
    let before = snapback.durable_version().expect("durable version before");
    let item = crate::remediation::RemediationItemV1::identifier_replacement(
        crate::remediation::RemediationKindV1::FixTypo,
        "sha256:aaaaaaaaaaaaaaaa",
        "hostOperation",
        None,
        "app.inspect",
    );
    let surfaces = remediation_served_surfaces(&snapback);
    let error = crate::remediation::apply_remediation(
        &surfaces,
        crate::remediation::RemediationApplyInputV1 {
            schema_version: crate::remediation::REMEDIATION_APPLY_SCHEMA_VERSION.to_owned(),
            artifact_hash: "sha256:aaaaaaaaaaaaaaaa".to_owned(),
            item,
        },
    )
    .expect_err("stale artifact must refuse");
    assert_eq!(
        error.diagnostic.code,
        crate::remediation::REMEDIATION_ARTIFACT_STALE_CODE
    );
    assert_eq!(snapback.durable_version().unwrap(), before);
}

#[test]
fn fresh_machine_remediation_selects_the_served_replacement() {
    let snapback = crate::local::LocalSnapback::memory().expect("memory remediation fixture");
    let artifact_hash =
        crate::control_catalog::catalog_digest(crate::control_catalog::build_catalog())
            .expect("build catalog digest")
            .to_owned();
    let item = crate::remediation::RemediationItemV1::identifier_replacement(
        crate::remediation::RemediationKindV1::FixTypo,
        &artifact_hash,
        "hostOperation",
        None,
        "app.inspect",
    );
    let surfaces = remediation_served_surfaces(&snapback);
    let result = crate::remediation::apply_remediation(
        &surfaces,
        crate::remediation::RemediationApplyInputV1 {
            schema_version: crate::remediation::REMEDIATION_APPLY_SCHEMA_VERSION.to_owned(),
            artifact_hash: artifact_hash.clone(),
            item,
        },
    )
    .expect("fresh remediation applies");
    assert!(result.applied);
    assert_eq!(result.artifact_hash, artifact_hash);
    assert_eq!(result.replacement.value, "app.inspect");
}
