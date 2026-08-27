// Complete test items included at `server::tests` module scope.

#[test]
fn stale_authorization_reservation_is_an_explicit_retryable_conflict() {
    let error = super::authorization_reservation_stale(
        "reservation changed; retry the complete write with short jitter",
    );
    assert_eq!(error.diagnostic.details["retryable"], true);
    assert_eq!(error.diagnostic.details["effectCommitted"], false);
    assert_eq!(error.diagnostic.details["retryStrategy"], "short-jitter");
    let response = super::ApiError::from(error).into_response();
    assert_eq!(response.status(), StatusCode::CONFLICT);
    assert!(
        response.headers().get(header::RETRY_AFTER).is_none(),
        "409 conflict is immediately retryable; it must not advertise service backoff"
    );
}

#[tokio::test]
async fn sessions_bearer_can_acknowledge_without_legacy_body_auth_and_drop_retention() {
    let state = sessions_activation_server_fixture_async().await;
    let credential = mint_test_credential(&state, "sessions-ack-wire@example.test").await;
    let bearer = credential["token"]
        .as_str()
        .expect("session bearer")
        .to_owned();
    let router = app(state);

    let handshake = router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/auth/session")
                .header(header::AUTHORIZATION, format!("Bearer {bearer}"))
                .header("x-snapback-auth-client-protocol", "1")
                .via_hosted_terminator(TEST_HOSTED_CLIENT_SOURCE)
                .header("x-snapback-authority-descriptor-protocol", "1")
                .body(Body::empty())
                .expect("sessions ACK handshake request"),
        )
        .await
        .expect("sessions ACK handshake response");
    assert_eq!(handshake.status(), StatusCode::OK);
    let authority_descriptor = response_json(handshake).await["authorityDescriptor"].clone();
    let mutation_id = format!("cm_sessions_ack_wire_{}", Uuid::new_v4().simple());
    let mutation_body = || {
        serde_json::to_vec(&json!({
            "args": { "value": "sessions-ack-wire" },
            "clientMutationId": mutation_id,
            "authorityDescriptor": authority_descriptor,
        }))
        .expect("serialize sessions ACK mutation")
    };
    let request = |uri: &str, body: Vec<u8>| {
        let mut request = session_auth_http_request(uri, body, &bearer);
        request.headers_mut().insert(
            HeaderName::from_static("x-snapback-authority-descriptor-protocol"),
            HeaderValue::from_static("1"),
        );
        request
    };

    let first = router
        .clone()
        .oneshot(request("/mutation/queuedWrite", mutation_body()))
        .await
        .expect("sessions ACK seed mutation response");
    let first_status = first.status();
    let first = response_json(first).await;
    assert_eq!(first_status, StatusCode::OK, "seed mutation: {first}");

    // Session-mode client transport strips body auth; the bearer header is the
    // canonical authority carrier admitted by LLP 0058.
    let acknowledged = router
        .clone()
        .oneshot(request(
            "/client-mutations/acknowledge",
            serde_json::to_vec(&json!({
                "authorityDescriptor": authority_descriptor,
                "clientMutationIds": [mutation_id],
            }))
            .expect("serialize sessions ACK without body auth"),
        ))
        .await
        .expect("sessions ACK response");
    let acknowledged_status = acknowledged.status();
    let acknowledged = response_json(acknowledged).await;
    assert_eq!(
        acknowledged_status,
        StatusCode::OK,
        "session-header ACK must reach the handler: {acknowledged}"
    );
    assert_eq!(acknowledged["acknowledged"], json!(1));

    let after_gc = router
        .oneshot(request("/mutation/queuedWrite", mutation_body()))
        .await
        .expect("post-ACK mutation response");
    let after_gc_status = after_gc.status();
    let after_gc = response_json(after_gc).await;
    assert_eq!(
        after_gc_status,
        StatusCode::OK,
        "post-ACK mutation: {after_gc}"
    );
    assert_ne!(
        after_gc["version"], first["version"],
        "reusing the exact id after ACK must execute anew, proving retention was dropped"
    );
}

#[tokio::test]
async fn auth_session_dev_is_closed_no_store_and_rejects_credentials() {
    let (state, _) = auth_runtime_fixture(PolicyAuthMode::Dev);
    let state = state
        .with_server_startup_nonce("handshake-dev")
        .expect("install startup nonce");
    let router = app(state.clone());
    let response = router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/auth/session")
                .header("x-snapback-auth-client-protocol", "1")
                .via_hosted_terminator(TEST_HOSTED_CLIENT_SOURCE)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers()[header::CACHE_CONTROL],
        HeaderValue::from_static("no-store, private")
    );
    let body = response_json(response).await;
    assert_eq!(body["protocolVersion"], 1);
    assert_eq!(body["serverStartupNonce"], "handshake-dev");
    assert_eq!(body["activeMode"], "dev");
    assert_eq!(body["desiredMode"], "dev");
    assert_eq!(body["clientProtocols"]["authClient"], 1);
    assert_eq!(
        body["provider"],
        json!({"key": "email-code", "available": false})
    );
    assert_eq!(
        body["authority"],
        json!({
            "kind": "anonymous",
            "userId": null,
            "sessionId": null,
            "isAuthenticated": false,
        })
    );

    let credential = router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/auth/session")
                .header(header::AUTHORIZATION, "Bearer not-a-session")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(credential.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        response_json(credential).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_REQUIRED"
    );

    for request in [
        Request::builder()
            .uri("/auth/session?smuggled=true")
            .body(Body::empty())
            .unwrap(),
        Request::builder()
            .uri("/auth/session")
            .body(Body::from("{}"))
            .unwrap(),
    ] {
        let rejected = router.clone().oneshot(request).await.unwrap();
        assert_eq!(rejected.status(), StatusCode::BAD_REQUEST);
        assert_eq!(
            response_json(rejected).await["diagnostic"]["code"],
            "SNAPBACK_AUTH_REQUEST_INVALID"
        );
    }
}

#[tokio::test]
async fn auth_session_sessions_resolves_presented_bearer_through_shared_authority() {
    let (state, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
    let state = state
        .with_auth_runtime_facts(settled_sessions_state(), AuthProgramReadiness::item4(true))
        .expect("install sessions mode")
        .with_server_startup_nonce("handshake-sessions")
        .expect("install startup nonce");
    let credential = mint_test_credential(&state, "handshake@example.com").await;
    let token = credential["token"].as_str().unwrap().to_owned();
    let router = app(state);
    let response = router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/auth/session")
                .header(header::AUTHORIZATION, format!("Bearer {token}"))
                .header("x-snapback-auth-client-protocol", "1")
                .via_hosted_terminator(TEST_HOSTED_CLIENT_SOURCE)
                .header("x-snapback-auth-invalidation-protocol", "99")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let captured_incarnation = response
        .extensions()
        .get::<PreparedAuthority>()
        .and_then(PreparedAuthority::authorization_stream_incarnation)
        .expect("handshake authority carries its exact stream incarnation")
        .to_owned();
    let body = response_json(response).await;
    assert_eq!(body["activeMode"], "sessions");
    assert_eq!(body["transitionGeneration"], 7);
    assert_eq!(body["clientProtocols"]["authClient"], 1);
    assert_eq!(body["clientProtocols"]["authInvalidation"], Value::Null);
    assert_eq!(body["provider"]["available"], true);
    assert_eq!(body["authority"]["userId"], credential["session"]["userId"]);
    assert_eq!(body["authority"]["sessionId"], credential["session"]["id"]);
    assert_eq!(body["authority"]["isAuthenticated"], true);
    assert_eq!(body["authority"]["kind"], "humanSession");
    assert_eq!(body["authorizationStreamIncarnation"], captured_incarnation);
    assert_eq!(
        body["availability"]["onlineRequestResponse"]["reason"],
        "SNAPBACK_AUTH_POLICY_UNAVAILABLE"
    );

    let malformed = router
        .oneshot(
            Request::builder()
                .uri("/auth/session")
                .header(header::AUTHORIZATION, "Bearer malformed")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(malformed.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        response_json(malformed).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_REQUIRED"
    );
}

#[tokio::test]
async fn pending_and_quarantined_modes_refuse_both_function_load_ingresses() {
    for quarantined in [false, true] {
        let (state, _) = auth_runtime_fixture(PolicyAuthMode::Dev);
        let state = state
            .with_auth_runtime_facts(
                pending_sessions_state(quarantined),
                AuthProgramReadiness::item4(false),
            )
            .expect("install pending mode");
        let router = app(state.clone());

        let direct = router
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
            .expect("direct pending function-load refusal");
        assert_eq!(direct.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(
            response_json(direct).await["diagnostic"]["code"],
            "SNAPBACK_AUTH_MODE_PENDING"
        );

        let host = router
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
            .expect("host-op pending function-load refusal");
        assert_eq!(host.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(
            response_json(host).await["diagnostic"]["code"],
            "SNAPBACK_AUTH_MODE_PENDING"
        );

        assert_eq!(
            with_snapback(&state.snapback, |snapback| {
                snapback.function_kind("listItems")
            })
            .await,
            None,
            "neither ingress may publish the raw v0 manifest"
        );
    }
}

#[tokio::test]
async fn published_mode_state_is_visible_to_router_clones_before_stage_response() {
    let (state, _) = auth_runtime_fixture(PolicyAuthMode::Dev);
    let router = app(state.clone());
    state
        .publish_auth_mode_state(pending_sessions_state(false))
        .expect("publish committed pending state");

    let inspect = router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/inspect")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(inspect.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        response_json(inspect).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_MODE_PENDING"
    );

    let handshake = router
        .oneshot(
            Request::builder()
                .uri("/auth/session")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body = response_json(handshake).await;
    assert_eq!(body["transitionGeneration"], 8);
    assert_eq!(body["desiredMode"], "sessions");
}

#[tokio::test]
async fn same_mode_post_commit_publication_failure_cancels_and_closes_admission() {
    let (state, _) = auth_runtime_fixture(PolicyAuthMode::Dev);
    let controller = state.auth_admission_controller();
    let predecessor = controller.admit().expect("predecessor root");
    let shared = state.snapback.clone();
    state.inject_auth_mode_publication_failure();
    let router = app(state);
    let schema = SchemaManifest {
        schema_version: "snapback.v0".to_owned(),
        app_id: "auth-http-fixture".to_owned(),
        schema_hash: Some("sha256:publication-schema".to_owned()),
        inputs_hash: Some("sha256:publication-inputs".to_owned()),
        ..SchemaManifest::default()
    };
    let functions = FunctionManifest {
        schema_version: "snapback.v0".to_owned(),
        app_id: "auth-http-fixture".to_owned(),
        bundle_hash: Some("sha256:publication-functions".to_owned()),
        inputs_hash: Some("sha256:publication-inputs".to_owned()),
        ..FunctionManifest::default()
    };
    let response = router
        .oneshot(auth_http_request(
            "POST",
            "/app/ensure",
            serde_json::to_vec(&json!({
                "intent": "provision",
                "requestedMode": "dev",
                "schema": schema,
                "functions": functions,
            }))
            .unwrap(),
            true,
            Some("auth-http-admin"),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(
        response_json(response).await["diagnostic"]["code"],
        "TEST_AUTH_MODE_PUBLICATION_FAILURE"
    );

    let durable = super::with_snapback(&shared, |snapback| {
        snapback
            .remainder_auth_fixture()
            .auth_mode_state()
            .expect("durable committed deployment")
    })
    .await;
    assert!(durable.active_deployment.is_some());
    assert!(predecessor.is_cancelled());
    let closed = controller.snapshot();
    assert!(!closed.accepting);
    assert_eq!(
        controller.admit().unwrap_err().diagnostic.code,
        "SNAPBACK_AUTH_MODE_PENDING"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn cancelled_mode_transition_waiter_cannot_drop_postcommit_carrier() {
    let state = sessions_activation_server_fixture_async().await;
    let credential = mint_test_credential(&state, "cancelled-mode-transition@example.com").await;
    let bearer = credential["token"].as_str().expect("session bearer");
    let (connection_id, registration_generation, _waker) =
        open_registered_session_connection(&state, bearer, "cancelled-mode-transition-grant");
    let (schema, functions) = dev_downgrade_pair();
    let prepared = with_snapback(&state.snapback, move |snapback| {
        snapback.prepare_auth_provision(EnsureAppMode::Dev, Some(schema), Some(functions), None)
    })
    .await
    .expect("preflight cancellable sessions-to-dev transition");

    // Hold only the connection registry on a dedicated OS thread. The
    // owned transition can commit/project under Local, but its required
    // off-Local terminal lifecycle cannot finish until this test releases
    // the registry.
    let held_connections = state.connections.clone();
    let held_connection_id = connection_id.clone();
    let (locked_tx, locked_rx) = tokio::sync::oneshot::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    let holder = std::thread::spawn(move || {
        let registry = held_connections.lock();
        assert!(registry.grants.contains_key(&held_connection_id));
        locked_tx.send(()).expect("report held connection registry");
        release_rx.recv().expect("release held connection registry");
        drop(registry);
    });
    locked_rx.await.expect("connection registry holder starts");

    let controller = state.auth_admission_controller();
    let transition_state = state.clone();
    let waiter = tokio::spawn(async move {
        super::commit_prepared_auth_provision(
            &transition_state,
            prepared,
            ServerProfile::Test.as_str().to_owned(),
        )
        .await
    });
    tokio::time::timeout(Duration::from_secs(2), async {
        while controller.snapshot().accepting {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("owned transition closes predecessor admission");
    waiter.abort();
    assert!(waiter.await.unwrap_err().is_cancelled());
    assert!(
        !controller.snapshot().accepting,
        "cancelling only the waiter cannot reopen the predecessor"
    );

    release_tx
        .send(())
        .expect("release connection lifecycle projection");
    holder.join().expect("connection registry holder exits");
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if state.auth_mode_state().desired == AuthMode::Dev
                && !state.connections.lock().grants.contains_key(&connection_id)
                && state
                    .ephemeral
                    .delivery_notifier()
                    .terminal_if_current(&connection_id, registration_generation)
                    .is_some()
            {
                return;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("owned postcommit carrier completes after its waiter is cancelled");
    assert!(!controller.snapshot().accepting);
}

#[tokio::test]
async fn sessions_activation_runtime_projection_failure_never_reopens_admission() {
    let state = sessions_activation_server_fixture_async().await;
    let controller = state.auth_admission_controller();
    let predecessor_bundle = state
        .auth_mode_state()
        .active_deployment
        .as_ref()
        .expect("predecessor deployment")
        .bundle_hash
        .clone();
    let successor = activation_functions('6', true);
    let successor_bundle = successor.bundle_hash.clone().expect("successor bundle");
    state.inject_auth_mode_publication_failure();

    let response = app(state.clone())
        .oneshot(auth_http_request(
            "POST",
            "/_snapback/api/functions/load",
            serde_json::to_vec(&successor).unwrap(),
            true,
            Some("auth-http-admin"),
            None,
        ))
        .await
        .expect("injected runtime projection failure response");
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(
        response_json(response).await["diagnostic"]["code"],
        "TEST_AUTH_MODE_PUBLICATION_FAILURE"
    );
    assert_eq!(
        state
            .auth_mode_state()
            .active_deployment
            .as_ref()
            .expect("runtime projection remains predecessor")
            .bundle_hash,
        predecessor_bundle
    );
    let durable_bundle = with_snapback(&state.snapback, |snapback| {
        snapback
            .remainder_auth_fixture()
            .auth_mode_state()
            .expect("durable activation snapshot")
            .active_deployment
            .expect("durable successor deployment")
            .bundle_hash
    })
    .await;
    assert_eq!(durable_bundle, successor_bundle);
    let closed = controller.snapshot();
    assert!(!closed.accepting);
    assert_eq!(closed.in_flight, 0);
    assert_eq!(
        controller.admit().unwrap_err().diagnostic.code,
        "SNAPBACK_AUTH_MODE_PENDING"
    );
}

#[tokio::test]
async fn app_api_artifact_lanes_skip_the_sessions_protocol_offer() {
    let (state, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
    let state = state
        .with_auth_runtime_facts(
            settled_sessions_state(),
            AuthProgramReadiness::new(true, true, true, true, false, false, false),
        )
        .expect("install item-5 sessions fixture");
    let headerless = HeaderMap::new();
    for path in [
        "/app-api/current",
        "/app-api/openapi.json",
        "/app-api/agent-skill",
        "/app-api/envelope/{sha256}",
    ] {
        let spec = route_registry()
            .into_iter()
            .find(|spec| spec.method == "GET" && spec.path == path)
            .unwrap_or_else(|| panic!("registered app-api route {path}"));
        assert!(
            super::bare_public_artifact_route(spec),
            "{path} must be in the closed bare-artifact carrier map"
        );
        assert!(
            super::session_online_protocol_refusal(spec, &state, &headerless).is_none(),
            "{path} must serve without the auth-client protocol offer"
        );
    }
}

#[tokio::test]
async fn pasteable_delivery_lanes_skip_the_sessions_protocol_offer() {
    // LLP 0044 §Delivery profiles, dated note 2026-07-31: the public
    // alias and the signed serve lane are URL-authority routes a plain
    // `<img src>`/CDN/pasted link must be able to fetch — no custom
    // headers. Strict delivery and every other asset route keep the
    // offer discipline.
    let (state, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
    let state = state
        .with_auth_runtime_facts(
            settled_sessions_state(),
            AuthProgramReadiness::new(true, true, true, true, false, false, false),
        )
        .expect("install sessions fixture");
    let spec_for = |method: &str, path: &str| {
        route_registry()
            .into_iter()
            .find(|spec| spec.method == method && spec.path == path)
            .unwrap_or_else(|| panic!("registered route {method} {path}"))
    };
    let headerless = HeaderMap::new();

    for path in [
        "/assets/public/{id}/{variant}",
        "/assets/signed/{id}/{variant}",
    ] {
        let spec = spec_for("GET", path);
        assert!(
            super::pasteable_delivery_route(spec),
            "{path} is a pasteable delivery lane"
        );
        assert!(
            super::session_online_protocol_refusal(spec, &state, &headerless).is_none(),
            "{path} must serve without the auth-client protocol offer"
        );
    }

    let strict = spec_for("GET", "/assets/records/{id}/bytes/{variant}");
    assert!(!super::pasteable_delivery_route(strict));
    let refusal = super::session_online_protocol_refusal(strict, &state, &headerless)
        .expect("strict delivery keeps the protocol-offer discipline");
    assert_eq!(
        refusal.diagnostic.code,
        "SNAPBACK_AUTH_PROFILE_CLIENT_UNSUPPORTED"
    );
    let issuance = spec_for("POST", "/assets/records/{id}/signed-url");
    assert!(
        !super::pasteable_delivery_route(issuance),
        "signed-URL issuance is per-request authorized, never pasteable"
    );
    assert!(super::session_online_protocol_refusal(issuance, &state, &headerless).is_some());
}

#[tokio::test]
async fn authorized_lease_route_requires_readiness_and_exact_protocol_offer() {
    let (state, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
    let credential = mint_test_credential(&state, "authorized-lease-route@example.com").await;
    let bearer = credential["token"].as_str().unwrap().to_owned();
    let request = |lease_protocol: Option<&str>, include_unknown: bool| {
        let mut builder = Request::builder()
            .method("POST")
            .uri("/query/missing_function/authorized-lease")
            .header(header::CONTENT_TYPE, "application/json")
            .header(header::AUTHORIZATION, format!("Bearer {bearer}"))
            .header("x-snapback-auth-client-protocol", "1")
            .via_hosted_terminator(TEST_HOSTED_CLIENT_SOURCE)
            .header("x-snapback-auth-invalidation-protocol", "1");
        if let Some(lease_protocol) = lease_protocol {
            builder = builder.header("x-snapback-authorized-lease-protocol", lease_protocol);
        }
        let body = if include_unknown {
            r#"{
                        "args": {},
                        "leaseRequestId": "request_1",
                        "clientStoreId": "store_1",
                        "queryKey": "missing_function:{}",
                        "queryInstanceId": 1,
                        "unexpected": true
                    }"#
        } else {
            r#"{
                        "args": {},
                        "leaseRequestId": "request_1",
                        "clientStoreId": "store_1",
                        "queryKey": "missing_function:{}",
                        "queryInstanceId": 1
                    }"#
        };
        builder.body(Body::from(body)).unwrap()
    };

    let dependencies_ready = AuthProgramReadiness::new(true, true, true, true, true, true, false);
    let unavailable = app(state
        .clone()
        .with_auth_runtime_facts(settled_sessions_state(), dependencies_ready)
        .expect("install pre-authorized-lease readiness"))
    .oneshot(request(Some("1"), false))
    .await
    .unwrap();
    assert_eq!(unavailable.status(), StatusCode::SERVICE_UNAVAILABLE);
    let unavailable = response_json(unavailable).await;
    assert_eq!(
        unavailable["diagnostic"]["code"],
        "SNAPBACK_AUTH_POLICY_UNAVAILABLE"
    );

    let ready = app(state
        .with_auth_runtime_facts(
            settled_sessions_state(),
            AuthProgramReadiness::new(true, true, true, true, true, true, true),
        )
        .expect("install authorized-lease readiness"));
    let missing_offer = ready.clone().oneshot(request(None, false)).await.unwrap();
    assert_eq!(missing_offer.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_json(missing_offer).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_PROFILE_CLIENT_UNSUPPORTED"
    );

    // The lease POST is an ordinary HTTP route: a forged
    // `Sec-WebSocket-Protocol` header is not an offer carrier there, so a
    // lease offer riding only the subprotocol grammar refuses exactly like
    // an absent offer (issues/20260725-0093-p3-lease-offer-parser-carrier.md).
    let subprotocol_only = {
        let mut request = request(None, false);
        request.headers_mut().insert(
            "sec-websocket-protocol",
            axum::http::HeaderValue::from_static(
                "snapback.authorized-lease.1, snapback.auth-invalidation.1",
            ),
        );
        request
    };
    let subprotocol_only = ready.clone().oneshot(subprotocol_only).await.unwrap();
    assert_eq!(subprotocol_only.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_json(subprotocol_only).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_PROFILE_CLIENT_UNSUPPORTED"
    );

    let unknown = ready
        .clone()
        .oneshot(request(Some("1"), true))
        .await
        .unwrap();
    assert_eq!(unknown.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_json(unknown).await["diagnostic"]["code"],
        "SNAPBACK_REQUEST_JSON_INVALID"
    );

    let accepted_offer = ready.oneshot(request(Some("1"), false)).await.unwrap();
    assert_eq!(
        response_json(accepted_offer).await["diagnostic"]["code"],
        "SNAPBACK_UNKNOWN_FUNCTION",
        "an exact protocol offer must reach the fresh full-query path"
    );
}

#[tokio::test]
async fn loopback_context_cannot_authorize_a_different_non_loopback_listener() {
    use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};

    async fn request(port: u16, path: &str) -> (StatusCode, Value) {
        let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .unwrap_or_else(|error| panic!("connect detached {path}: {error}"));
        stream
            .write_all(
                format!(
                    "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
                )
                .as_bytes(),
            )
            .await
            .unwrap_or_else(|error| panic!("write detached {path}: {error}"));
        let mut response = Vec::new();
        stream
            .read_to_end(&mut response)
            .await
            .unwrap_or_else(|error| panic!("read detached {path}: {error}"));
        let split = response
            .windows(4)
            .position(|window| window == b"\r\n\r\n")
            .expect("HTTP response header delimiter");
        let head = std::str::from_utf8(&response[..split]).expect("HTTP response headers");
        let status = head
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
            .and_then(|raw| raw.parse::<u16>().ok())
            .and_then(|raw| StatusCode::from_u16(raw).ok())
            .expect("HTTP response status");
        let body = serde_json::from_slice(&response[split + 4..]).unwrap_or(Value::Null);
        (status, body)
    }

    // auth_runtime_fixture deliberately carries positive posture from a
    // different, throwaway loopback listener. The network bind below must
    // replace that evidence rather than trusting the prebuilt context.
    let (state, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
    assert_eq!(state.server.listener_transport_loopback(), Some(true));

    // This is the shipped bypass shape: the router claims loopback while
    // an embedder serves it on every interface. Connect through loopback so
    // the test remains hermetic; the socket itself is still non-loopback.
    let listener = TcpListener::bind("0.0.0.0:0")
        .await
        .expect("bind real non-loopback embedded listener");
    let port = listener
        .local_addr()
        .expect("embedded listener address")
        .port();
    let server = tokio::spawn(async move {
        app(state)
            .bind(listener)
            .expect("couple sessions app to real non-loopback listener")
            .serve()
            .await
            .expect("serve detached sessions router");
    });
    let (health, _) = request(port, "/health").await;
    assert_eq!(health, StatusCode::OK);

    for path in ["/inspect", "/auth/session"] {
        let (status, body) = request(port, path).await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR, "{path}");
        assert_eq!(
            body["diagnostic"]["code"], "SNAPBACK_AUTH_TRANSPORT_INSECURE",
            "{path}: {body}"
        );
    }

    server.abort();
    let _ = server.await;

    let (mut forged, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
    let context = Arc::make_mut(&mut forged.server);
    context.record_bound_address("0.0.0.0:4287".parse().expect("non-loopback address"));
    context.loopback = true;
    context.host = "127.0.0.1".to_owned();
    let response = app(forged)
        .oneshot(
            Request::builder()
                .uri("/auth/session")
                .body(Body::empty())
                .expect("forged-loopback request"),
        )
        .await
        .expect("forged-loopback response");
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(
        response_json(response).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_TRANSPORT_INSECURE",
        "public descriptive fields must not override listener-owned posture"
    );
}

#[tokio::test]
async fn hosted_auth_configuration_is_fail_closed_in_embedded_composition() {
    let (mut state, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
    Arc::make_mut(&mut state.server).auth_deployment =
        crate::auth::deployment::AuthDeploymentTarget::Hosted;
    let router = app(state);

    for path in ["/inspect", "/auth/session"] {
        let refused = router
            .clone()
            .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(refused.status(), StatusCode::SERVICE_UNAVAILABLE, "{path}");
        let body = response_json(refused).await;
        assert_eq!(
            body["diagnostic"]["code"], "SNAPBACK_AUTH_DEPLOYMENT_UNSUPPORTED",
            "{path}"
        );
        assert_eq!(
            body["diagnostic"]["details"]["blockers"],
            serde_json::json!([
                "externalTls",
                "effectiveSource",
                "authenticationThrottle",
                "sessionInvalidation",
                "clientCredentialPosture",
                "deploymentAttestation",
                "liveHealth",
                "handlerCompatibility",
                "browserDirectBearerSeam",
                "operatorSurface",
            ]),
            "{path}"
        );
    }

    for path in ["/", "/health"] {
        let diagnostic = router
            .clone()
            .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(diagnostic.status(), StatusCode::OK, "{path}");
    }
}

#[test]
fn sender_proof_subprotocol_rejects_non_text_and_duplicate_carriers() {
    let mut non_text = HeaderMap::new();
    non_text.insert(
        header::SEC_WEBSOCKET_PROTOCOL,
        HeaderValue::from_bytes(&[0xff]).expect("opaque header value"),
    );
    assert!(super::sender_proof_subprotocol(&non_text).is_err());

    let mut duplicated = HeaderMap::new();
    duplicated.append(
        header::SEC_WEBSOCKET_PROTOCOL,
        HeaderValue::from_static("snapback.sender-proof.v1.first"),
    );
    duplicated.append(
        header::SEC_WEBSOCKET_PROTOCOL,
        HeaderValue::from_static("snapback.sender-proof.v1.second"),
    );
    assert!(super::sender_proof_subprotocol(&duplicated).is_err());
}

#[tokio::test]
async fn hosted_sender_challenge_precedes_every_request_body_poll() {
    let (mut state, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
    Arc::make_mut(&mut state.server).auth_deployment =
        crate::auth::deployment::AuthDeploymentTarget::Hosted;
    let now_ms = state
        .auth_provider
        .as_ref()
        .expect("hosted fixture provider")
        .now_ms();
    let state = state
        .with_hosted_serving_authority(hosted_serving_authority(now_ms))
        .expect("install hosted sender authority");
    let router = app(state.clone());

    let absent = router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/refresh")
                .header("x-snapback-auth-client-protocol", "1")
                .via_hosted_terminator(TEST_HOSTED_CLIENT_SOURCE)
                .body(Body::new(PanicOnPollBody))
                .expect("absent sender carrier request"),
        )
        .await
        .expect("absent sender carrier response");
    assert_eq!(absent.status(), StatusCode::UNAUTHORIZED);
    assert!(absent.headers().get(super::SENDER_NONCE_HEADER).is_none());
    assert_eq!(
        response_json(absent).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_REQUIRED",
    );

    let challenged = router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/refresh?attacker=query")
                .header(header::AUTHORIZATION, "Bearer malformed-session-carrier")
                .header("x-snapback-auth-client-protocol", "1")
                .via_hosted_terminator(TEST_HOSTED_CLIENT_SOURCE)
                .body(Body::new(PanicOnPollBody))
                .expect("hosted sender challenge request"),
        )
        .await
        .expect("hosted sender challenge response");
    assert_eq!(challenged.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        challenged
            .headers()
            .get(super::SENDER_NONCE_HEADER)
            .and_then(|value| value.to_str().ok())
            .map(str::len),
        Some(43),
    );
    assert_eq!(
        challenged.headers().get(header::CACHE_CONTROL),
        Some(&HeaderValue::from_static("no-store")),
    );
    assert_eq!(
        response_json(challenged).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_SENDER_PROOF_REQUIRED",
    );

    let malformed = router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/refresh")
                .header(header::AUTHORIZATION, "Bearer malformed-session-carrier")
                .header("x-snapback-auth-client-protocol", "1")
                .via_hosted_terminator(TEST_HOSTED_CLIENT_SOURCE)
                .header(super::SENDER_PROOF_HEADER, "not-a-compact-proof")
                .body(Body::new(PanicOnPollBody))
                .expect("malformed sender proof request"),
        )
        .await
        .expect("malformed sender proof response");
    assert_eq!(malformed.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        malformed
            .headers()
            .get(super::SENDER_NONCE_HEADER)
            .and_then(|value| value.to_str().ok())
            .map(str::len),
        Some(43),
    );
    assert_eq!(
        response_json(malformed).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_SENDER_PROOF_REQUIRED",
    );

    let duplicated = router
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/refresh")
                .header(header::AUTHORIZATION, "Bearer malformed-session-carrier")
                .header("x-snapback-auth-client-protocol", "1")
                .via_hosted_terminator(TEST_HOSTED_CLIENT_SOURCE)
                .header(super::SENDER_PROOF_HEADER, "one")
                .header(super::SENDER_PROOF_HEADER, "two")
                .body(Body::new(PanicOnPollBody))
                .expect("duplicate sender proof request"),
        )
        .await
        .expect("duplicate sender proof response");
    assert_eq!(duplicated.status(), StatusCode::UNAUTHORIZED);
    assert!(
        duplicated
            .headers()
            .get(super::SENDER_NONCE_HEADER)
            .is_none()
    );
    assert_eq!(
        response_json(duplicated).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_SENDER_PROOF_INVALID",
    );
}

#[tokio::test]
async fn hosted_sender_shared_throttle_charges_denials_before_proof_and_body() {
    let (mut state, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
    Arc::make_mut(&mut state.server).auth_deployment =
        crate::auth::deployment::AuthDeploymentTarget::Hosted;
    let now_ms = state
        .auth_provider
        .as_ref()
        .expect("hosted fixture provider")
        .now_ms();
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
                global: AuthenticationBucketPolicy {
                    interval_ms: 1_000,
                    burst: 1,
                    maximum_denial_debt_attempts: 4,
                },
                source: generous,
                subject: generous,
                source_subject: generous,
                family: generous,
            },
        ))
        .expect("install hosted throttle authority");
    let router = app(state.clone());
    let request = || {
        // One client, one source: the denial debt charged here must land
        // in the GLOBAL bucket (the per-source policy is generous).
        Request::builder()
            .method("POST")
            .uri("/auth/refresh")
            .header(header::AUTHORIZATION, "Bearer malformed-session-carrier")
            .header("x-snapback-auth-client-protocol", "1")
            .via_hosted_terminator("192.0.2.10")
            .header(super::SENDER_PROOF_HEADER, "not-a-compact-proof")
            .body(Body::new(PanicOnPollBody))
            .expect("hosted throttled sender request")
    };

    let first = router
        .clone()
        .oneshot(request())
        .await
        .expect("first sender challenge");
    assert_eq!(first.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        response_json(first).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_SENDER_PROOF_REQUIRED",
    );

    let denied = router
        .clone()
        .oneshot(request())
        .await
        .expect("shared throttle denial");
    assert_eq!(denied.status(), StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(denied.headers()[header::RETRY_AFTER], "2");
    let denied = response_json(denied).await;
    assert_eq!(denied["diagnostic"]["code"], "SNAPBACK_AUTH_THROTTLED",);
    assert_eq!(
        denied["diagnostic"]["details"]["budgetName"],
        "auth.enumeration",
    );
    assert_eq!(denied["diagnostic"]["details"]["retryAfter"]["kind"], "at",);
    assert!(
        denied["diagnostic"]["details"]["correlationId"]
            .as_str()
            .is_some_and(|value| !value.is_empty())
    );

    state
        .snapback
        .try_lock()
        .expect("borrow throttle authority")
        .make_authentication_throttle_unavailable_for_test()
        .expect("remove throttle table");
    let unavailable = router
        .oneshot(request())
        .await
        .expect("unavailable shared throttle refusal");
    assert_eq!(unavailable.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        response_json(unavailable).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_THROTTLE_UNAVAILABLE",
    );
}

/// LLP 0077 D-1 regression: on a hosted sender-gated origin, an absent
/// Authorization on a route whose auth requirement lives in the function
/// (`authRequirement: authenticated`, not route policy) must refuse with
/// `SNAPBACK_AUTH_REQUIRED` before any body poll. `PanicOnPollBody` is
/// the poisoned-body witness that the JSON parser is never reached.
#[tokio::test]
async fn hosted_absent_carrier_on_authenticated_function_refuses_before_body_poll() {
    let router = app(hosted_function_route_state());
    for path in [
        "/query/listNotes",
        "/query/listNotes/authorized-lease",
        "/mutation/appendNote",
    ] {
        let refused = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(path)
                    .via_hosted_terminator(TEST_HOSTED_CLIENT_SOURCE)
                    .body(Body::new(PanicOnPollBody))
                    .expect("absent carrier function request"),
            )
            .await
            .expect("absent carrier function response");
        assert_eq!(refused.status(), StatusCode::UNAUTHORIZED, "{path}");
        assert!(refused.headers().get(super::SENDER_NONCE_HEADER).is_none());
        assert_eq!(
            response_json(refused).await["diagnostic"]["code"],
            "SNAPBACK_AUTH_REQUIRED",
            "{path}",
        );
    }
}

/// A malformed carrier on a function-authenticated hosted route keeps the
/// LLP 0077 anti-oracle shape — the keyed cover-nonce sender challenge —
/// and still refuses before any body poll.
#[tokio::test]
async fn hosted_malformed_carrier_on_authenticated_function_challenges_before_body_poll() {
    let router = app(hosted_function_route_state());
    let challenged = router
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/query/listNotes")
                .header(header::AUTHORIZATION, "Bearer malformed-session-carrier")
                .via_hosted_terminator(TEST_HOSTED_CLIENT_SOURCE)
                .body(Body::new(PanicOnPollBody))
                .expect("malformed carrier function request"),
        )
        .await
        .expect("malformed carrier function response");
    assert_eq!(challenged.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        challenged
            .headers()
            .get(super::SENDER_NONCE_HEADER)
            .and_then(|value| value.to_str().ok())
            .map(str::len),
        Some(43),
    );
    assert_eq!(
        response_json(challenged).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_SENDER_PROOF_REQUIRED",
    );
}

#[tokio::test]
async fn hosted_sender_issuance_session_and_refresh_compose_through_the_router() {
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
    let state = state
        .with_hosted_serving_authority(hosted_serving_authority(now_ms))
        .expect("install hosted sender authority");
    let router = app(state.clone());

    let mut request_code_request = auth_http_request(
        "POST",
        "/auth/request-code",
        serde_json::to_vec(&json!({"email": "sender@example.com"})).unwrap(),
        true,
        None,
        None,
    );
    offer_auth_client_protocol(&mut request_code_request);
    let request_code = router
        .clone()
        .oneshot(request_code_request)
        .await
        .expect("request hosted sender code");
    if request_code.status() != StatusCode::OK {
        let status = request_code.status();
        panic!(
            "hosted sender request-code failed with {status}: {}",
            response_json(request_code).await
        );
    }
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

    let sender_key = HostedSenderProofKey::generate();
    let issued_at_seconds = provider.now_ms() / 1_000;
    let consumed_on_rejection =
        sender_key.issuance_proof(&challenge_id, issued_at_seconds, [31_u8; 16]);
    let wrong_code = if code == "000000" { "000001" } else { "000000" };
    let mut wrong_exchange_request = auth_http_request(
        "POST",
        "/auth/exchange",
        serde_json::to_vec(&json!({
            "challengeId": challenge_id,
            "code": wrong_code,
            "senderConstraint": {
                "protocol": "snapback.sender-issuance.v2",
                "publicJwk": sender_key.public_jwk(),
                "proof": consumed_on_rejection.clone(),
            },
        }))
        .unwrap(),
        true,
        None,
        None,
    );
    offer_auth_client_protocol(&mut wrong_exchange_request);
    let wrong_exchange = router
        .clone()
        .oneshot(wrong_exchange_request)
        .await
        .expect("reject wrong hosted sender code");
    assert_eq!(wrong_exchange.status(), StatusCode::UNAUTHORIZED);

    let mut replayed_exchange_request = auth_http_request(
        "POST",
        "/auth/exchange",
        serde_json::to_vec(&json!({
            "challengeId": challenge_id.clone(),
            "code": code.clone(),
            "senderConstraint": {
                "protocol": "snapback.sender-issuance.v2",
                "publicJwk": sender_key.public_jwk(),
                "proof": consumed_on_rejection.clone(),
            },
        }))
        .unwrap(),
        true,
        None,
        None,
    );
    offer_auth_client_protocol(&mut replayed_exchange_request);
    let replayed_exchange = router
        .clone()
        .oneshot(replayed_exchange_request)
        .await
        .expect("refuse cross-guess issuance proof replay");
    assert_ne!(replayed_exchange.status(), StatusCode::OK);

    let issuance_proof = sender_key.issuance_proof(&challenge_id, issued_at_seconds, [30_u8; 16]);
    let mut exchange_request = auth_http_request(
        "POST",
        "/auth/exchange",
        serde_json::to_vec(&json!({
            "challengeId": challenge_id,
            "code": code,
            "senderConstraint": {
                "protocol": "snapback.sender-issuance.v2",
                "publicJwk": sender_key.public_jwk(),
                "proof": issuance_proof,
            },
        }))
        .unwrap(),
        true,
        None,
        None,
    );
    offer_auth_client_protocol(&mut exchange_request);
    let exchange = router
        .clone()
        .oneshot(exchange_request)
        .await
        .expect("exchange hosted sender code");
    assert_eq!(exchange.status(), StatusCode::OK);
    assert_eq!(
        exchange.headers().get(header::CACHE_CONTROL),
        Some(&HeaderValue::from_static("no-store, private")),
    );
    let nonce_one = exchange
        .headers()
        .get(super::SENDER_NONCE_HEADER)
        .and_then(|value| value.to_str().ok())
        .expect("issuance successor nonce")
        .to_owned();
    let credential = response_json(exchange).await;
    let bearer_one = credential["token"]
        .as_str()
        .expect("issued hosted sender bearer")
        .to_owned();
    // Decision 4 first layer: sender-bound issuance mints `sbs2_`.
    assert!(
        bearer_one.starts_with("sbs2_"),
        "sender-bound exchange must mint the versioned spelling",
    );

    let session_proof = sender_key.resource_proof(
        "GET",
        "https://app.example.test/auth/session",
        &bearer_one,
        &nonce_one,
        provider.now_ms() / 1_000,
        [32_u8; 16],
    );
    let mut session_request = Request::builder()
        .method("GET")
        .uri("/auth/session")
        .header(header::AUTHORIZATION, format!("Bearer {bearer_one}"))
        .header(super::SENDER_PROOF_HEADER, session_proof)
        .body(Body::empty())
        .expect("hosted sender session request");
    offer_auth_client_protocol(&mut session_request);
    let session_request = via_hosted_terminator(session_request, TEST_HOSTED_CLIENT_SOURCE);
    let session = router
        .clone()
        .oneshot(session_request)
        .await
        .expect("project hosted sender session");
    if session.status() != StatusCode::OK {
        let status = session.status();
        panic!(
            "hosted sender session failed with {status}: {}",
            response_json(session).await
        );
    }
    let nonce_two = session
        .headers()
        .get(super::SENDER_NONCE_HEADER)
        .and_then(|value| value.to_str().ok())
        .expect("session successor nonce")
        .to_owned();
    assert_eq!(
        response_json(session).await["authority"]["isAuthenticated"],
        true
    );

    let forbidden_body_proof = sender_key.resource_proof(
        "POST",
        "https://app.example.test/auth/refresh",
        &bearer_one,
        &nonce_two,
        provider.now_ms() / 1_000,
        [38_u8; 16],
    );
    let mut forbidden_body = session_auth_http_request(
        "/auth/refresh",
        serde_json::to_vec(&json!({
            "auth": { "userId": "client-asserted" }
        }))
        .unwrap(),
        &bearer_one,
    );
    forbidden_body.headers_mut().insert(
        HeaderName::from_static(super::SENDER_PROOF_HEADER),
        HeaderValue::from_str(&forbidden_body_proof).expect("sender forbidden-body proof header"),
    );
    let forbidden_body = router
        .clone()
        .oneshot(forbidden_body)
        .await
        .expect("reject hosted sender forbidden authority field");
    assert_eq!(forbidden_body.status(), StatusCode::BAD_REQUEST);
    let nonce_after_forbidden = forbidden_body
        .headers()
        .get(super::SENDER_NONCE_HEADER)
        .and_then(|value| value.to_str().ok())
        .expect("forbidden-body response retains committed successor nonce")
        .to_owned();
    assert_eq!(
        response_json(forbidden_body).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_BODY_AUTH_UNSUPPORTED",
        "post-proof forbidden authority must win before session projection",
    );

    let refresh_proof = sender_key.resource_proof(
        "POST",
        "https://app.example.test/auth/refresh",
        &bearer_one,
        &nonce_after_forbidden,
        provider.now_ms() / 1_000,
        [33_u8; 16],
    );
    let mut refresh = session_auth_http_request(
        "/auth/refresh",
        serde_json::to_vec(&json!({})).unwrap(),
        &bearer_one,
    );
    refresh.headers_mut().insert(
        HeaderName::from_static(super::SENDER_PROOF_HEADER),
        HeaderValue::from_str(&refresh_proof).expect("sender refresh proof header"),
    );
    let refresh = router
        .clone()
        .oneshot(refresh)
        .await
        .expect("refresh hosted sender session");
    assert_eq!(refresh.status(), StatusCode::OK);
    let nonce_three = refresh
        .headers()
        .get(super::SENDER_NONCE_HEADER)
        .and_then(|value| value.to_str().ok())
        .expect("refresh successor nonce")
        .to_owned();
    let successor = response_json(refresh).await;
    assert_ne!(successor["token"], credential["token"]);
    assert_eq!(
        successor["authorityDescriptor"]["authorityInstanceId"],
        credential["authorityDescriptor"]["authorityInstanceId"],
    );
    let bearer_two = successor["token"]
        .as_str()
        .expect("refresh successor bearer")
        .to_owned();
    // Decision 4: successors of a sender-bound family stay `sbs2_`.
    assert!(
        bearer_two.starts_with("sbs2_"),
        "sender-bound refresh successor must stay in the versioned spelling",
    );

    let retryable_session_proof = sender_key.resource_proof(
        "GET",
        "https://app.example.test/auth/session",
        &bearer_two,
        &nonce_three,
        provider.now_ms() / 1_000,
        [34_u8; 16],
    );
    {
        let mut snapback = state
            .snapback
            .try_lock()
            .expect("borrow sender authority for failure injection");
        snapback
            .make_sender_proof_replay_unavailable_for_test()
            .expect("make sender replay authority unavailable");
    }
    let mut unavailable_request = Request::builder()
        .method("GET")
        .uri("/auth/session")
        .header(header::AUTHORIZATION, format!("Bearer {bearer_two}"))
        .header(super::SENDER_PROOF_HEADER, retryable_session_proof.clone())
        .body(Body::new(PanicOnPollBody))
        .expect("sender replay-authority failure request");
    offer_auth_client_protocol(&mut unavailable_request);
    let unavailable_request = via_hosted_terminator(unavailable_request, TEST_HOSTED_CLIENT_SOURCE);
    let unavailable = router
        .clone()
        .oneshot(unavailable_request)
        .await
        .expect("refuse unavailable sender replay authority");
    assert_eq!(unavailable.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert!(
        unavailable
            .headers()
            .get(super::SENDER_NONCE_HEADER)
            .is_none()
    );
    assert_eq!(
        response_json(unavailable).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_SENDER_PROOF_AUTHORITY_UNAVAILABLE",
    );

    {
        let snapback = state
            .snapback
            .try_lock()
            .expect("borrow sender authority for test repair");
        snapback
            .restore_sender_proof_after_test_outage()
            .expect("repair sender replay authority after refusal");
    }
    let mut retried_session_request = Request::builder()
        .method("GET")
        .uri("/auth/session")
        .header(header::AUTHORIZATION, format!("Bearer {bearer_two}"))
        .header(super::SENDER_PROOF_HEADER, retryable_session_proof)
        .body(Body::empty())
        .expect("retry sender session request");
    offer_auth_client_protocol(&mut retried_session_request);
    let retried_session_request =
        via_hosted_terminator(retried_session_request, TEST_HOSTED_CLIENT_SOURCE);
    let retried_session = router
        .clone()
        .oneshot(retried_session_request)
        .await
        .expect("retry sender session after authority repair");
    assert_eq!(retried_session.status(), StatusCode::OK);
    let nonce_four = retried_session
        .headers()
        .get(super::SENDER_NONCE_HEADER)
        .and_then(|value| value.to_str().ok())
        .expect("repaired session successor nonce")
        .to_owned();
    assert_eq!(
        response_json(retried_session).await["authority"]["isAuthenticated"],
        true,
    );

    let connection_open_proof = sender_key.resource_proof(
        "POST",
        "https://app.example.test/connection/open",
        &bearer_two,
        &nonce_four,
        provider.now_ms() / 1_000,
        [35_u8; 16],
    );
    let mut connection_open = connection_open_request(Some(&bearer_two), json!({}));
    connection_open.headers_mut().insert(
        HeaderName::from_static(super::SENDER_PROOF_HEADER),
        HeaderValue::from_str(&connection_open_proof).expect("sender connection-open proof header"),
    );
    let connection_open = router
        .clone()
        .oneshot(connection_open)
        .await
        .expect("open sender-bound connection grant");
    assert_eq!(connection_open.status(), StatusCode::OK);
    let nonce_five = connection_open
        .headers()
        .get(super::SENDER_NONCE_HEADER)
        .and_then(|value| value.to_str().ok())
        .expect("connection-open successor nonce")
        .to_owned();
    let grant = response_json(connection_open).await;
    let connection_id = grant["connectionId"]
        .as_str()
        .expect("sender connection id")
        .to_owned();
    let connection_token = grant["connectionToken"]
        .as_str()
        .expect("sender connection token")
        .to_owned();
    // Decision 4: sender-bound connection-open mints `sct2_`.
    assert!(
        connection_token.starts_with("sct2_"),
        "sender-bound connection grant must mint the versioned spelling",
    );
    assert_eq!(
        crate::auth::crypto::classify_credential(&connection_token),
        Some(crate::auth::crypto::CredentialClass::SenderConnectionToken),
        "the hosted sender-grant gate must classify the process-minted token on its v2 lane",
    );

    let mut grant_route_matrix = super::route_registry()
        .into_iter()
        .filter_map(|spec| {
            let effective = spec.effective_for(PolicyAuthMode::Sessions);
            (effective.path_policy == super::RoutePolicy::ConnectionAuth
                && matches!(
                    effective.credential_resolution,
                    super::CredentialResolution::ConnectionGrantHeader
                        | super::CredentialResolution::ConnectionGrantHeaderOrWebSocketSubprotocol
                ))
            .then(|| {
                (
                    spec.method,
                    spec.path
                        .replace("{connection_id}", &connection_id)
                        .replace("{name}", "sender-matrix"),
                    false,
                )
            })
        })
        .collect::<Vec<_>>();
    grant_route_matrix.push(("GET", format!("/live/{connection_id}/stream"), true));
    assert_eq!(
        grant_route_matrix.len(),
        11,
        "the generated matrix must cover every header route plus the browser WebSocket carrier",
    );

    for (index, (method, path, websocket_carrier)) in grant_route_matrix.iter().enumerate() {
        let canonical_uri = format!("https://app.example.test{path}");
        let request = |proof: Option<&str>| {
            let mut builder = Request::builder()
                .method(*method)
                .uri(path)
                .header("x-snapback-auth-client-protocol", "1")
                .via_hosted_terminator(TEST_HOSTED_CLIENT_SOURCE);
            if *websocket_carrier {
                let mut protocols = format!(
                    "{}, {}{}",
                    super::LIVE_STREAM_SUBPROTOCOL,
                    super::CONNECTION_TOKEN_SUBPROTOCOL_PREFIX,
                    connection_token,
                );
                if let Some(proof) = proof {
                    protocols.push_str(&format!(
                        ", {}{}",
                        super::SENDER_PROOF_SUBPROTOCOL_PREFIX,
                        proof,
                    ));
                }
                builder = builder.header(header::SEC_WEBSOCKET_PROTOCOL, protocols);
            } else {
                builder = builder.header(super::CONNECTION_TOKEN_HEADER, &connection_token);
                if let Some(proof) = proof {
                    builder = builder.header(super::SENDER_PROOF_HEADER, proof);
                }
            }
            builder
                .body(Body::new(PanicOnPollBody))
                .expect("grant matrix request")
        };

        let missing = router
            .clone()
            .oneshot(request(None))
            .await
            .expect("refuse missing grant proof");
        assert_eq!(missing.status(), StatusCode::UNAUTHORIZED, "{path}");
        assert_eq!(
            missing
                .headers()
                .get(super::SENDER_NONCE_HEADER)
                .and_then(|value| value.to_str().ok()),
            Some(nonce_five.as_str()),
            "{path}",
        );
        assert_eq!(
            response_json(missing).await["diagnostic"]["code"],
            "SNAPBACK_AUTH_SENDER_PROOF_REQUIRED",
            "{path}",
        );

        let malformed = router
            .clone()
            .oneshot(request(Some("not-a-compact-proof")))
            .await
            .expect("refuse malformed grant proof");
        assert_eq!(malformed.status(), StatusCode::UNAUTHORIZED, "{path}");
        assert_eq!(
            response_json(malformed).await["diagnostic"]["code"],
            "SNAPBACK_AUTH_SENDER_PROOF_INVALID",
            "{path}",
        );

        let wrong_ath = sender_key.resource_proof(
            method,
            &canonical_uri,
            &bearer_two,
            &nonce_five,
            provider.now_ms() / 1_000,
            [80_u8.saturating_add(index as u8); 16],
        );
        let wrong_ath = router
            .clone()
            .oneshot(request(Some(&wrong_ath)))
            .await
            .expect("refuse session-ath proof on a grant route");
        assert_eq!(wrong_ath.status(), StatusCode::UNAUTHORIZED, "{path}");
        assert_eq!(
            response_json(wrong_ath).await["diagnostic"]["code"],
            "SNAPBACK_AUTH_SENDER_PROOF_INVALID",
            "{path}",
        );

        let replay_id = [120_u8.saturating_add(index as u8); 16];
        {
            let mut snapback = state
                .snapback
                .try_lock()
                .expect("borrow sender replay authority for route matrix");
            snapback
                .remainder_auth_fixture()
                .auth_catalog()
                .insert_sender_replay_for_test(replay_id.as_slice(), provider.now_ms() / 1_000 + 31)
                .expect("seed exact replay id");
        }
        let replayed = sender_key.resource_proof(
            method,
            &canonical_uri,
            &connection_token,
            &nonce_five,
            provider.now_ms() / 1_000,
            replay_id,
        );
        let replayed = router
            .clone()
            .oneshot(request(Some(&replayed)))
            .await
            .expect("refuse replayed grant proof");
        assert_eq!(replayed.status(), StatusCode::UNAUTHORIZED, "{path}");
        assert_eq!(
            response_json(replayed).await["diagnostic"]["code"],
            "SNAPBACK_AUTH_SENDER_PROOF_REPLAYED",
            "{path}",
        );
    }

    state
        .snapback
        .try_lock()
        .expect("borrow sender replay authority for grant outage")
        .make_sender_proof_replay_unavailable_for_test()
        .expect("make grant replay authority unavailable");
    for (index, (method, path, websocket_carrier)) in grant_route_matrix.iter().enumerate() {
        let proof = sender_key.resource_proof(
            method,
            &format!("https://app.example.test{path}"),
            &connection_token,
            &nonce_five,
            provider.now_ms() / 1_000,
            [160_u8.saturating_add(index as u8); 16],
        );
        let mut builder = Request::builder()
            .method(*method)
            .uri(path)
            .header("x-snapback-auth-client-protocol", "1")
            .via_hosted_terminator(TEST_HOSTED_CLIENT_SOURCE);
        if *websocket_carrier {
            builder = builder.header(
                header::SEC_WEBSOCKET_PROTOCOL,
                format!(
                    "{}, {}{}, {}{}",
                    super::LIVE_STREAM_SUBPROTOCOL,
                    super::CONNECTION_TOKEN_SUBPROTOCOL_PREFIX,
                    connection_token,
                    super::SENDER_PROOF_SUBPROTOCOL_PREFIX,
                    proof,
                ),
            );
        } else {
            builder = builder
                .header(super::CONNECTION_TOKEN_HEADER, &connection_token)
                .header(super::SENDER_PROOF_HEADER, proof);
        }
        let unavailable = router
            .clone()
            .oneshot(
                builder
                    .body(Body::new(PanicOnPollBody))
                    .expect("grant outage matrix request"),
            )
            .await
            .expect("refuse unavailable grant replay authority");
        assert_eq!(
            unavailable.status(),
            StatusCode::SERVICE_UNAVAILABLE,
            "{path}",
        );
        assert_eq!(
            response_json(unavailable).await["diagnostic"]["code"],
            "SNAPBACK_AUTH_SENDER_PROOF_AUTHORITY_UNAVAILABLE",
            "{path}",
        );
    }
    state
        .snapback
        .try_lock()
        .expect("borrow sender replay authority for grant repair")
        .restore_sender_proof_after_test_outage()
        .expect("repair grant replay authority");

    let bare_grant = router
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/outbox/{connection_id}"))
                .header(super::CONNECTION_TOKEN_HEADER, connection_token.as_str())
                .header("x-snapback-auth-client-protocol", "1")
                .via_hosted_terminator(TEST_HOSTED_CLIENT_SOURCE)
                .body(Body::new(PanicOnPollBody))
                .expect("bare sender-bound grant request"),
        )
        .await
        .expect("refuse bare sender-bound grant");
    assert_eq!(bare_grant.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        bare_grant
            .headers()
            .get(super::SENDER_NONCE_HEADER)
            .and_then(|value| value.to_str().ok()),
        Some(nonce_five.as_str()),
    );
    assert_eq!(
        response_json(bare_grant).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_SENDER_PROOF_REQUIRED",
    );

    let outbox_proof = sender_key.resource_proof(
        "GET",
        &format!("https://app.example.test/outbox/{connection_id}"),
        &connection_token,
        &nonce_five,
        provider.now_ms() / 1_000,
        [39_u8; 16],
    );
    let outbox = router
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/outbox/{connection_id}"))
                .header(super::CONNECTION_TOKEN_HEADER, connection_token.as_str())
                .header("x-snapback-auth-client-protocol", "1")
                .via_hosted_terminator(TEST_HOSTED_CLIENT_SOURCE)
                .header(super::SENDER_PROOF_HEADER, outbox_proof)
                .body(Body::empty())
                .expect("proof-gated sender-bound grant request"),
        )
        .await
        .expect("admit proof-gated sender-bound grant");
    assert_eq!(outbox.status(), StatusCode::OK);
    let nonce_for_websocket = outbox
        .headers()
        .get(super::SENDER_NONCE_HEADER)
        .and_then(|value| value.to_str().ok())
        .expect("grant HTTP successor nonce")
        .to_owned();

    let websocket_proof = sender_key.resource_proof(
        "GET",
        &format!("https://app.example.test/live/{connection_id}/stream"),
        &connection_token,
        &nonce_for_websocket,
        provider.now_ms() / 1_000,
        [36_u8; 16],
    );
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind hosted sender websocket server");
    let address = listener
        .local_addr()
        .expect("hosted sender websocket address");
    let reset_state = state.clone();
    let server = tokio::spawn(async move {
        app(state)
            .bind(listener)
            .expect("bind hosted sender websocket app")
            .serve()
            .await
            .expect("serve hosted sender websocket app");
    });
    use tokio_tungstenite::tungstenite::client::IntoClientRequest as _;
    let mut websocket_request = format!("ws://{address}/live/{connection_id}/stream")
        .into_client_request()
        .expect("hosted sender websocket request");
    // Over the real listener the immediate peer IS loopback, so unlike
    // the oneshot sites only the terminator's forwarded header is needed.
    websocket_request.headers_mut().insert(
        crate::auth::effective_source::FORWARDED_HEADER,
        TEST_HOSTED_CLIENT_SOURCE
            .parse()
            .expect("hosted websocket client source"),
    );
    websocket_request.headers_mut().insert(
        header::SEC_WEBSOCKET_PROTOCOL,
        format!(
            "{}, {}{}, snapback.auth-client.1, snapback.authority-descriptor.1, {}{}",
            super::LIVE_STREAM_SUBPROTOCOL,
            super::CONNECTION_TOKEN_SUBPROTOCOL_PREFIX,
            connection_token,
            super::SENDER_PROOF_SUBPROTOCOL_PREFIX,
            websocket_proof,
        )
        .parse()
        .expect("hosted sender websocket protocols"),
    );
    let (mut socket, response) = tokio_tungstenite::connect_async(websocket_request)
        .await
        .expect("connect sender-bound websocket");
    assert_eq!(
        response.headers().get(header::SEC_WEBSOCKET_PROTOCOL),
        Some(&HeaderValue::from_static(super::LIVE_STREAM_SUBPROTOCOL)),
    );
    let nonce_six = response
        .headers()
        .get(super::SENDER_NONCE_HEADER)
        .and_then(|value| value.to_str().ok())
        .filter(|value| value.len() == 43)
        .expect("websocket successor nonce")
        .to_owned();
    // @ref LLP 0077#author-decisions--2026-07-23 — decision 5: the FIRST
    // server frame delivers the exact successor the 101 header carried
    // (which browser JavaScript cannot read); it precedes every
    // application-visible frame and is the client's flight-release event.
    let first_frame = tokio::time::timeout(Duration::from_secs(5), socket.next())
        .await
        .expect("first sender-bound server frame within budget")
        .expect("sender-bound socket yields a first frame")
        .expect("first sender-bound frame is readable");
    let tokio_tungstenite::tungstenite::Message::Text(first_frame) = first_frame else {
        panic!("the first sender-bound server frame must be text");
    };
    let first_frame: Value =
        serde_json::from_str(&first_frame).expect("parse first sender-bound frame");
    assert_eq!(first_frame["kind"], "sender_nonce");
    assert_eq!(
        first_frame["nonce"].as_str(),
        Some(nonce_six.as_str()),
        "the in-band successor equals the 101 DPoP-Nonce value",
    );
    socket
        .close(None)
        .await
        .expect("close hosted sender socket");
    server.abort();
    let _ = server.await;

    let reset_admission = test_route_admission(&reset_state).0;
    coordinated_app_reset(&reset_state, &reset_admission, None)
        .await
        .expect("reset hosted sender authority");
    assert!(
        reset_state
            .connections
            .verify(&connection_id, Some(&connection_token))
            .is_err(),
        "reset terminalizes the sender-bound connection grant",
    );

    let stale_post_reset_proof = sender_key.resource_proof(
        "GET",
        "https://app.example.test/auth/session",
        &bearer_two,
        &nonce_six,
        provider.now_ms() / 1_000,
        [37_u8; 16],
    );
    let mut stale_post_reset_request = Request::builder()
        .method("GET")
        .uri("/auth/session")
        .header(header::AUTHORIZATION, format!("Bearer {bearer_two}"))
        .header(super::SENDER_PROOF_HEADER, stale_post_reset_proof)
        .body(Body::new(PanicOnPollBody))
        .expect("stale post-reset sender request");
    offer_auth_client_protocol(&mut stale_post_reset_request);
    let stale_post_reset_request =
        via_hosted_terminator(stale_post_reset_request, TEST_HOSTED_CLIENT_SOURCE);
    let stale_post_reset = app(reset_state)
        .oneshot(stale_post_reset_request)
        .await
        .expect("refuse stale post-reset sender request");
    assert_eq!(stale_post_reset.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        stale_post_reset
            .headers()
            .get(super::SENDER_NONCE_HEADER)
            .and_then(|value| value.to_str().ok())
            .map(str::len),
        Some(43),
        "an unknown post-reset carrier receives only an uninstalled cover nonce",
    );
    assert_eq!(
        response_json(stale_post_reset).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_SENDER_PROOF_REQUIRED",
    );
}

#[tokio::test]
async fn sender_bound_grant_invalidates_when_the_sender_replay_epoch_advances() {
    // @ref LLP 0059#boundgrantauthorityv2--sender-bound-grants-amendment-2026-07-23
    // — the grant records the durable issuance epoch and closes, with no
    // challenge, once the namespace advances past it; the session family
    // itself survives and re-opens a fresh grant under the new epoch.
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
    let state = state
        .with_hosted_serving_authority(hosted_serving_authority(now_ms))
        .expect("install hosted sender authority");
    let router = app(state.clone());

    let (challenge_id, code) =
        request_hosted_sender_challenge(&router, &provider, "epoch-grant@example.com").await;
    let sender_key = HostedSenderProofKey::generate();
    let issuance_proof =
        sender_key.issuance_proof(&challenge_id, provider.now_ms() / 1_000, [61_u8; 16]);
    let exchange = hosted_sender_exchange_response(
        &router,
        &challenge_id,
        &code,
        sender_key.public_jwk(),
        &issuance_proof,
    )
    .await;
    assert_eq!(exchange.status(), StatusCode::OK);
    let nonce_one = exchange
        .headers()
        .get(super::SENDER_NONCE_HEADER)
        .and_then(|value| value.to_str().ok())
        .expect("issuance successor nonce")
        .to_owned();
    let bearer = response_json(exchange).await["token"]
        .as_str()
        .expect("issued hosted sender bearer")
        .to_owned();

    let open_grant = |nonce: String, proof_id: [u8; 16]| {
        let proof = sender_key.resource_proof(
            "POST",
            "https://app.example.test/connection/open",
            &bearer,
            &nonce,
            provider.now_ms() / 1_000,
            proof_id,
        );
        let mut request = connection_open_request(Some(&bearer), json!({}));
        request.headers_mut().insert(
            HeaderName::from_static(super::SENDER_PROOF_HEADER),
            HeaderValue::from_str(&proof).expect("sender connection-open proof header"),
        );
        request
    };
    let opened = router
        .clone()
        .oneshot(open_grant(nonce_one, [62_u8; 16]))
        .await
        .expect("open sender-bound grant");
    assert_eq!(opened.status(), StatusCode::OK);
    let grant = response_json(opened).await;
    let connection_id = grant["connectionId"]
        .as_str()
        .expect("connection id")
        .to_owned();
    let connection_token = grant["connectionToken"]
        .as_str()
        .expect("connection token")
        .to_owned();

    // Advance the durable sender namespace exactly as the stream-reset
    // transaction does: epoch + 1 with both tables cleared.
    {
        let mut snapback = state
            .snapback
            .try_lock()
            .expect("borrow sender authority for epoch advance");
        snapback
            .remainder_auth_fixture()
            .auth_catalog()
            .advance_sender_replay_epoch_for_test()
            .expect("advance durable sender replay epoch");
    }

    // The stale grant is closed outright — no nonce challenge, because a
    // dead grant must not become a nonce-issuance oracle.
    let stale = router
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/outbox/{connection_id}"))
                .header(super::CONNECTION_TOKEN_HEADER, connection_token.as_str())
                .header("x-snapback-auth-client-protocol", "1")
                .via_hosted_terminator(TEST_HOSTED_CLIENT_SOURCE)
                .body(Body::new(PanicOnPollBody))
                .expect("stale-epoch grant request"),
        )
        .await
        .expect("refuse stale-epoch sender-bound grant");
    assert_eq!(stale.status(), StatusCode::UNAUTHORIZED);
    assert!(stale.headers().get(super::SENDER_NONCE_HEADER).is_none());
    assert_eq!(
        response_json(stale).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_SENDER_PROOF_INVALID",
    );

    // The session family survives the epoch advance: one bounded
    // challenge resynchronizes the nonce and a fresh connection-open
    // mints a successor grant bound to the new epoch.
    let mut challenge_request = Request::builder()
        .method("GET")
        .uri("/auth/session")
        .header(header::AUTHORIZATION, format!("Bearer {bearer}"))
        .body(Body::empty())
        .expect("post-advance nonce challenge request");
    offer_auth_client_protocol(&mut challenge_request);
    let challenge_request = via_hosted_terminator(challenge_request, TEST_HOSTED_CLIENT_SOURCE);
    let challenge = router
        .clone()
        .oneshot(challenge_request)
        .await
        .expect("post-advance nonce challenge");
    assert_eq!(challenge.status(), StatusCode::UNAUTHORIZED);
    let fresh_nonce = challenge
        .headers()
        .get(super::SENDER_NONCE_HEADER)
        .and_then(|value| value.to_str().ok())
        .expect("fresh post-advance nonce")
        .to_owned();
    let reopened = router
        .clone()
        .oneshot(open_grant(fresh_nonce, [63_u8; 16]))
        .await
        .expect("reopen sender-bound grant under the new epoch");
    assert_eq!(reopened.status(), StatusCode::OK);
}

#[tokio::test]
async fn committed_logout_with_lost_response_recovers_through_the_sender_tombstone() {
    // @ref LLP 0077#issuance-refresh-and-recovery — decision 2: after a
    // committed logout whose response was lost, the next signed request
    // resolves against the bounded revoked-family tombstone, receives the
    // terminal durableDelete outcome (no nonce, before body polling), and
    // its proof id still burns in the shared replay authority.
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
    let state = state
        .with_hosted_serving_authority(hosted_serving_authority(now_ms))
        .expect("install hosted sender authority");
    let router = app(state.clone());

    let (challenge_id, code) =
        request_hosted_sender_challenge(&router, &provider, "tombstone@example.com").await;
    let sender_key = HostedSenderProofKey::generate();
    let issuance_proof =
        sender_key.issuance_proof(&challenge_id, provider.now_ms() / 1_000, [71_u8; 16]);
    let exchange = hosted_sender_exchange_response(
        &router,
        &challenge_id,
        &code,
        sender_key.public_jwk(),
        &issuance_proof,
    )
    .await;
    assert_eq!(exchange.status(), StatusCode::OK);
    let nonce_one = exchange
        .headers()
        .get(super::SENDER_NONCE_HEADER)
        .and_then(|value| value.to_str().ok())
        .expect("issuance successor nonce")
        .to_owned();
    let bearer = response_json(exchange).await["token"]
        .as_str()
        .expect("issued hosted sender bearer")
        .to_owned();

    // Commit the logout; the response (and its terminal fact) is
    // "lost" — the client never observes it.
    let logout_proof = sender_key.resource_proof(
        "POST",
        "https://app.example.test/auth/logout",
        &bearer,
        &nonce_one,
        provider.now_ms() / 1_000,
        [72_u8; 16],
    );
    let mut logout = session_auth_http_request(
        "/auth/logout",
        serde_json::to_vec(&json!({})).unwrap(),
        &bearer,
    );
    logout.headers_mut().insert(
        HeaderName::from_static(super::SENDER_PROOF_HEADER),
        HeaderValue::from_str(&logout_proof).expect("sender logout proof header"),
    );
    let logout = router
        .clone()
        .oneshot(logout)
        .await
        .expect("commit hosted sender logout");
    assert_eq!(logout.status(), StatusCode::NO_CONTENT);

    // The stranded custody's next signed request: the nonce is
    // consumed-unknown, so the proof carries an arbitrary stale value.
    // It must obtain the terminal durableDelete outcome pre-body with no
    // nonce header — not a challenge loop.
    let stale_nonce = "m".repeat(43);
    let terminal_proof = sender_key.resource_proof(
        "GET",
        "https://app.example.test/auth/session",
        &bearer,
        &stale_nonce,
        provider.now_ms() / 1_000,
        [73_u8; 16],
    );
    let mut terminal_request = Request::builder()
        .method("GET")
        .uri("/auth/session")
        .header(header::AUTHORIZATION, format!("Bearer {bearer}"))
        .header(super::SENDER_PROOF_HEADER, terminal_proof.clone())
        .body(Body::new(PanicOnPollBody))
        .expect("post-logout signed request");
    offer_auth_client_protocol(&mut terminal_request);
    let terminal_request = via_hosted_terminator(terminal_request, TEST_HOSTED_CLIENT_SOURCE);
    let terminal = router
        .clone()
        .oneshot(terminal_request)
        .await
        .expect("deliver terminal durableDelete outcome");
    assert_eq!(terminal.status(), StatusCode::UNAUTHORIZED);
    let terminal_nonce_header = terminal.headers().get(super::SENDER_NONCE_HEADER).cloned();
    let terminal_body = response_json(terminal).await;
    assert!(
        terminal_nonce_header.is_none(),
        "a tombstoned family never rotates or freshly generates a nonce: {terminal_body}",
    );
    assert_eq!(
        terminal_body["diagnostic"]["code"],
        "SNAPBACK_AUTH_SESSION_EXPIRED",
    );
    assert_eq!(
        terminal_body["diagnostic"]["details"]["authorityDisposition"],
        "durableDelete",
    );

    // The terminal outcome still consumed its proof id.
    let mut replay_request = Request::builder()
        .method("GET")
        .uri("/auth/session")
        .header(header::AUTHORIZATION, format!("Bearer {bearer}"))
        .header(super::SENDER_PROOF_HEADER, terminal_proof)
        .body(Body::new(PanicOnPollBody))
        .expect("replayed post-logout request");
    offer_auth_client_protocol(&mut replay_request);
    let replay_request = via_hosted_terminator(replay_request, TEST_HOSTED_CLIENT_SOURCE);
    let replayed = router
        .clone()
        .oneshot(replay_request)
        .await
        .expect("refuse replayed post-logout proof");
    assert_eq!(replayed.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        response_json(replayed).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_SENDER_PROOF_REPLAYED",
    );

    // Without a proof the tombstone stays private behind the ordinary
    // anti-oracle challenge.
    let mut bare_request = Request::builder()
        .method("GET")
        .uri("/auth/session")
        .header(header::AUTHORIZATION, format!("Bearer {bearer}"))
        .body(Body::empty())
        .expect("bare post-logout request");
    offer_auth_client_protocol(&mut bare_request);
    let bare_request = via_hosted_terminator(bare_request, TEST_HOSTED_CLIENT_SOURCE);
    let bare = router
        .clone()
        .oneshot(bare_request)
        .await
        .expect("cover-challenge the bare post-logout carrier");
    assert_eq!(bare.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        response_json(bare).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_SENDER_PROOF_REQUIRED",
    );
}

#[tokio::test]
async fn route_middleware_installs_generation_and_epoch_bound_prepared_authority() {
    async fn echo_authority(Extension(authority): Extension<PreparedAuthority>) -> Json<Value> {
        Json(json!({
            "transitionGeneration": authority.transition_generation(),
            "admissionEpoch": authority.admission_epoch(),
            "userId": authority.projection().user_id(),
            "authenticated": authority.projection().is_authenticated(),
        }))
    }

    let (state, _) = auth_runtime_fixture(PolicyAuthMode::Dev);
    let mut mode = AuthModeStateRecord::initial_dev(None);
    mode.transition_generation = 4;
    let state = state
        .with_auth_runtime_facts(mode, AuthProgramReadiness::item4(false))
        .expect("install durable mode");
    let admission_epoch = state
        .auth_admission_controller()
        .diagnostic_snapshot()
        .admission_epoch;
    let router = super::router_from_registrations(
        vec![
            super::RegisteredRoute::new(
                super::app_auth_route("POST", "/query/{name}"),
                axum::routing::post(echo_authority),
            ),
            super::RegisteredRoute::new(
                super::app_auth_route("POST", "/mutation/{name}"),
                axum::routing::post(echo_authority),
            ),
        ],
        state.clone(),
    )
    .with_state(state);
    for uri in ["/query/authority", "/mutation/authority"] {
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(uri)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(r#"{"args":{},"auth":{"user_id":"user-1"}}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK, "{uri}");
        assert_eq!(
            response_json(response).await,
            json!({
                "transitionGeneration": 4,
                "admissionEpoch": admission_epoch,
                "userId": "user-1",
                "authenticated": true,
            }),
            "{uri}"
        );
    }
}

#[tokio::test]
async fn startup_resolution_carries_declared_posture_and_absent_legacy_posture_to_identity_route() {
    let (declared_context, legacy_context) = {
        let _environment_lock = DEV_ADMISSION_ENV_TEST_LOCK
            .get_or_init(|| StdMutex::new(()))
            .lock()
            .unwrap();
        let _restore = DevAdmissionEnvironmentRestore::capture();
        unsafe {
            std::env::set_var("SNAPBACK_PROFILE", "dev");
            std::env::remove_var("SNAPBACK_DEV_AUTH_ORIGINS");
            std::env::set_var("SNAPBACK_DEV_ADMISSION_POSTURE", "hostile-ambient-value");
        }
        let hostile_error = match crate::admin::resolve_server_startup(true) {
            Ok(_) => panic!("an unrecognized inherited posture must refuse startup"),
            Err(error) => error,
        };
        assert_eq!(
            hostile_error.diagnostic.code,
            "SNAPBACK_DEV_ADMISSION_POSTURE_INVALID"
        );

        unsafe {
            std::env::set_var("SNAPBACK_DEV_ADMISSION_POSTURE", "loopback-any");
        }
        let declared = crate::admin::resolve_server_startup(true)
            .expect("valid declared posture resolves at startup");
        let mut declared_context =
            ServerContext::new_with_startup_resolution("127.0.0.1", 4287, declared);
        declared_context.record_bound_address("127.0.0.1:4287".parse().unwrap());

        unsafe {
            std::env::remove_var("SNAPBACK_DEV_ADMISSION_POSTURE");
        }
        let legacy = crate::admin::resolve_server_startup(true)
            .expect("absent posture preserves legacy startup");
        let mut legacy_context =
            ServerContext::new_with_startup_resolution("127.0.0.1", 4287, legacy);
        legacy_context.record_bound_address("127.0.0.1:4287".parse().unwrap());
        (declared_context, legacy_context)
    };

    for (context, expected_posture) in [
        (declared_context, "loopback-any"),
        (legacy_context, "explicit-list"),
    ] {
        let state = test_app_state_from_snapback(
            LocalSnapback::memory().expect("startup-resolution identity fixture"),
            context,
        );
        let deployment = DeploymentIdentity {
            schema_version: "snapback.v0".to_owned(),
            auth_mode: AuthMode::Dev,
            app_id: format!("startup-resolution-{expected_posture}"),
            schema_hash: "sha256:startup-resolution-schema".to_owned(),
            bundle_hash: "sha256:startup-resolution-functions".to_owned(),
            inputs_hash: "sha256:startup-resolution-inputs".to_owned(),
        };
        deployment.validate().expect("valid startup identity");
        let readiness = state.auth_program_readiness().clone();
        let state = state
            .with_auth_runtime_facts(
                AuthModeStateRecord::initial_dev(Some(deployment)),
                readiness,
            )
            .expect("install startup-resolution deployment");
        let response = app(state)
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/_snapback/api/app/identity")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK, "{expected_posture}");
        assert_eq!(
            response_json(response).await["admissionPosture"],
            expected_posture,
            "{expected_posture}"
        );
    }
}

#[tokio::test]
async fn app_identity_dev_route_is_exact_uncached_originless_and_get_only() {
    let mut context = bound_loopback_context();
    context.profile = ServerProfile::Dev;
    context.use_loopback_any_dev_admission_for_test();
    let state = test_app_state_from_snapback(
        LocalSnapback::memory().expect("application identity fixture"),
        context,
    );
    let expected_deployment = DeploymentIdentity {
        schema_version: "snapback.v0".to_owned(),
        auth_mode: AuthMode::Dev,
        app_id: "identity-route-fixture".to_owned(),
        schema_hash: "sha256:identity-schema".to_owned(),
        bundle_hash: "sha256:identity-functions".to_owned(),
        inputs_hash: "sha256:identity-inputs".to_owned(),
    };
    expected_deployment.validate().expect("valid dev identity");
    let auth_program_readiness = state.auth_program_readiness().clone();
    let state = state
        .with_auth_runtime_facts(
            AuthModeStateRecord::initial_dev(Some(expected_deployment.clone())),
            auth_program_readiness,
        )
        .expect("install active development deployment");
    let router = app(state);

    let response = router
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/_snapback/api/app/identity")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
    assert!(response.headers().get(header::ETAG).is_none());
    assert!(response.headers().get(header::LAST_MODIFIED).is_none());
    assert!(response.headers().get(header::LOCATION).is_none());
    let body = response_json(response).await;
    assert_eq!(
        body.as_object()
            .expect("identity response object")
            .keys()
            .cloned()
            .collect::<BTreeSet<_>>(),
        BTreeSet::from([
            "admissionPosture".to_owned(),
            "deployment".to_owned(),
            "formatVersion".to_owned(),
        ])
    );
    assert_eq!(body["formatVersion"], "snapback.app-identity.v1");
    assert_eq!(
        body["deployment"],
        serde_json::to_value(&expected_deployment).unwrap()
    );
    assert_eq!(body["admissionPosture"], "loopback-any");

    for (origin, admitted) in [
        ("http://localhost:59999", true),
        ("http://attacker.dev", false),
    ] {
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/_snapback/api/app/identity")
                    .header(header::ORIGIN, origin)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response
                .headers()
                .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
                .and_then(|value| value.to_str().ok()),
            admitted.then_some(origin),
            "{origin}"
        );
    }

    for method in ["HEAD", "POST", "OPTIONS"] {
        let refused = router
            .clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri("/_snapback/api/app/identity")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(refused.status(), StatusCode::METHOD_NOT_ALLOWED, "{method}");
    }

    let mut explicit_context = bound_loopback_context();
    explicit_context.profile = ServerProfile::Dev;
    explicit_context.dev_admission_posture = Some(crate::admin::DevAdmissionPosture::ExplicitList);
    explicit_context.dev_auth_origins =
        BTreeSet::from(["https://lane.trycloudflare.com".to_owned()]);
    let explicit_state = test_app_state_from_snapback(
        LocalSnapback::memory().expect("explicit-list identity fixture"),
        explicit_context,
    );
    let explicit_readiness = explicit_state.auth_program_readiness().clone();
    let explicit_state = explicit_state
        .with_auth_runtime_facts(
            AuthModeStateRecord::initial_dev(Some(expected_deployment)),
            explicit_readiness,
        )
        .expect("install explicit-list active deployment");
    let explicit_router = app(explicit_state);
    let response = explicit_router
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/_snapback/api/app/identity")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response_json(response).await["admissionPosture"],
        "explicit-list"
    );

    for (origin, expected_acao) in [
        (
            "https://lane.trycloudflare.com",
            Some("https://lane.trycloudflare.com"),
        ),
        ("http://localhost:59999", None),
    ] {
        let response = explicit_router
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/_snapback/api/app/identity")
                    .header(header::ORIGIN, origin)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK, "{origin}");
        assert_eq!(
            response
                .headers()
                .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
                .and_then(|value| value.to_str().ok()),
            expected_acao,
            "{origin}"
        );
    }
}

#[tokio::test]
async fn app_identity_route_is_unavailable_on_demo_and_test_profiles() {
    for profile in [ServerProfile::Demo, ServerProfile::Test] {
        let mut context = bound_loopback_context();
        context.profile = profile;
        context.use_loopback_any_dev_admission_for_test();
        let state = test_app_state_from_snapback(
            LocalSnapback::memory().expect("non-dev identity fixture"),
            context,
        );
        let response = app(state)
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/_snapback/api/app/identity")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND, "{profile:?}");
        assert_eq!(
            response_json(response).await["diagnostic"]["code"],
            "SNAPBACK_APP_IDENTITY_UNAVAILABLE",
            "{profile:?}"
        );
    }
}

#[tokio::test]
async fn app_identity_prod_route_is_typed_not_found() {
    let mut context = bound_loopback_context();
    context.profile = ServerProfile::Prod;
    context.use_loopback_any_dev_admission_for_test();
    let mut state = test_app_state_from_snapback(
        LocalSnapback::memory().expect("production application identity fixture"),
        context,
    );
    Arc::make_mut(&mut state.server).auth_deployment =
        crate::auth::deployment::AuthDeploymentTarget::Hosted;
    let state = state
        .with_hosted_serving_authority(hosted_serving_authority(super::now_millis()))
        .expect("install production hosted authority");
    let response = app(state)
        .oneshot(via_hosted_terminator(
            Request::builder()
                .method("GET")
                .uri("/_snapback/api/app/identity")
                .body(Body::empty())
                .unwrap(),
            TEST_HOSTED_CLIENT_SOURCE,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
    assert_eq!(
        response_json(response).await["diagnostic"]["code"],
        "SNAPBACK_APP_IDENTITY_UNAVAILABLE"
    );
}

#[tokio::test]
async fn dev_identity_exposure_witness_header_excludes_unverified_host_op_authority() {
    async fn echo_authority(Extension(authority): Extension<PreparedAuthority>) -> Json<Value> {
        Json(json!({ "userId": authority.projection().user_id() }))
    }

    let (state, impersonation_capability) = auth_runtime_fixture(PolicyAuthMode::Dev);
    let (registry, _) = dev_identity_capability_fixture();
    let state = state.with_dev_identity_capabilities(registry);
    let router = super::router_from_registrations(
        vec![super::RegisteredRoute::new(
            super::system_api_route(
                "POST",
                "/_snapback/api/host-ops",
                super::RoutePolicy::AdminRead,
                super::ResponseSensitivity::SensitiveApplicationData,
            )
            .with_effect(super::EffectPolicy::OperationSpecific),
            axum::routing::post(echo_authority),
        )],
        state.clone(),
    )
    .with_state(state);
    let response = router
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/_snapback/api/host-ops")
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-snapback-admin-token", "auth-http-admin")
                .header(
                    crate::admin_impersonation::IMPERSONATION_CAPABILITY_HEADER,
                    impersonation_capability,
                )
                .header(
                    crate::dev_identity::DEV_IDENTITY_CAPABILITY_HEADER,
                    "sbdev_bogus-but-present",
                )
                .body(Body::from(
                    r#"{"operation":"function.run","function":"unknown","userId":"user-1","args":{}}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert!(
        response
            .headers()
            .get(crate::dev_identity::DEV_IDENTITY_CAPABILITY_WITNESS_HEADER)
            .is_none(),
        "an OQ2 host-op authority must not report an unverified capability header"
    );
    assert_eq!(response_json(response).await["userId"], "user-1");
}

#[tokio::test]
async fn session_bearer_is_resolved_for_each_online_invocation_request() {
    async fn echo_authority(Extension(authority): Extension<PreparedAuthority>) -> Json<Value> {
        Json(json!({
            "userId": authority.projection().user_id(),
            "sessionId": authority.projection().session_id(),
            "authenticated": authority.projection().is_authenticated(),
        }))
    }

    let (state, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
    let item5 = AuthProgramReadiness::new(true, true, true, true, false, false, false);
    let state = state
        .with_auth_runtime_facts(settled_sessions_state(), item5)
        .expect("install item-5 sessions fixture");
    let credential = mint_test_credential(&state, "query@example.com").await;
    let token = credential["token"].as_str().unwrap();
    let router = super::router_from_registrations(
        vec![super::RegisteredRoute::new(
            super::app_auth_route("POST", "/query/{name}"),
            axum::routing::post(echo_authority),
        )],
        state.clone(),
    )
    .with_state(state);
    let response = router
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/query/authority")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::AUTHORIZATION, format!("Bearer {token}"))
                .header("x-snapback-auth-client-protocol", "1")
                .via_hosted_terminator(TEST_HOSTED_CLIENT_SOURCE)
                .body(Body::from(r#"{"args":{}}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response_json(response).await,
        json!({
            "userId": credential["session"]["userId"],
            "sessionId": credential["session"]["id"],
            "authenticated": true,
        })
    );
}

#[tokio::test]
async fn scoped_token_carrier_is_resolved_only_for_granted_current_function_scope() {
    async fn prepare_query(
        AxumPath(name): AxumPath<String>,
        Extension(authority): Extension<PreparedAuthority>,
    ) -> Result<Json<super::FunctionResponse<Value>>, super::ApiError> {
        let function = FunctionDefinition::new(
            name,
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
        let attribution = authority.function_attribution();
        let prepared = InvocationGate::prepare_function(authority, &function)
            .map_err(super::ApiError::from)
            .map_err(|error| error.with_attribution(attribution.clone()))?;
        Ok(Json(super::FunctionResponse::new(
            serde_json::to_value(prepared.projection()).unwrap(),
            attribution,
        )))
    }

    let state = sessions_activation_server_fixture_with_agents_async(agent_policy(
        AgentsMode::Open,
        InvitedBy::Operators,
    ))
    .await;
    let provider = state.auth_provider.clone().unwrap();
    let now_ms = provider.now_ms();
    let (agent_user_id, token, agent_credential) =
        with_snapback(&state.snapback, move |snapback| {
            let mut db = snapback.remainder_auth_fixture();
            db.auth_catalog()
                .insert_query_carrier_prerequisites_for_test(now_ms)?;
            let credential = db.register_agent_principal(
                None,
                Some("Carrier Test Agent".to_owned()),
                None,
                ServerProfile::Test,
                now_ms,
                &OsRandom,
            )?;
            db.auth_catalog()
                .insert_query_carrier_grant_for_test(&credential.user_id, now_ms)?;
            let issued = db.mint_scoped_token(
                &credential.secret,
                "018f0d90-7b32-7a22-8c33-445566778899",
                None,
                now_ms,
                &OsRandom,
            )?;
            Ok::<_, SnapbackError>((
                credential.user_id,
                issued.secret.expose_secret().to_owned(),
                credential.secret.expose_secret().to_owned(),
            ))
        })
        .await
        .unwrap();

    let connection_router = super::app(state.clone());
    let handshake = connection_router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/auth/session")
                .header(header::AUTHORIZATION, format!("Bearer {token}"))
                .header("x-snapback-auth-client-protocol", "1")
                .via_hosted_terminator(TEST_HOSTED_CLIENT_SOURCE)
                .header("x-snapback-authority-descriptor-protocol", "1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(handshake.status(), StatusCode::OK);
    let handshake = response_json(handshake).await;
    assert_eq!(handshake["authority"]["kind"], "servicePrincipal");
    assert_eq!(handshake["authority"]["isAuthenticated"], true);
    assert_eq!(
        handshake["authority"]["userId"],
        "018f0d90-7b30-7a22-8c33-445566778899"
    );
    assert_eq!(handshake["authority"]["sessionId"], Value::Null);
    assert_eq!(handshake["authorityDescriptor"]["descriptorVersion"], 1);
    assert_eq!(handshake["authorityDescriptor"]["sessionGeneration"], 0);
    let authority_descriptor = handshake["authorityDescriptor"].clone();

    // This is the real HTTP shape emitted by AgentAuthorityFence: the
    // scoped bearer remains the credential, while queued replay carries
    // the exact descriptor learned from /auth/session. The server must
    // preserve the agent/effective-user attribution through the durable
    // idempotency and receipt boundary.
    let queued = connection_router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/mutation/queuedWrite")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::AUTHORIZATION, format!("Bearer {token}"))
                .header("x-snapback-auth-client-protocol", "1")
                .via_hosted_terminator(TEST_HOSTED_CLIENT_SOURCE)
                .header("x-snapback-authority-descriptor-protocol", "1")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "args": { "value": "queued-agent-visible" },
                        "clientMutationId": "cm_agent_queued_1",
                        "authorityDescriptor": authority_descriptor.clone(),
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let queued_status = queued.status();
    let queued = response_json(queued).await;
    assert_eq!(
        queued_status,
        StatusCode::OK,
        "unexpected scoped queued mutation response: {queued}"
    );
    assert_eq!(queued["changed_count"], 1);
    assert_eq!(queued["receipt"]["kind"], "mutation");
    assert_eq!(queued["receipt"]["mutationId"], "cm_agent_queued_1");
    assert_eq!(queued["receipt"]["mutation"], "queuedWrite");
    assert_eq!(queued["receipt"]["outcome"], "confirmed");
    assert_eq!(queued["receipt"]["transport"], "http");
    assert_eq!(
        queued["facts"],
        json!({
            "activeGeneration": {
                "schemaVersion": "snapback.v1",
                "appId": "auth-activation-fixture",
                "schemaHash": format!("{SCHEMA_V1_PREFIX}{}", "1".repeat(64)),
                "bundleHash": format!("{FUNCTION_V1_PREFIX}{}", "2".repeat(64)),
                "inputsHash": format!("{INPUTS_V1_PREFIX}{}", "3".repeat(64)),
            }
        }),
        "an applied mutation carries the exact active generation facts"
    );
    assert_eq!(
        queued["authorityDescriptor"], authority_descriptor,
        "the settlement response must echo the exact descriptor that owns its ACK cohort"
    );
    assert_eq!(
        queued["attribution"],
        json!({
            "actorUserId": agent_user_id,
            "effectiveUserId": "018f0d90-7b30-7a22-8c33-445566778899",
            "grantId": "018f0d90-7b32-7a22-8c33-445566778899",
            "dryRun": false
        })
    );

    let opened = connection_router
        .clone()
        .oneshot(connection_open_request(
            Some(&token),
            json!({ "authInvalidationProtocol": 1 }),
        ))
        .await
        .unwrap();
    assert_eq!(opened.status(), StatusCode::OK);
    assert_eq!(
        opened.headers().get(header::CACHE_CONTROL).unwrap(),
        "no-store, private"
    );
    let opened = response_json(opened).await;
    let connection_id = opened["connectionId"].as_str().unwrap();
    let connection_token = opened["connectionToken"].as_str().unwrap();
    assert_eq!(opened["authorizationInvalidation"]["protocolVersion"], 1);
    state.connections.lock().assert_grant_indexes_consistent();

    let subscribed = connection_router
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
                            "clientStoreId": "agent-store",
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
    assert_eq!(
        subscribed_status,
        StatusCode::OK,
        "unexpected service live response: {subscribed}"
    );
    let subscribed_values = subscribed["snapshot"]["rows"]
        .as_array()
        .expect("live snapshot rows")
        .iter()
        .filter_map(|row| row["value"].as_str())
        .collect::<BTreeSet<_>>();
    assert!(subscribed_values.contains("predecessor-visible"));
    assert!(subscribed_values.contains("queued-agent-visible"));
    assert!(subscribed["authorizationScope"].is_object());
    // Live establishment carries the same server-derived block as the
    // finite lanes (LLP 0055 §Audit; the LLP 0062 live wire seam).
    assert_eq!(subscribed["attribution"], queued["attribution"]);

    let wrong_open = connection_router
        .clone()
        .oneshot(connection_open_request(Some(&agent_credential), json!({})))
        .await
        .unwrap();
    assert_eq!(wrong_open.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        response_json(wrong_open).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_CREDENTIAL_CLASS_MISMATCH"
    );

    let live = connection_router
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/live/{connection_id}/stream"))
                .header("x-snapback-auth-client-protocol", "1")
                .via_hosted_terminator(TEST_HOSTED_CLIENT_SOURCE)
                .header(super::CONNECTION_TOKEN_HEADER, connection_token)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        live.status(),
        StatusCode::BAD_REQUEST,
        "service-principal live reaches the WebSocket protocol extractor"
    );

    let router = super::router_from_registrations(
        vec![
            super::RegisteredRoute::new(
                super::app_function_route("POST", "/query/{name}"),
                axum::routing::post(prepare_query),
            ),
            super::RegisteredRoute::new(
                super::app_auth_route("POST", "/query/{name}/authorized-lease"),
                axum::routing::post(prepare_query),
            ),
        ],
        state.clone(),
    )
    .with_state(state.clone());
    let request = |uri: &str, bearer: &str| {
        Request::builder()
            .method("POST")
            .uri(uri)
            .header(header::CONTENT_TYPE, "application/json")
            .header(header::AUTHORIZATION, format!("Bearer {bearer}"))
            .header("x-snapback-auth-client-protocol", "1")
            .via_hosted_terminator(TEST_HOSTED_CLIENT_SOURCE)
            .body(Body::from(r#"{"args":{}}"#))
            .unwrap()
    };

    let allowed = router
        .clone()
        .oneshot(request("/query/allowed", &token))
        .await
        .unwrap();
    assert_eq!(allowed.status(), StatusCode::OK);
    let projection = response_json(allowed).await;
    assert_eq!(projection["userId"], "018f0d90-7b30-7a22-8c33-445566778899");
    assert_eq!(projection["kind"], "human");
    assert_eq!(projection["actor"]["userId"], agent_user_id);
    assert_eq!(
        projection["actor"]["grantId"],
        "018f0d90-7b32-7a22-8c33-445566778899"
    );
    assert_eq!(
        projection["attribution"],
        json!({
            "actorUserId": agent_user_id,
            "effectiveUserId": "018f0d90-7b30-7a22-8c33-445566778899",
            "grantId": "018f0d90-7b32-7a22-8c33-445566778899",
            "dryRun": false
        })
    );

    let denied = router
        .clone()
        .oneshot(request("/query/not-granted", &token))
        .await
        .unwrap();
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
    let denied = response_json(denied).await;
    assert_eq!(
        denied["diagnostic"]["code"],
        "SNAPBACK_AUTH_GRANT_SCOPE_DENIED"
    );
    assert_eq!(
        denied["diagnostic"]["details"]["functionId"],
        "fn:not-granted"
    );
    assert_eq!(
        denied["diagnostic"]["details"]["missingScope"]["kind"],
        "query"
    );
    assert_eq!(
        denied["diagnostic"]["details"]["missingScope"]["functionId"],
        "fn:not-granted"
    );
    let remediation = &denied["diagnostic"]["details"]["remediationSet"];
    assert_eq!(remediation["items"][0]["kind"], "requestGrant");
    assert_eq!(remediation["items"][0]["machineApplicable"], false);
    assert_eq!(remediation["items"][0]["requiresApproval"], true);
    assert_eq!(
        remediation["items"][0]["action"]["grantableScope"],
        "function:query:fn:not-granted"
    );
    assert_eq!(denied["attribution"], projection["attribution"]);

    let wrong_class = router
        .clone()
        .oneshot(request("/query/allowed", &agent_credential))
        .await
        .unwrap();
    assert_eq!(wrong_class.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        response_json(wrong_class).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_CREDENTIAL_CLASS_MISMATCH"
    );

    let retained = router
        .clone()
        .oneshot(request("/query/allowed/authorized-lease", &token))
        .await
        .unwrap();
    assert_eq!(retained.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        response_json(retained).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_CREDENTIAL_CLASS_MISMATCH"
    );

    with_snapback(&state.snapback, |snapback| {
        snapback
            .remainder_auth_fixture()
            .auth_catalog()
            .tombstone_allowed_query_scope_basis_for_test()
    })
    .await
    .unwrap();
    let stale = router
        .clone()
        .oneshot(request("/query/allowed", &token))
        .await
        .unwrap();
    assert_eq!(stale.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        response_json(stale).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_GRANT_SCOPE_DENIED"
    );

    let (grant_id, bound_token_id) = {
        let registry = state.connections.lock();
        let record = registry.grants.get(connection_id).expect("service grant");
        let BoundGrantAuthority::ServicePrincipal { token_id, .. } = &record.authority else {
            panic!("service connection retains exact token")
        };
        (record.grant_id.clone(), token_id.clone())
    };
    let notifier = state.ephemeral.delivery_notifier();
    let (generation, waker) = notifier
        .register_bound(connection_id, grant_id)
        .expect("register exact service socket");
    let revocation = with_snapback(&state.snapback, |snapback| {
        snapback.remainder_auth_fixture().revoke_grant_for_user(
            "018f0d90-7b30-7a22-8c33-445566778899",
            "018f0d90-7b32-7a22-8c33-445566778899",
            super::now_millis(),
        )
    })
    .await
    .unwrap();
    assert_eq!(revocation.token_ids, vec![bound_token_id]);
    state.auth_terminal_lifecycle.terminate_service_tokens(
        &revocation.token_ids,
        Instant::now() + Duration::from_secs(5),
    );
    tokio::time::timeout(Duration::from_secs(1), waker.notified())
        .await
        .expect("grant revocation wakes the exact service socket");
    let terminal = notifier
        .terminal_if_current(connection_id, generation)
        .expect("grant revocation installs a terminal frame");
    assert_eq!(
        terminal.code,
        crate::live_wire::LiveAuthErrorCode::ScopedTokenInvalid
    );
    assert_eq!(
        terminal.reason,
        crate::live_wire::LiveAuthErrorReason::Revoked
    );
    assert_eq!(
        terminal.authority_disposition,
        crate::live_wire::LiveAuthorityDisposition::DurableDelete
    );
    assert!(
        state
            .connections
            .prepare_act(
                connection_id,
                Some(connection_token),
                state.auth_coordinator.as_deref(),
                false,
                super::now_millis(),
                Instant::now(),
            )
            .is_err(),
        "revoked service carrier cannot act"
    );
    tokio::time::timeout(Duration::from_secs(1), async {
        while state.read.connection_has_auth_scoped_live(connection_id) {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("owned terminal cleanup purges the service subscription topology");

    let mut hosted = state;
    Arc::make_mut(&mut hosted.server).auth_deployment =
        crate::auth::deployment::AuthDeploymentTarget::Hosted;
    let hosted_router = super::router_from_registrations(
        vec![super::RegisteredRoute::new(
            super::app_function_route("POST", "/query/{name}"),
            axum::routing::post(prepare_query),
        )],
        hosted.clone(),
    )
    .with_state(hosted);
    let hosted = hosted_router
        .oneshot(request("/query/allowed", &token))
        .await
        .unwrap();
    assert_eq!(
        response_json(hosted).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_DEPLOYMENT_UNSUPPORTED"
    );
}

/// @ref LLP 0057#routes-operations-and-dtos — the HTTP projection enforces the
/// exact 4 KiB ceiling and collapses every closed-DTO parse failure to the
/// non-reflective auth diagnostic.
#[tokio::test]
async fn auth_http_json_is_closed_and_bounded_at_exactly_four_kibibytes() {
    let (router, _) = auth_http_fixture(PolicyAuthMode::Sessions);
    let mut exact = br#"{"email":"four-kib@example.com"}"#.to_vec();
    exact.resize(super::AUTH_REQUEST_BODY_LIMIT, b' ');
    let accepted = router
        .clone()
        .oneshot(auth_http_request(
            "POST",
            "/auth/request-code",
            exact.clone(),
            true,
            None,
            None,
        ))
        .await
        .expect("exact-limit provider request");
    assert_eq!(accepted.status(), StatusCode::OK);
    assert_eq!(
        accepted.headers()[header::CACHE_CONTROL],
        "no-store, private"
    );

    let mut oversized = exact;
    oversized.push(b' ');
    let invalid_bodies = [
        (oversized, true),
        (br#"{"email":"a@example.com","extra":true}"#.to_vec(), true),
        (
            br#"{"email":"a@example.com","email":"b@example.com"}"#.to_vec(),
            true,
        ),
        (br#"{"email":}"#.to_vec(), true),
        (br#"{"email":"a@example.com"}"#.to_vec(), false),
    ];
    for (body, content_type) in invalid_bodies {
        let response = router
            .clone()
            .oneshot(auth_http_request(
                "POST",
                "/auth/request-code",
                body,
                content_type,
                None,
                None,
            ))
            .await
            .expect("invalid provider request");
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert_eq!(
            response.headers()[header::CACHE_CONTROL],
            "no-store, private"
        );
        let body = response_json(response).await;
        assert_eq!(body["diagnostic"]["code"], "SNAPBACK_AUTH_REQUEST_INVALID");
        assert_eq!(
            body["diagnostic"]["details"],
            serde_json::json!({}),
            "parser internals must not be reflected"
        );
    }
}

/// @ref LLP 0057#email-code-provider — exercise the real request transaction,
/// exact gated mailbox projection, and known/unknown two-pass exchange
/// paths through the registered router.
#[tokio::test]
async fn auth_http_request_mailbox_exchange_flow_and_carriers_are_exact() {
    let (router, impersonation) = auth_http_fixture(PolicyAuthMode::Sessions);
    let request_code = router
        .clone()
        .oneshot(auth_http_request(
            "POST",
            "/auth/request-code",
            serde_json::to_vec(&serde_json::json!({"email": "Person@Example.com"})).unwrap(),
            true,
            None,
            None,
        ))
        .await
        .expect("request verification code");
    assert_eq!(request_code.status(), StatusCode::OK);
    assert_eq!(
        request_code.headers()[header::CACHE_CONTROL],
        "no-store, private"
    );
    let requested = response_json(request_code).await;
    assert_eq!(
        requested
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect::<BTreeSet<_>>(),
        BTreeSet::from(["challengeId".to_owned(), "expiresAt".to_owned()])
    );
    let challenge_id = requested["challengeId"].as_str().unwrap().to_owned();
    let mailbox_uri = format!("/_snapback/api/auth/mailbox?challengeId={challenge_id}");

    let effect_without_admin = router
        .clone()
        .oneshot(auth_http_request(
            "GET",
            &mailbox_uri,
            Vec::new(),
            false,
            None,
            Some(&impersonation),
        ))
        .await
        .expect("effect-only mailbox request");
    assert_ne!(effect_without_admin.status(), StatusCode::OK);
    assert_ne!(
        response_json(effect_without_admin).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_MAILBOX_ENTRY_NOT_FOUND",
        "the effect carrier cannot substitute for AdminWrite"
    );

    for presented_effect in [None, Some("sbs_not-an-impersonation-capability")] {
        let admin_without_effect = router
            .clone()
            .oneshot(auth_http_request(
                "GET",
                &mailbox_uri,
                Vec::new(),
                false,
                Some("auth-http-admin"),
                presented_effect,
            ))
            .await
            .expect("admin-only mailbox request");
        assert_eq!(admin_without_effect.status(), StatusCode::FORBIDDEN);
        assert_eq!(
            response_json(admin_without_effect).await["diagnostic"]["code"],
            "SNAPBACK_AUTH_IMPERSONATION_REQUIRED"
        );
    }

    let mailbox = router
        .clone()
        .oneshot(auth_http_request(
            "GET",
            &mailbox_uri,
            Vec::new(),
            false,
            Some("auth-http-admin"),
            Some(&impersonation),
        ))
        .await
        .expect("fully authorized mailbox request");
    assert_eq!(mailbox.status(), StatusCode::OK);
    assert_eq!(
        mailbox.headers()[header::CACHE_CONTROL],
        "no-store, private"
    );
    let mailbox = response_json(mailbox).await;
    assert_eq!(mailbox["challengeId"], challenge_id);
    assert_eq!(mailbox["canonicalAddress"], "person@example.com");
    let code = mailbox["code"].as_str().unwrap().to_owned();

    let wrong_code = if code == "000000" { "999999" } else { "000000" };
    let rejected_exchange = router
        .clone()
        .oneshot(auth_http_request(
            "POST",
            "/auth/exchange",
            serde_json::to_vec(&serde_json::json!({
                "challengeId": challenge_id,
                "code": wrong_code,
            }))
            .unwrap(),
            true,
            None,
            None,
        ))
        .await
        .expect("reject incorrect verification code");
    assert_eq!(rejected_exchange.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        response_json(rejected_exchange).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_CODE_INVALID"
    );

    let exchange = router
        .clone()
        .oneshot(auth_http_request(
            "POST",
            "/auth/exchange",
            serde_json::to_vec(&serde_json::json!({
                "challengeId": challenge_id,
                "code": code,
            }))
            .unwrap(),
            true,
            None,
            None,
        ))
        .await
        .expect("exchange verification code");
    assert_eq!(exchange.status(), StatusCode::OK);
    assert_eq!(
        exchange.headers()[header::CACHE_CONTROL],
        "no-store, private"
    );
    let credential = response_json(exchange).await;
    assert_eq!(credential["tokenType"], "Bearer");
    assert!(credential["token"].as_str().unwrap().starts_with("sbs_"));
    assert_eq!(credential["session"]["provider"], "email-code");

    let consumed_mailbox = router
        .clone()
        .oneshot(auth_http_request(
            "GET",
            &mailbox_uri,
            Vec::new(),
            false,
            Some("auth-http-admin"),
            Some(&impersonation),
        ))
        .await
        .expect("consumed mailbox request");
    assert_eq!(consumed_mailbox.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        response_json(consumed_mailbox).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_MAILBOX_ENTRY_NOT_FOUND"
    );

    let unknown = router
        .clone()
        .oneshot(auth_http_request(
            "POST",
            "/auth/exchange",
            serde_json::to_vec(&serde_json::json!({
                "challengeId": "sbc_AAAAAAAAAAAAAAAAAAAAAA",
                "code": "000000",
            }))
            .unwrap(),
            true,
            None,
            None,
        ))
        .await
        .expect("unknown exchange request");
    assert_eq!(unknown.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        response_json(unknown).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_CODE_INVALID"
    );
}

/// @ref LLP 0057#rotation — the registered provider routes pin the exact
/// bearer, body, status, and credential projection through the shared
/// SessionAuth gate.
#[tokio::test]
async fn auth_refresh_and_logout_routes_enforce_exact_carriers_and_statuses() {
    let (state, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
    let state = activate_test_sessions(state);
    let initial = mint_test_credential(&state, "refresh@example.com").await;
    let initial_token = initial["token"].as_str().unwrap().to_owned();
    let router = app(state);

    let refreshed = router
        .clone()
        .oneshot(session_auth_http_request(
            "/auth/refresh",
            br#"{}"#.to_vec(),
            &initial_token,
        ))
        .await
        .expect("refresh current bearer");
    let refreshed_status = refreshed.status();
    let refreshed = response_json(refreshed).await;
    assert_eq!(refreshed_status, StatusCode::OK, "{refreshed}");
    assert_eq!(
        refreshed
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect::<BTreeSet<_>>(),
        BTreeSet::from([
            "authorityDescriptor".to_owned(),
            "refreshAfter".to_owned(),
            "session".to_owned(),
            "token".to_owned(),
            "tokenType".to_owned(),
        ])
    );
    assert_eq!(refreshed["authorityDescriptor"]["descriptorVersion"], 1);
    assert_eq!(
        refreshed["authorityDescriptor"]
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect::<BTreeSet<_>>(),
        BTreeSet::from([
            "authorityInstanceId".to_owned(),
            "descriptorVersion".to_owned(),
            "sessionGeneration".to_owned(),
        ])
    );
    assert_eq!(refreshed["tokenType"], "Bearer");
    let current_token = refreshed["token"].as_str().unwrap().to_owned();
    assert_ne!(current_token, initial_token);

    let superseded = router
        .clone()
        .oneshot(session_auth_http_request(
            "/auth/refresh",
            br#"{}"#.to_vec(),
            &initial_token,
        ))
        .await
        .expect("in-grace predecessor response");
    assert_eq!(superseded.status(), StatusCode::CONFLICT);
    assert_eq!(
        response_json(superseded).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_REFRESH_SUPERSEDED"
    );

    let mut duplicate =
        auth_http_request("POST", "/auth/refresh", br#"{}"#.to_vec(), true, None, None);
    offer_auth_client_protocol(&mut duplicate);
    duplicate.headers_mut().append(
        header::AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {current_token}")).unwrap(),
    );
    duplicate.headers_mut().append(
        header::AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {current_token}")).unwrap(),
    );
    let mut missing =
        auth_http_request("POST", "/auth/refresh", br#"{}"#.to_vec(), true, None, None);
    offer_auth_client_protocol(&mut missing);
    let malformed = {
        let mut request =
            auth_http_request("POST", "/auth/refresh", br#"{}"#.to_vec(), true, None, None);
        offer_auth_client_protocol(&mut request);
        request.headers_mut().insert(
            header::AUTHORIZATION,
            HeaderValue::from_static("Basic not-a-bearer"),
        );
        request
    };
    for request in [missing, malformed, duplicate] {
        let response = router
            .clone()
            .oneshot(request)
            .await
            .expect("invalid bearer response");
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(
            response_json(response).await["diagnostic"]["code"],
            "SNAPBACK_AUTH_REQUIRED"
        );
    }

    let body_alias = router
        .clone()
        .oneshot(session_auth_http_request(
            "/auth/logout",
            br#"{"token":"body-alias"}"#.to_vec(),
            &current_token,
        ))
        .await
        .expect("closed logout body response");
    assert_eq!(body_alias.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_json(body_alias).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_REQUEST_INVALID"
    );

    let logout = router
        .clone()
        .oneshot(session_auth_http_request(
            "/auth/logout",
            br#"{}"#.to_vec(),
            &current_token,
        ))
        .await
        .expect("logout current bearer");
    assert_eq!(logout.status(), StatusCode::NO_CONTENT);
    let repeated = router
        .oneshot(session_auth_http_request(
            "/auth/logout",
            br#"{}"#.to_vec(),
            &current_token,
        ))
        .await
        .expect("repeated logout response");
    assert_eq!(repeated.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        response_json(repeated).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_SESSION_EXPIRED"
    );
}

/// @ref LLP 0057#rotation — two refreshes admitted with the same current
/// bearer have one credential winner and one typed in-grace loser.
/// @ref LLP 0059#coordinator-and-two-context-races — the server must not turn
/// the committed winner into a stale-authority 401 while the losing rotation
/// ticket is still settling.
#[tokio::test]
async fn concurrent_auth_refresh_has_exactly_one_http_winner() {
    let (state, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
    let state = activate_test_sessions(state);
    let initial = mint_test_credential(&state, "refresh-race@example.com").await;
    let initial_token = initial["token"].as_str().unwrap().to_owned();
    let router = app(state);

    let pause_a =
        install_test_finite_authority_pause(TestFiniteAuthorityPausePoint::AfterRefreshPremark);
    let pause_b =
        install_test_finite_authority_pause(TestFiniteAuthorityPausePoint::AfterRefreshPremark);
    let mut request_a =
        session_auth_http_request("/auth/refresh", br#"{}"#.to_vec(), &initial_token);
    request_a.headers_mut().insert(
        HeaderName::from_static(TEST_FINITE_AUTHORITY_PAUSE_HEADER),
        HeaderValue::from_str(pause_a.id()).expect("first refresh pause header"),
    );
    let mut request_b =
        session_auth_http_request("/auth/refresh", br#"{}"#.to_vec(), &initial_token);
    request_b.headers_mut().insert(
        HeaderName::from_static(TEST_FINITE_AUTHORITY_PAUSE_HEADER),
        HeaderValue::from_str(pause_b.id()).expect("second refresh pause header"),
    );
    let router_a = router.clone();
    let request_a = tokio::spawn(async move { router_a.oneshot(request_a).await });
    let request_b = tokio::spawn(async move { router.oneshot(request_b).await });
    tokio::time::timeout(Duration::from_secs(5), async {
        tokio::join!(pause_a.wait_until_reached(), pause_b.wait_until_reached());
    })
    .await
    .expect("both refresh requests reach the post-premark rendezvous");

    // Both exact rotation tickets are now pending. Release only A so its
    // committed response must cross admission while B still owns its sibling
    // ticket; this deterministically fails against the pre-fix generic fence.
    pause_a.release().await;
    let response_a = tokio::time::timeout(Duration::from_secs(5), request_a)
        .await
        .expect("first concurrent refresh response timed out")
        .expect("first concurrent refresh task")
        .expect("first concurrent refresh response");
    assert_eq!(response_a.status(), StatusCode::OK);

    pause_b.release().await;
    let response_b = tokio::time::timeout(Duration::from_secs(5), request_b)
        .await
        .expect("second concurrent refresh response timed out")
        .expect("second concurrent refresh task")
        .expect("second concurrent refresh response");
    assert_eq!(response_b.status(), StatusCode::CONFLICT);
    let outcomes = [response_a, response_b];

    for response in outcomes {
        let status = response.status();
        let body = response_json(response).await;
        match status {
            StatusCode::OK => {
                assert_ne!(body["token"].as_str(), Some(initial_token.as_str()));
                assert_eq!(body["session"]["id"], initial["session"]["id"]);
                assert_eq!(
                    body["authorityDescriptor"]["authorityInstanceId"],
                    initial["authorityDescriptor"]["authorityInstanceId"],
                );
                assert_eq!(
                    body["authorityDescriptor"]["sessionGeneration"],
                    initial["authorityDescriptor"]["sessionGeneration"],
                );
            }
            StatusCode::CONFLICT => assert_eq!(
                body["diagnostic"]["code"],
                "SNAPBACK_AUTH_REFRESH_SUPERSEDED"
            ),
            status => panic!("unexpected concurrent refresh status {status}: {body}"),
        }
    }
}

/// @ref LLP 0227#surface-routes-cli-verbs-client-methods — password signup/signin
/// and recovery reuse the exact credential response and registered issuance path.
/// @ref LLP 0214#81-guest-principal-and-session-creation — the public empty
/// DTO mints policy-owned identity/session facts and the claim successor keeps
/// the principal while collision and reaping stay non-oracular.
#[tokio::test]
async fn guest_entry_authorizes_claims_reaps_and_refuses_policy_or_input_failures() {
    let tombstone = GuestCleanupContractV1::Declarative {
        default: GuestCleanupActionV1::Tombstone,
        tables: BTreeMap::new(),
    };
    let mut state = guest_sessions_activation_server_fixture_async(true, tombstone.clone()).await;
    let router = app(state.clone());

    let existing_email = "occupied-guest-claim@example.com";
    let signup = router
        .clone()
        .oneshot(password_auth_http_request(
            "/auth/password/signup",
            json!({ "email": existing_email, "password": "occupied-password-123!" }),
        ))
        .await
        .expect("collision predecessor signup");
    assert_eq!(signup.status(), StatusCode::OK);

    let disabled_email = "disabled-guest-claim@example.com";
    let disabled_signup = router
        .clone()
        .oneshot(password_auth_http_request(
            "/auth/password/signup",
            json!({ "email": disabled_email, "password": "disabled-password-123!" }),
        ))
        .await
        .expect("disabled collision predecessor signup");
    assert_eq!(disabled_signup.status(), StatusCode::OK);
    let disabled_at_ms = super::now_millis();
    with_snapback(&state.snapback, move |snapback| {
        snapback.remainder_auth_fixture().disable_identity_for_test(
            "local-password",
            disabled_email,
            disabled_at_ms,
        )
    })
    .await
    .expect("disable collision predecessor identity");

    let malformed = router
        .clone()
        .oneshot(password_auth_http_request(
            "/auth/guest",
            json!({
                "principalId": "caller-must-not-select",
                "sessionId": "caller-must-not-select",
                "expiresAt": 9,
                "cleanupPolicy": { "default": "retain" },
            }),
        ))
        .await
        .expect("malformed guest request");
    assert_eq!(malformed.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_json(malformed).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_REQUEST_INVALID"
    );

    let entered = router
        .clone()
        .oneshot(password_auth_http_request("/auth/guest", json!({})))
        .await
        .expect("guest entry response");
    assert_eq!(entered.status(), StatusCode::OK);
    let entered = response_json(entered).await;
    assert_credential_shape(&entered, false, "guest");
    let guest_user = entered["session"]["userId"].as_str().unwrap().to_owned();
    let guest_token = entered["token"].as_str().unwrap().to_owned();
    let guest_session_id = entered["session"]["id"].clone();
    let guest_authority_id = entered["authorityDescriptor"]["authorityInstanceId"].clone();
    assert_eq!(entered["session"]["provider"], "guest");

    let app_call = router
        .clone()
        .oneshot(session_auth_http_request(
            "/query/listItems",
            br#"{"args":{}}"#.to_vec(),
            &guest_token,
        ))
        .await
        .expect("guest-authenticated app call");
    assert_eq!(app_call.status(), StatusCode::OK);

    let collision = router
        .clone()
        .oneshot(session_auth_http_request(
            "/auth/guest/claim/password",
            serde_json::to_vec(&json!({
                "email": existing_email,
                "password": "guest-collision-password-456!",
            }))
            .unwrap(),
            &guest_token,
        ))
        .await
        .expect("guest claim collision");
    assert_eq!(collision.status(), StatusCode::CONFLICT);
    let collision = response_json(collision).await;
    assert_eq!(
        collision["diagnostic"]["code"],
        "SNAPBACK_AUTH_GUEST_CLAIM_COLLISION"
    );
    assert!(!collision.to_string().contains(existing_email));

    let disabled_collision = router
        .clone()
        .oneshot(session_auth_http_request(
            "/auth/guest/claim/password",
            serde_json::to_vec(&json!({
                "email": disabled_email,
                "password": "guest-disabled-collision-password-456!",
            }))
            .unwrap(),
            &guest_token,
        ))
        .await
        .expect("disabled guest claim collision");
    assert_eq!(disabled_collision.status(), StatusCode::CONFLICT);
    let disabled_collision = response_json(disabled_collision).await;
    assert_eq!(
        disabled_collision["diagnostic"]["code"],
        "SNAPBACK_AUTH_GUEST_CLAIM_COLLISION"
    );
    assert!(!disabled_collision.to_string().contains(disabled_email));

    let claimed = router
        .clone()
        .oneshot(session_auth_http_request(
            "/auth/guest/claim/password",
            serde_json::to_vec(&json!({
                "email": "claimed-guest@example.com",
                "password": "claimed-guest-password-789!",
            }))
            .unwrap(),
            &guest_token,
        ))
        .await
        .expect("guest password claim");
    let claimed_status = claimed.status();
    let claimed = response_json(claimed).await;
    assert_eq!(claimed_status, StatusCode::OK, "{claimed}");
    assert_password_credential_shape(&claimed, true);
    assert_eq!(claimed["session"]["userId"], guest_user);
    assert_eq!(claimed["session"]["id"], guest_session_id);
    assert_eq!(
        claimed["authorityDescriptor"]["authorityInstanceId"],
        guest_authority_id
    );
    assert_ne!(claimed["token"], guest_token);

    let reaped = router
        .clone()
        .oneshot(password_auth_http_request("/auth/guest", json!({})))
        .await
        .expect("second guest entry");
    let reaped = response_json(reaped).await;
    let reaped_token = reaped["token"].as_str().unwrap().to_owned();
    let reap_at = reaped["session"]["absoluteExpiresAt"].as_u64().unwrap();
    with_snapback(&state.snapback, move |snapback| {
        snapback
            .remainder_auth_fixture()
            .identity_reap_guests_default_tombstone(reap_at)
    })
    .await
    .expect("reap expired guest");
    let provider = state
        .auth_provider
        .clone()
        .expect("installed auth provider");
    let admission = state.auth_admission_controller();
    let rebuild_preparation = with_snapback(&state.snapback, move |snapback| {
        snapback.remainder_auth_fixture().prepare_auth_coordinator(
            admission,
            provider.now_ms(),
            provider.monotonic_now(),
        )
    })
    .await
    .expect("prepare database-bound coordinator rebuild after guest reaping");
    let rebuilt = crate::auth::coordinator::AuthCoordinator::from_prepared_local_session_database(
        rebuild_preparation,
    )
    .expect("finish database-bound coordinator rebuild after releasing the engine write scope");
    state.auth_coordinator = Some(Arc::new(rebuilt));
    let refused = app(state.clone())
        .clone()
        .oneshot(session_auth_http_request(
            "/auth/guest/claim/password",
            serde_json::to_vec(&json!({
                "email": "reaped-guest@example.com",
                "password": "reaped-guest-password-123!",
            }))
            .unwrap(),
            &reaped_token,
        ))
        .await
        .expect("reaped claim refusal");
    let refused_status = refused.status();
    let refused = response_json(refused).await;
    assert_eq!(refused_status, StatusCode::UNAUTHORIZED, "{refused}");
    assert_eq!(
        refused["diagnostic"]["code"],
        "SNAPBACK_AUTH_SESSION_EXPIRED"
    );

    let disabled = guest_sessions_activation_server_fixture_async(false, tombstone.clone()).await;
    let disabled_router = app(disabled);
    let disabled_claim = disabled_router
        .clone()
        .oneshot(password_auth_http_request(
            "/auth/guest/claim/password",
            json!({
                "email": "disabled-guest-route@example.com",
                "password": "disabled-guest-route-password-123!",
            }),
        ))
        .await
        .expect("disabled guest claim refusal before credential/body accounting");
    assert_eq!(disabled_claim.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        response_json(disabled_claim).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_GUEST_DISABLED"
    );
    let disabled = disabled_router
        .clone()
        .oneshot(password_auth_http_request("/auth/guest", json!({})))
        .await
        .expect("disabled guest refusal");
    assert_eq!(disabled.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        response_json(disabled).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_GUEST_DISABLED"
    );

    let mut malformed_disabled_request =
        auth_http_request("POST", "/auth/guest", br#"{"#.to_vec(), true, None, None);
    malformed_disabled_request
        .headers_mut()
        .insert("idempotency-key", "disabled-malformed".parse().unwrap());
    offer_auth_client_protocol(&mut malformed_disabled_request);
    let malformed_disabled = disabled_router
        .clone()
        .oneshot(malformed_disabled_request)
        .await
        .expect("disabled guest malformed-body refusal");
    assert_eq!(malformed_disabled.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        response_json(malformed_disabled).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_GUEST_DISABLED"
    );

    let missing_key_disabled = disabled_router
        .oneshot(password_auth_http_request_with_idempotency(
            "/auth/guest",
            json!({}),
            None,
        ))
        .await
        .expect("disabled guest missing-idempotency refusal");
    assert_eq!(missing_key_disabled.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        response_json(missing_key_disabled).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_GUEST_DISABLED"
    );

    let mut hosted_disabled =
        guest_sessions_activation_server_fixture_async(false, tombstone.clone()).await;
    Arc::make_mut(&mut hosted_disabled.server).auth_deployment =
        crate::auth::deployment::AuthDeploymentTarget::Hosted;
    let hosted_disabled = hosted_disabled
        .with_hosted_serving_authority(hosted_serving_authority(super::now_millis()))
        .expect("hosted disabled guest authority fixture");
    let missing_source_disabled = app(hosted_disabled)
        .oneshot(password_auth_http_request("/auth/guest", json!({})))
        .await
        .expect("disabled guest missing-hosted-source refusal");
    assert_eq!(missing_source_disabled.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        response_json(missing_source_disabled).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_GUEST_DISABLED"
    );

    let unsupported = guest_sessions_activation_server_fixture_async(
        true,
        GuestCleanupContractV1::Handler {
            handler: "cleanupGuest".to_owned(),
            reads: Vec::new(),
            writes: Vec::new(),
        },
    )
    .await;
    let unsupported = app(unsupported)
        .oneshot(password_auth_http_request("/auth/guest", json!({})))
        .await
        .expect("unsupported cleanup refusal");
    assert_eq!(unsupported.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        response_json(unsupported).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_GUEST_CLEANUP_UNSUPPORTED"
    );

    let budget_state = guest_sessions_activation_server_fixture_async(true, tombstone).await;
    let keyring = Arc::new(AuthKeyringStore::in_memory());
    keyring
        .load_or_mint_initial(super::now_millis(), &OsRandom)
        .expect("production guest budget keyring");
    let provider = Arc::new(
        AuthProvider::new(AuthProviderProfile::Prod, keyring)
            .expect("production guest budget provider"),
    );
    let budget_router = app(budget_state
        .try_with_auth_provider(provider)
        .expect("production guest budget app state"));
    for _ in 0..10 {
        let admitted = budget_router
            .clone()
            .oneshot(password_auth_http_request("/auth/guest", json!({})))
            .await
            .expect("finite guest budget admission");
        assert_eq!(admitted.status(), StatusCode::OK);
    }
    let exhausted = budget_router
        .oneshot(password_auth_http_request("/auth/guest", json!({})))
        .await
        .expect("exhausted guest budget refusal");
    assert_eq!(exhausted.status(), StatusCode::TOO_MANY_REQUESTS);
    let exhausted = response_json(exhausted).await;
    assert_eq!(exhausted["diagnostic"]["code"], "SNAPBACK_AUTH_RATE_BUDGET");
    assert_eq!(
        exhausted["diagnostic"]["details"]["budgetName"],
        "auth.guest.create"
    );
}

/// @ref LLP 0214#81-guest-principal-and-session-creation — a disabled guest
/// route is absent before hosted admission or the online protocol offer can
/// reveal that either registered entry path exists.
/// @ref LLP 0214#82-guest-claim — password claim shares the same fixed
/// availability cut before any global gate or credential handling.
#[tokio::test]
async fn disabled_guest_routes_preempt_bad_protocol_and_degraded_hosted_admission() {
    let tombstone = GuestCleanupContractV1::Declarative {
        default: GuestCleanupActionV1::Tombstone,
        tables: BTreeMap::new(),
    };
    let mut disabled = guest_sessions_activation_server_fixture_async(false, tombstone).await;
    Arc::make_mut(&mut disabled.server).auth_deployment =
        crate::auth::deployment::AuthDeploymentTarget::Hosted;
    disabled.hosted_listener_binding = crate::admin::HostedListenerBinding::Pending;
    let router = app(disabled);

    for (path, body) in [
        ("/auth/guest", json!({})),
        (
            "/auth/guest/claim/password",
            json!({
                "email": "disabled-oracle@example.com",
                "password": "disabled-oracle-password-123!",
            }),
        ),
    ] {
        for protocol in [None, Some("malformed")] {
            let mut request = auth_http_request(
                "POST",
                path,
                serde_json::to_vec(&body).expect("disabled route body"),
                true,
                None,
                None,
            );
            if path == "/auth/guest" {
                request.headers_mut().insert(
                    "idempotency-key",
                    HeaderValue::from_static("disabled-oracle-idempotency"),
                );
            }
            if let Some(protocol) = protocol {
                request.headers_mut().insert(
                    HeaderName::from_static("x-snapback-auth-client-protocol"),
                    HeaderValue::from_str(protocol).expect("malformed protocol offer header"),
                );
            }
            let response = router
                .clone()
                .oneshot(request)
                .await
                .expect("disabled route refusal");
            assert_eq!(
                response.status(),
                StatusCode::NOT_FOUND,
                "path={path} protocol={protocol:?}"
            );
            assert_eq!(
                response_json(response).await["diagnostic"]["code"],
                "SNAPBACK_AUTH_GUEST_DISABLED",
                "path={path} protocol={protocol:?}"
            );
        }
    }
}

/// @ref LLP 0215#6-idempotency-and-retry-identity — guest creation is an effect: a
/// lost response and concurrent identical retries converge on one durable
/// principal/session, while a last-slot race admits at most one fresh key and
/// durably replays the refusal for the loser.
#[test]
fn guest_entry_idempotency_scope_binds_bundle_and_inputs_identity() {
    let deployment = sessions_deployment();
    let baseline = super::deployment_identity_digest(&deployment).expect("deployment digest");
    let mut bundle_changed = deployment.clone();
    bundle_changed.bundle_hash = format!("snapback.v1:sessions:function:sha256:{}", "b".repeat(64));
    let mut inputs_changed = deployment;
    inputs_changed.inputs_hash = format!("snapback.v1:sessions:inputs:sha256:{}", "c".repeat(64));
    assert_ne!(
        baseline,
        super::deployment_identity_digest(&bundle_changed).expect("bundle deployment digest")
    );
    assert_ne!(
        baseline,
        super::deployment_identity_digest(&inputs_changed).expect("inputs deployment digest")
    );
}

#[tokio::test]
async fn guest_entry_http_replay_and_concurrent_last_budget_slot_are_exact() {
    let tombstone = GuestCleanupContractV1::Declarative {
        default: GuestCleanupActionV1::Tombstone,
        tables: BTreeMap::new(),
    };
    let mut program = guest_auth_program(true, tombstone);
    for budget in program
        .abuse_budgets
        .as_mut()
        .expect("guest budget policy")
        .budgets
        .values_mut()
    {
        budget
            .profiles
            .get_mut("prod")
            .expect("production budget terms")
            .window_ms = 60_000;
    }
    resign_guest_auth_budget_policy(&mut program);
    let state = guest_sessions_custom_activation_server_fixture_async(program).await;
    let keyring = Arc::new(AuthKeyringStore::in_memory());
    keyring
        .load_or_mint_initial(super::now_millis(), &OsRandom)
        .expect("production guest replay keyring");
    let provider = Arc::new(
        AuthProvider::new(AuthProviderProfile::Prod, keyring)
            .expect("production guest replay provider"),
    );
    let router = app(state
        .try_with_auth_provider(provider)
        .expect("production guest replay state"));

    let lost_response_key = "guest-entry-lost-response-0001";
    let first = router
        .clone()
        .oneshot(password_auth_http_request_with_idempotency(
            "/auth/guest",
            json!({}),
            Some(lost_response_key),
        ))
        .await
        .expect("first guest response");
    let first_status = first.status();
    let first = response_json(first).await;
    assert_eq!(first_status, StatusCode::OK, "{first}");
    let replay = router
        .clone()
        .oneshot(password_auth_http_request_with_idempotency(
            "/auth/guest",
            json!({}),
            Some(lost_response_key),
        ))
        .await
        .expect("lost-response replay");
    let replay_status = replay.status();
    let replay = response_json(replay).await;
    assert_eq!(replay_status, StatusCode::OK, "{replay}");
    assert_eq!(
        replay, first,
        "committed replay returns the exact credential"
    );

    let concurrent_key = "guest-entry-concurrent-identical-0001";
    let concurrent_a = router
        .clone()
        .oneshot(password_auth_http_request_with_idempotency(
            "/auth/guest",
            json!({}),
            Some(concurrent_key),
        ));
    let concurrent_b = router
        .clone()
        .oneshot(password_auth_http_request_with_idempotency(
            "/auth/guest",
            json!({}),
            Some(concurrent_key),
        ));
    let (concurrent_a, concurrent_b) = tokio::join!(concurrent_a, concurrent_b);
    let concurrent_a = concurrent_a.expect("first concurrent identical response");
    let concurrent_b = concurrent_b.expect("second concurrent identical response");
    assert_eq!(concurrent_a.status(), StatusCode::OK);
    assert_eq!(concurrent_b.status(), StatusCode::OK);
    assert_eq!(
        response_json(concurrent_a).await,
        response_json(concurrent_b).await
    );

    // Two distinct credentials have consumed two of the ten production
    // slots. Bring the registry to one remaining slot, then race two fresh
    // identities at the actual commit cut.
    for index in 0..7 {
        let response = router
            .clone()
            .oneshot(password_auth_http_request_with_idempotency(
                "/auth/guest",
                json!({}),
                Some(&format!("guest-entry-prefill-{index:04}")),
            ))
            .await
            .expect("guest budget prefill response");
        assert_eq!(response.status(), StatusCode::OK);
    }
    let last_a_key = "guest-entry-last-slot-race-a-0001";
    let last_b_key = "guest-entry-last-slot-race-b-0001";
    let last_a = router
        .clone()
        .oneshot(password_auth_http_request_with_idempotency(
            "/auth/guest",
            json!({}),
            Some(last_a_key),
        ));
    let last_b = router
        .clone()
        .oneshot(password_auth_http_request_with_idempotency(
            "/auth/guest",
            json!({}),
            Some(last_b_key),
        ));
    let (last_a, last_b) = tokio::join!(last_a, last_b);
    let last_a = last_a.expect("last-slot response A");
    let last_b = last_b.expect("last-slot response B");
    let (refused_key, refused) = match (last_a.status(), last_b.status()) {
        (StatusCode::OK, StatusCode::TOO_MANY_REQUESTS) => (last_b_key, last_b),
        (StatusCode::TOO_MANY_REQUESTS, StatusCode::OK) => (last_a_key, last_a),
        statuses => panic!("last-slot race must admit exactly one request: {statuses:?}"),
    };
    let refused = response_json(refused).await;
    assert_eq!(refused["diagnostic"]["code"], "SNAPBACK_AUTH_RATE_BUDGET");
    let refused_replay = router
        .oneshot(password_auth_http_request_with_idempotency(
            "/auth/guest",
            json!({}),
            Some(refused_key),
        ))
        .await
        .expect("durable refusal replay");
    assert_eq!(refused_replay.status(), StatusCode::TOO_MANY_REQUESTS);
    let refused_replay = response_json(refused_replay).await;
    assert_eq!(
        refused_replay, refused,
        "a lost or concurrent refusal response must replay the complete public receipt"
    );
}

/// @ref LLP 0214#82-guest-claim — subject ownership is global
/// across identity providers, claims never link/switch principals, and only a
/// current guest bearer in a program that declares password claim may enter.
/// @ref LLP 0227#threat-notes — production
/// refuses this password-creation path before consulting local occupancy.
#[tokio::test]
async fn guest_claim_http_denial_matrix_is_fail_closed_and_non_linking() {
    let tombstone = GuestCleanupContractV1::Declarative {
        default: GuestCleanupActionV1::Tombstone,
        tables: BTreeMap::new(),
    };
    let state = guest_sessions_activation_server_fixture_async(true, tombstone.clone()).await;
    let provider = state.auth_provider.clone().expect("guest provider");
    let router = app(state.clone());

    let proven_email = "proven-email-owner@example.com";
    let proven = password_test_email_exchange(&router, &provider, proven_email).await;
    assert_eq!(proven["session"]["provider"], "email-code");
    let guest = router
        .clone()
        .oneshot(password_auth_http_request("/auth/guest", json!({})))
        .await
        .expect("guest for email-code collision");
    let guest = response_json(guest).await;
    let guest_token = guest["token"].as_str().expect("guest token").to_owned();
    let collision = router
        .clone()
        .oneshot(session_auth_http_request(
            "/auth/guest/claim/password",
            serde_json::to_vec(&json!({
                "email": proven_email,
                "password": "non-linking-guest-password-123!",
            }))
            .unwrap(),
            &guest_token,
        ))
        .await
        .expect("cross-provider claim collision");
    assert_eq!(collision.status(), StatusCode::CONFLICT);
    let collision = response_json(collision).await;
    assert_eq!(
        collision["diagnostic"]["code"],
        "SNAPBACK_AUTH_GUEST_CLAIM_COLLISION"
    );
    let still_guest = router
        .clone()
        .oneshot(session_auth_get_request("/auth/session", &guest_token))
        .await
        .expect("guest remains usable after collision");
    assert_eq!(still_guest.status(), StatusCode::OK);
    let still_guest = response_json(still_guest).await;
    assert_eq!(
        still_guest["authority"]["sessionId"],
        guest["session"]["id"]
    );
    assert_eq!(
        still_guest["authority"]["userId"],
        guest["session"]["userId"]
    );

    let password = router
        .clone()
        .oneshot(password_auth_http_request(
            "/auth/password/signup",
            json!({
                "email": "password-session-cannot-claim@example.com",
                "password": "password-session-claim-downgrade-123!",
            }),
        ))
        .await
        .expect("password predecessor");
    assert_eq!(password.status(), StatusCode::OK);
    let password = response_json(password).await;
    let password_token = password["token"].as_str().expect("password token");
    let downgrade = router
        .clone()
        .oneshot(session_auth_http_request(
            "/auth/guest/claim/password",
            serde_json::to_vec(&json!({
                "email": "downgrade-target@example.com",
                "password": "password-session-claim-downgrade-456!",
            }))
            .unwrap(),
            password_token,
        ))
        .await
        .expect("password session claim refusal");
    let downgrade_status = downgrade.status();
    let downgrade = response_json(downgrade).await;
    assert_eq!(downgrade_status, StatusCode::UNAUTHORIZED, "{downgrade}");
    assert_eq!(
        downgrade["diagnostic"]["code"],
        "SNAPBACK_AUTH_GUEST_SESSION_INVALID"
    );

    let foreign_state =
        guest_sessions_activation_server_fixture_async(true, tombstone.clone()).await;
    let foreign_router = app(foreign_state);
    let foreign = foreign_router
        .oneshot(password_auth_http_request("/auth/guest", json!({})))
        .await
        .expect("foreign guest entry");
    let foreign = response_json(foreign).await;
    let foreign_token = foreign["token"].as_str().expect("foreign guest token");
    let foreign_claim = router
        .clone()
        .oneshot(session_auth_http_request(
            "/auth/guest/claim/password",
            serde_json::to_vec(&json!({
                "email": "foreign-guest@example.com",
                "password": "foreign-guest-password-123!",
            }))
            .unwrap(),
            foreign_token,
        ))
        .await
        .expect("foreign guest refusal");
    assert_eq!(foreign_claim.status(), StatusCode::UNAUTHORIZED);

    let unavailable_program =
        guest_auth_program_with_claiming(true, tombstone.clone(), Vec::new(), true);
    let unavailable_state =
        guest_sessions_custom_activation_server_fixture_async(unavailable_program).await;
    let unavailable_router = app(unavailable_state);
    let unavailable_guest = unavailable_router
        .clone()
        .oneshot(password_auth_http_request("/auth/guest", json!({})))
        .await
        .expect("guest without claim transition");
    let unavailable_guest = response_json(unavailable_guest).await;
    let unavailable_claim = unavailable_router
        .oneshot(session_auth_http_request(
            "/auth/guest/claim/password",
            serde_json::to_vec(&json!({
                "email": "unavailable-claim@example.com",
                "password": "unavailable-claim-password-123!",
            }))
            .unwrap(),
            unavailable_guest["token"].as_str().unwrap(),
        ))
        .await
        .expect("undeclared claim refusal");
    assert_eq!(unavailable_claim.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        response_json(unavailable_claim).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_GUEST_CLAIM_UNAVAILABLE"
    );

    let missing_budget_program = guest_auth_program_with_claiming(
        true,
        tombstone.clone(),
        vec!["password".to_owned()],
        false,
    );
    let missing_budget_router =
        app(guest_sessions_custom_activation_server_fixture_async(missing_budget_program).await);
    let mut missing_budget_handshake =
        auth_http_request("GET", "/auth/session", Vec::new(), false, None, None);
    offer_auth_client_protocol(&mut missing_budget_handshake);
    let missing_budget_handshake = missing_budget_router
        .clone()
        .oneshot(missing_budget_handshake)
        .await
        .expect("missing budget readiness handshake");
    assert_eq!(missing_budget_handshake.status(), StatusCode::OK);
    assert_eq!(
        response_json(missing_budget_handshake).await["provider"]["available"],
        false,
        "an enabled guest program without generated budget policy is not ready"
    );
    let missing_budget = missing_budget_router
        .oneshot(password_auth_http_request("/auth/guest", json!({})))
        .await
        .expect("missing generated budget refusal");
    assert_ne!(missing_budget.status(), StatusCode::OK);
    assert_eq!(
        response_json(missing_budget).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_BUDGET_POLICY_INVALID"
    );

    let mut tampered_budget_program =
        guest_auth_program_with_claiming(true, tombstone, vec!["password".to_owned()], true);
    tampered_budget_program
        .abuse_budgets
        .as_mut()
        .expect("compiled guest budget policy")
        .budgets
        .get_mut("auth.guest.create")
        .expect("guest-create budget")
        .profiles
        .get_mut("test")
        .expect("test budget terms")
        .limit += 1;
    let tampered_budget_router =
        app(guest_sessions_custom_activation_server_fixture_async(tampered_budget_program).await);
    let tampered_budget = tampered_budget_router
        .oneshot(password_auth_http_request("/auth/guest", json!({})))
        .await
        .expect("tampered generated budget refusal");
    assert_ne!(tampered_budget.status(), StatusCode::OK);
    assert_eq!(
        response_json(tampered_budget).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_BUDGET_POLICY_INVALID"
    );
}

#[tokio::test]
async fn guest_claim_prod_availability_preempts_real_preexhausted_and_occupied_state() {
    let tombstone = GuestCleanupContractV1::Declarative {
        default: GuestCleanupActionV1::Tombstone,
        tables: BTreeMap::new(),
    };
    let mut program = guest_auth_program(true, tombstone);
    for budget_name in ["auth.enumeration", "auth.hash-cpu"] {
        let budget = program
            .abuse_budgets
            .as_mut()
            .expect("guest budget policy")
            .budgets
            .get_mut(budget_name)
            .unwrap_or_else(|| panic!("{budget_name} budget"));
        for profile in ["test", "prod"] {
            budget
                .profiles
                .get_mut(profile)
                .unwrap_or_else(|| panic!("{profile} {budget_name} terms"))
                .window_ms = 60_000;
        }
    }
    resign_guest_auth_budget_policy(&mut program);
    let state = guest_sessions_custom_activation_server_fixture_async(program).await;
    let router = app(state.clone());
    let occupied_email = "preexhausted-occupied@example.com";
    let unoccupied_email = "preexhausted-unoccupied@example.com";
    let signup = router
        .clone()
        .oneshot(password_auth_http_request(
            "/auth/password/signup",
            json!({
                "email": occupied_email,
                "password": "preexhausted-occupied-password-123!",
            }),
        ))
        .await
        .expect("occupied predecessor signup");
    assert_eq!(signup.status(), StatusCode::OK);
    let guest = router
        .oneshot(password_auth_http_request("/auth/guest", json!({})))
        .await
        .expect("production-refusal guest predecessor");
    assert_eq!(guest.status(), StatusCode::OK);
    let guest_token = response_json(guest).await["token"]
        .as_str()
        .expect("guest token")
        .to_owned();

    let claim_spec = super::core_route_registrations()
        .into_iter()
        .find(|route| route.spec.path == "/auth/guest/claim/password")
        .expect("guest claim registration")
        .spec;
    for _ in 0..12 {
        for email in [occupied_email, unoccupied_email] {
            super::charge_hosted_body_auth_attempt(
                claim_spec,
                &state,
                None,
                Some(&json!({
                    "email": email,
                    "password": "preexhausted-claim-password-123!",
                })),
            )
            .await
            .expect("enabled Test profile charges the durable attempt set");
        }
    }
    let before = with_snapback(&state.snapback, |snapback| {
        let mut database = snapback.remainder_auth_fixture();
        Ok::<_, crate::diagnostic::SnapbackError>((
            database.authentication_attempt_charge_counts_for_test()?,
            database.password_identity_subject_count_for_test(occupied_email)?,
        ))
    })
    .await
    .expect("preexhausted ledger and occupied identity facts");
    let mut enumeration_counts = before
        .0
        .iter()
        .filter(|(budget, _, _)| budget == "auth.enumeration")
        .map(|(_, _, count)| *count)
        .collect::<Vec<_>>();
    enumeration_counts.sort_unstable();
    let hash_cpu_counts = before
        .0
        .iter()
        .filter(|(budget, _, _)| budget == "auth.hash-cpu")
        .map(|(_, _, count)| *count)
        .collect::<Vec<_>>();
    assert_eq!(enumeration_counts, vec![12, 13]);
    assert_eq!(hash_cpu_counts, vec![25]);
    assert_eq!(before.1, 1, "the occupied predecessor is real");

    let prod_keyring = Arc::new(AuthKeyringStore::in_memory());
    prod_keyring
        .load_or_mint_initial(super::now_millis(), &OsRandom)
        .expect("production claim keyring");
    let prod_provider = Arc::new(
        AuthProvider::new(AuthProviderProfile::Prod, prod_keyring)
            .expect("production claim provider"),
    );
    let prod_router = app(state
        .clone()
        .try_with_auth_provider(prod_provider)
        .expect("production claim state"));
    let mut fixed_refusal = None;
    for email in [occupied_email, unoccupied_email] {
        let response = prod_router
            .clone()
            .oneshot(session_auth_http_request(
                "/auth/guest/claim/password",
                serde_json::to_vec(&json!({
                    "email": email,
                    "password": "production-must-not-inspect-password-123!",
                }))
                .unwrap(),
                &guest_token,
            ))
            .await
            .expect("production claim refusal over preexhausted ledger");
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        let response = response_json(response).await;
        assert_eq!(
            response["diagnostic"]["code"],
            "SNAPBACK_AUTH_PASSWORD_SIGNUP_UNAVAILABLE"
        );
        if let Some(expected) = fixed_refusal.as_ref() {
            assert_eq!(&response, expected);
        } else {
            fixed_refusal = Some(response);
        }
    }
    let after = with_snapback(&state.snapback, |snapback| {
        let mut database = snapback.remainder_auth_fixture();
        Ok::<_, crate::diagnostic::SnapbackError>((
            database.authentication_attempt_charge_counts_for_test()?,
            database.password_identity_subject_count_for_test(occupied_email)?,
        ))
    })
    .await
    .expect("post-refusal ledger and occupied identity facts");
    assert_eq!(
        after, before,
        "Prod availability mutates no subject or budget state"
    );
}

#[tokio::test]
async fn password_routes_signup_authorize_signin_and_recover_end_to_end() {
    let state = password_sessions_activation_server_fixture_async().await;
    let provider = state.auth_provider.clone().expect("password provider");
    let router = app(state.clone());
    let email = "password-http@example.com";
    let password = "route-auth-password-123!";

    let signup = router
        .clone()
        .oneshot(password_auth_http_request(
            "/auth/password/signup",
            json!({ "email": email, "password": password }),
        ))
        .await
        .expect("password signup response");
    assert_eq!(signup.status(), StatusCode::OK);
    assert_eq!(signup.headers()[header::CACHE_CONTROL], "no-store, private");
    let signup = response_json(signup).await;
    assert_password_credential_shape(&signup, true);
    let signup_token = signup["token"].as_str().unwrap().to_owned();
    let recovery_code = signup["recoveryCodes"][0]
        .as_str()
        .expect("signup recovery code")
        .to_owned();

    let app_call = router
        .clone()
        .oneshot(session_auth_http_request(
            "/query/listItems",
            br#"{"args":{}}"#.to_vec(),
            &signup_token,
        ))
        .await
        .expect("signup-authenticated app call");
    assert_eq!(app_call.status(), StatusCode::OK);

    let refreshed = router
        .clone()
        .oneshot(session_auth_http_request(
            "/auth/refresh",
            br#"{}"#.to_vec(),
            &signup_token,
        ))
        .await
        .expect("signup session authorizes SessionAuth refresh");
    assert_eq!(refreshed.status(), StatusCode::OK);
    let refreshed = response_json(refreshed).await;
    assert_password_credential_shape(&refreshed, false);

    let signin = router
        .clone()
        .oneshot(password_auth_http_request(
            "/auth/password/signin",
            json!({ "email": email, "password": password }),
        ))
        .await
        .expect("password signin response");
    assert_eq!(signin.status(), StatusCode::OK);
    let signin = response_json(signin).await;
    assert_password_credential_shape(&signin, false);

    let recovered = router
        .clone()
        .oneshot(password_auth_http_request(
            "/auth/recovery/consume",
            json!({ "email": email, "code": recovery_code }),
        ))
        .await
        .expect("recovery consume response");
    assert_eq!(recovered.status(), StatusCode::OK);
    let recovered = response_json(recovered).await;
    assert_password_credential_shape(&recovered, true);
    assert_ne!(recovered["recoveryCodes"], signup["recoveryCodes"]);

    // The freshly recovered local-password session immediately authorizes
    // another SessionAuth credential operation.
    let recovered_token = recovered["token"].as_str().unwrap().to_owned();
    let durable_token = recovered_token.clone();
    let durable_now_ms = provider.now_ms();
    let durable_admission = provider.admit().await;
    let durable = with_snapback(&state.snapback, move |snapback| {
        snapback.remainder_auth_fixture().resolve_session(
            &durable_admission,
            &durable_token,
            durable_now_ms,
        )
    })
    .await;
    assert!(
        durable.is_ok(),
        "recovery bearer missing durably: {durable:?}"
    );
    let projected = state
        .auth_coordinator
        .as_ref()
        .expect("auth coordinator")
        .resolve_family_bearer(
            &recovered_token,
            provider.now_ms(),
            provider.monotonic_now(),
        );
    assert!(
        projected.is_ok(),
        "recovery bearer missing from projection: {projected:?}"
    );
    let session = router
        .clone()
        .oneshot(session_auth_http_request(
            "/auth/recovery/rotate",
            Vec::new(),
            &recovered_token,
        ))
        .await
        .expect("recovered session rotates recovery custody");
    let session_status = session.status();
    let session = response_json(session).await;
    assert_eq!(session_status, StatusCode::OK, "{session}");
    assert_password_credential_shape(&session, true);

    let reused = router
        .clone()
        .oneshot(password_auth_http_request(
            "/auth/recovery/consume",
            json!({ "email": email, "code": recovery_code }),
        ))
        .await
        .expect("reused recovery-code response");
    assert_eq!(reused.status(), StatusCode::UNAUTHORIZED);
    let reused = response_json(reused).await;
    assert_eq!(
        reused["diagnostic"]["code"],
        "SNAPBACK_AUTH_CREDENTIAL_INVALID"
    );

    let duplicate = router
        .clone()
        .oneshot(password_auth_http_request(
            "/auth/password/signup",
            json!({ "email": email, "password": "another-route-password-456!" }),
        ))
        .await
        .expect("duplicate signup response");
    assert_eq!(duplicate.status(), StatusCode::CONFLICT);
    assert_eq!(
        duplicate.headers()[header::CACHE_CONTROL],
        "no-store, private"
    );
    let duplicate = response_json(duplicate).await;
    assert_eq!(
        duplicate["diagnostic"]["code"],
        "SNAPBACK_AUTH_PASSWORD_EXISTS"
    );
    let serialized = duplicate.to_string();
    assert!(!serialized.contains(password));
    assert!(!serialized.contains("another-route-password-456!"));

    drop(provider);
}

#[tokio::test]
async fn password_change_closed_union_rotates_and_requires_step_up_for_first_set() {
    let state = password_sessions_activation_server_fixture_async().await;
    let provider = state.auth_provider.clone().expect("password provider");
    let router = app(state.clone());
    let rotate_email = "rotate-password@example.com";
    let old_password = "rotate-route-password-123!";
    let new_password = "rotate-route-password-456!";
    let signup = router
        .clone()
        .oneshot(password_auth_http_request(
            "/auth/password/signup",
            json!({ "email": rotate_email, "password": old_password }),
        ))
        .await
        .unwrap();
    let signup = response_json(signup).await;
    let signup_token = signup["token"].as_str().unwrap();

    let wrong = router
        .clone()
        .oneshot(session_auth_http_request(
            "/auth/password/change",
            serde_json::to_vec(&json!({
                "currentPassword": "wrong-current-password!",
                "newPassword": new_password,
            }))
            .unwrap(),
            signup_token,
        ))
        .await
        .unwrap();
    assert_eq!(wrong.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        response_json(wrong).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_CREDENTIAL_INVALID"
    );

    let changed = router
        .clone()
        .oneshot(session_auth_http_request(
            "/auth/password/change",
            serde_json::to_vec(&json!({
                "currentPassword": old_password,
                "newPassword": new_password,
            }))
            .unwrap(),
            signup_token,
        ))
        .await
        .unwrap();
    assert_eq!(changed.status(), StatusCode::OK);
    assert_password_credential_shape(&response_json(changed).await, false);

    let set_email = "set-first-password@example.com";
    let email_credential = password_test_email_exchange(&router, &provider, set_email).await;
    let email_bearer = email_credential["token"].as_str().unwrap().to_owned();
    let email_session_id = email_credential["session"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let email_authority_instance_id =
        email_credential["authorityDescriptor"]["authorityInstanceId"]
            .as_str()
            .unwrap()
            .to_owned();
    let sibling_email = "set-first-password-sibling@example.com";
    let sibling_fixture_bearer = email_bearer.clone();
    let sibling_identity_id = with_snapback(&state.snapback, move |snapback| {
        snapback
            .remainder_auth_fixture()
            .insert_email_code_identity_for_live_session_for_test(
                &sibling_fixture_bearer,
                sibling_email,
                super::now_millis(),
            )
    })
    .await
    .expect("same-user sibling email-code identity");

    let bearer_alone = router
        .clone()
        .oneshot(session_auth_http_request(
            "/auth/password/change",
            serde_json::to_vec(&json!({
                "currentPassword": null,
                "newPassword": "set-route-password-123!",
            }))
            .unwrap(),
            &email_bearer,
        ))
        .await
        .unwrap();
    assert_eq!(bearer_alone.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_json(bearer_alone).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_REQUEST_INVALID"
    );

    let legacy_mint_selector = router
        .clone()
        .oneshot(session_auth_http_request(
            "/auth/step-up/request",
            serde_json::to_vec(&json!({
                "operation": "passwordSet",
                "identityId": sibling_identity_id.clone(),
            }))
            .unwrap(),
            &email_bearer,
        ))
        .await
        .unwrap();
    assert_eq!(legacy_mint_selector.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_json(legacy_mint_selector).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_REQUEST_INVALID"
    );

    let step_up = router
        .clone()
        .oneshot(session_auth_http_request(
            "/auth/step-up/request",
            serde_json::to_vec(&json!({
                "operation": "passwordSet",
            }))
            .unwrap(),
            &email_bearer,
        ))
        .await
        .unwrap();
    assert_eq!(step_up.status(), StatusCode::OK);
    let challenge_id = response_json(step_up).await["challengeId"]
        .as_str()
        .unwrap()
        .to_owned();
    let mailbox =
        serde_json::to_value(provider.mailbox_entry(&challenge_id).await.unwrap()).unwrap();
    let code = mailbox["code"].as_str().unwrap();
    let legacy_set_selector = router
        .clone()
        .oneshot(session_auth_http_request(
            "/auth/password/change",
            serde_json::to_vec(&json!({
                "currentPassword": null,
                "newPassword": "set-route-password-123!",
                "stepUp": {
                    "challengeId": challenge_id.clone(),
                    "code": code,
                    "identityId": sibling_identity_id,
                }
            }))
            .unwrap(),
            &email_bearer,
        ))
        .await
        .unwrap();
    assert_eq!(legacy_set_selector.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_json(legacy_set_selector).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_REQUEST_INVALID"
    );
    let set = router
        .clone()
        .oneshot(session_auth_http_request(
            "/auth/password/change",
            serde_json::to_vec(&json!({
                "currentPassword": null,
                "newPassword": "set-route-password-123!",
                "stepUp": {
                    "challengeId": challenge_id,
                    "code": code,
                }
            }))
            .unwrap(),
            &email_bearer,
        ))
        .await
        .unwrap();
    let set_status = set.status();
    let set = response_json(set).await;
    assert_eq!(set_status, StatusCode::OK, "{set}");
    assert_password_credential_shape(&set, true);
    assert_ne!(
        set["session"]["id"].as_str(),
        Some(email_session_id.as_str()),
        "first-password set must replace the email-code predecessor session"
    );
    assert_ne!(
        set["authorityDescriptor"]["authorityInstanceId"].as_str(),
        Some(email_authority_instance_id.as_str()),
        "first-password set must issue a fresh authority instance"
    );
    let password_subject_counts = with_snapback(&state.snapback, move |snapback| {
        let mut database = snapback.remainder_auth_fixture();
        Ok::<_, crate::diagnostic::SnapbackError>((
            database.password_identity_subject_count_for_test(set_email)?,
            database.password_identity_subject_count_for_test(sibling_email)?,
        ))
    })
    .await
    .expect("password-set subject derivation counts");
    assert_eq!(password_subject_counts, (1, 0));

    // The email-code and local-password identities now share one principal,
    // so the capture-profile reset route may consume a fresh email challenge.
    let (reset_challenge_id, reset_code) =
        password_test_email_challenge(&router, &provider, set_email).await;
    let reset = router
        .clone()
        .oneshot(password_auth_http_request(
            "/auth/password/reset",
            json!({
                "challengeId": reset_challenge_id,
                "code": reset_code,
                "newPassword": "reset-route-password-456!",
            }),
        ))
        .await
        .expect("same-principal password reset");
    let reset_status = reset.status();
    let reset = response_json(reset).await;
    assert_eq!(reset_status, StatusCode::OK, "{reset}");
    assert_password_credential_shape(&reset, false);
}

#[tokio::test]
async fn password_reset_refuses_password_only_email_only_and_two_principal_squat_uniformly() {
    let state = password_sessions_activation_server_fixture_async().await;
    let provider = state.auth_provider.clone().expect("password provider");
    let router = app(state);

    let password_only = "reset-password-only@example.com";
    let response = router
        .clone()
        .oneshot(password_auth_http_request(
            "/auth/password/signup",
            json!({ "email": password_only, "password": "reset-only-password-123!" }),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let email_only = "reset-email-only@example.com";
    password_test_email_exchange(&router, &provider, email_only).await;

    let squat = "reset-squat@example.com";
    let response = router
        .clone()
        .oneshot(password_auth_http_request(
            "/auth/password/signup",
            json!({ "email": squat, "password": "reset-squat-password-123!" }),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    password_test_email_exchange(&router, &provider, squat).await;

    let mut refusal_body = None;
    for email in [password_only, email_only, squat] {
        let (challenge_id, code) = password_test_email_challenge(&router, &provider, email).await;
        let response = router
            .clone()
            .oneshot(password_auth_http_request(
                "/auth/password/reset",
                json!({
                    "challengeId": challenge_id,
                    "code": code,
                    "newPassword": "reset-refused-password-456!",
                }),
            ))
            .await
            .expect("same-principal reset refusal");
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(
            response.headers()[header::CACHE_CONTROL],
            "no-store, private"
        );
        let body = response_json(response).await;
        assert_eq!(
            body["diagnostic"]["code"],
            "SNAPBACK_AUTH_CREDENTIAL_INVALID"
        );
        assert!(!body.to_string().contains(email));
        match &refusal_body {
            Some(expected) => assert_eq!(&body, expected),
            None => refusal_body = Some(body),
        }
    }
}

#[tokio::test]
async fn production_password_signup_and_capture_reset_are_typed_unready_boundaries() {
    let state = password_sessions_activation_server_fixture_async().await;
    let keyring = Arc::new(AuthKeyringStore::in_memory());
    keyring
        .load_or_mint_initial(super::now_millis(), &OsRandom)
        .unwrap();
    let provider = Arc::new(AuthProvider::new(AuthProviderProfile::Prod, keyring).unwrap());
    let state = state
        .try_with_auth_provider(provider)
        .expect("production password provider");
    let readiness = serde_json::to_value(state.auth_program_readiness()).unwrap();
    assert_eq!(
        readiness["passwordProvider"]["productionSignupReady"],
        false
    );
    assert_eq!(
        readiness["passwordProvider"]["productionSignupRefusalCode"],
        "SNAPBACK_AUTH_PASSWORD_SIGNUP_UNAVAILABLE"
    );
    let router = app(state);
    for (path, code) in [
        (
            "/auth/password/signup",
            "SNAPBACK_AUTH_PASSWORD_SIGNUP_UNAVAILABLE",
        ),
        (
            "/auth/password/reset",
            "SNAPBACK_AUTH_PASSWORD_RESET_UNAVAILABLE",
        ),
    ] {
        let response = router
            .clone()
            .oneshot(password_auth_http_request(
                path,
                json!({ "password": "must-never-be-observed" }),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE, "{path}");
        assert_eq!(
            response.headers()[header::CACHE_CONTROL],
            "no-store, private"
        );
        let body = response_json(response).await;
        assert_eq!(body["diagnostic"]["code"], code);
        assert!(!body.to_string().contains("must-never-be-observed"));
    }
}

#[tokio::test]
async fn push_registry_routes_keep_token_custody_and_logout_retirement_host_owned() {
    let (state, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
    let state = activate_test_sessions(state);
    with_snapback(&state.snapback, |snapback| {
        snapback
            .remainder_auth_fixture()
            .activate_push_registry_for_test(crate::push::PushSeamDeclarationV1 {
                app_scope: crate::push::PushAppScopeV1 {
                    eas_project_id: "eas-route".into(),
                    application_id: "com.example.route".into(),
                    environment: "test".into(),
                },
                registry: crate::push::PushRegistryDeclarationV1 {
                    idle_retention_ms: 86_400_000,
                },
                audiences: BTreeMap::new(),
                uses: Vec::new(),
                ledger: None,
            })
    })
    .await
    .expect("declare push registry");
    let credential = mint_test_credential(&state, "push-route@example.com").await;
    let bearer = credential["token"].as_str().unwrap().to_owned();
    let installation_id = crate::ids::mint(crate::ids::Kind::Installation).unwrap();
    let token = "ExponentPushToken[route_secret]";
    let router = app(state.clone());

    let mut missing_request = auth_http_request(
        "POST",
        "/push/tokens/register",
        serde_json::to_vec(&json!({
            "installationId": installation_id,
            "token": token,
        }))
        .unwrap(),
        true,
        None,
        None,
    );
    offer_auth_client_protocol(&mut missing_request);
    let missing = router
        .clone()
        .oneshot(missing_request)
        .await
        .expect("missing bearer response");
    assert_eq!(missing.status(), StatusCode::UNAUTHORIZED);

    let registered = router
        .clone()
        .oneshot(session_auth_http_request(
            "/push/tokens/register",
            serde_json::to_vec(&json!({
                "installationId": installation_id,
                "token": token,
            }))
            .unwrap(),
            &bearer,
        ))
        .await
        .expect("register token");
    assert_eq!(registered.status(), StatusCode::OK);
    let registered = response_json(registered).await;
    assert_eq!(registered["installationId"], installation_id);
    assert!(crate::ids::looks_like(
        crate::ids::Kind::PushToken,
        registered["tokenId"].as_str().unwrap(),
    ));
    let encoded = serde_json::to_string(&registered).unwrap();
    assert!(!encoded.contains("route_secret"));
    assert!(registered.get("token").is_none());

    let logout = router
        .oneshot(session_auth_http_request(
            "/auth/logout",
            br#"{}"#.to_vec(),
            &bearer,
        ))
        .await
        .expect("logout registered session");
    assert_eq!(logout.status(), StatusCode::NO_CONTENT);
    let (inspection, bytes) = with_snapback(&state.snapback, |snapback| {
        let mut db = snapback.remainder_auth_fixture();
        let inspection = db.push_registry_inspection()?;
        let bytes = db.push_registry().token_bytes_for_test()?;
        Ok::<_, SnapbackError>((inspection, bytes))
    })
    .await
    .expect("retired custody facts");
    assert_eq!(inspection.live_tokens, 0);
    assert_eq!(inspection.retirement_reasons["session-ended"], 1);
    assert!(bytes.is_empty());
}

#[tokio::test]
async fn open_registration_mints_exactly_one_credential_and_a_kind_agent_principal() {
    let state = sessions_activation_server_fixture_with_agents_async(agent_policy(
        AgentsMode::Open,
        InvitedBy::Operators,
    ))
    .await;
    let router = app(state.clone());
    let response = router
        .oneshot(agent_registration_http_request(json!({
            "displayName": "Open Agent",
            "operatorContact": "ops@example.com",
        })))
        .await
        .expect("open registration response");
    let status = response.status();
    let registered = response_json(response).await;
    assert_eq!(status, StatusCode::OK, "{registered}");
    let user_id = registered["userId"].as_str().unwrap().to_owned();
    let credential_id = registered["credentialId"].as_str().unwrap().to_owned();
    assert!(crate::ids::looks_like(crate::ids::Kind::User, &user_id));
    assert!(crate::ids::looks_like(
        crate::ids::Kind::AgentCredential,
        &credential_id,
    ));
    assert_eq!(registered["generation"], 1);
    assert!(
        registered["credential"]
            .as_str()
            .unwrap()
            .starts_with("sbac_")
    );

    let inspected = with_snapback(&state.snapback, move |snapback| {
        snapback
            .remainder_auth_fixture()
            .auth_catalog()
            .agent_registration_facts_for_test(&user_id)
    })
    .await
    .unwrap();
    assert_eq!(inspected.0.0, "agent");
    assert_eq!(inspected.0.1, None);
    let provenance = serde_json::from_str::<Value>(&inspected.0.2).unwrap();
    assert_eq!(provenance["source"], "self-register");
    assert_eq!(provenance["mode"], "open");
    assert_eq!(provenance["profile"], "test");
    assert!(
        provenance["createdAtMs"]
            .as_u64()
            .is_some_and(|value| value > 0)
    );
    assert_eq!((inspected.1, inspected.2), (1, 1));
}

#[tokio::test]
async fn registration_refuses_under_disabled_and_dev_modes() {
    let disabled_state = sessions_activation_server_fixture_async().await;
    let disabled = app(disabled_state)
        .oneshot(agent_registration_http_request(json!({})))
        .await
        .unwrap();
    assert_eq!(
        response_json(disabled).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_AGENT_REGISTRATION_DISABLED"
    );

    let dev_state = test_detached_app_state(LocalSnapback::memory().expect("dev registration"));
    let dev = app(dev_state)
        .oneshot(agent_registration_http_request(json!({})))
        .await
        .unwrap();
    assert_eq!(
        response_json(dev).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_POLICY_UNAVAILABLE"
    );
}

#[tokio::test]
async fn registration_route_rejects_an_authorization_header_and_owns_an_exact_throttle_budget() {
    assert_eq!(
        super::agent_route_throttle_limit("/auth/agents/register"),
        Some(10)
    );
    let state = sessions_activation_server_fixture_with_agents_async(agent_policy(
        AgentsMode::Open,
        InvitedBy::Operators,
    ))
    .await;
    let mut request = agent_registration_http_request(json!({}));
    request.headers_mut().insert(
        header::AUTHORIZATION,
        HeaderValue::from_static("Bearer sbac_not-accepted-here"),
    );
    let response = app(state).oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_json(response).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_REQUEST_INVALID"
    );
}

#[tokio::test]
async fn user_minted_invitation_requires_step_up_and_is_single_use() {
    let state = sessions_activation_server_fixture_with_agents_async(agent_policy(
        AgentsMode::Invited,
        InvitedBy::Users,
    ))
    .await;
    let owner = mint_test_credential(&state, "agent-owner@example.com").await;
    let owner_id = owner["session"]["userId"].as_str().unwrap().to_owned();
    let bearer = owner["token"].as_str().unwrap().to_owned();
    let router = app(state.clone());
    let bare = router
        .clone()
        .oneshot(session_auth_http_request(
            "/auth/agent-invitations",
            br#"{}"#.to_vec(),
            &bearer,
        ))
        .await
        .unwrap();
    assert_eq!(
        response_json(bare).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_STEP_UP_REQUIRED"
    );

    let invitation = mint_user_agent_invitation(&state, &router, &bearer).await;
    let invitation_id = invitation["invitationId"].as_str().unwrap().to_owned();
    let secret = invitation["invitation"].as_str().unwrap().to_owned();
    assert!(secret.starts_with("sbagi_"));
    let first = router
        .clone()
        .oneshot(agent_registration_http_request(
            json!({ "invitation": secret }),
        ))
        .await
        .unwrap();
    let first_status = first.status();
    let first = response_json(first).await;
    assert_eq!(first_status, StatusCode::OK, "{first}");
    let agent_id = first["userId"].as_str().unwrap().to_owned();

    let second = router
        .clone()
        .oneshot(agent_registration_http_request(
            json!({ "invitation": secret }),
        ))
        .await
        .unwrap();
    assert_eq!(
        response_json(second).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_AGENT_INVITATION_INVALID"
    );
    let invitation_row = with_snapback(&state.snapback, move |snapback| {
        snapback
            .remainder_auth_fixture()
            .auth_catalog()
            .invitation_consumption_for_test(&invitation_id)
    })
    .await
    .unwrap();
    assert_eq!(invitation_row, (owner_id, Some(agent_id)));
}

#[tokio::test]
async fn invited_registration_records_the_minting_user_as_owner() {
    let state = sessions_activation_server_fixture_with_agents_async(agent_policy(
        AgentsMode::Invited,
        InvitedBy::Users,
    ))
    .await;
    // This test pairs the registered agent under the Query tier; seed the
    // scope bases the fixture leaves to its caller.
    with_snapback(&state.snapback, |snapback| {
        snapback
            .remainder_auth_fixture()
            .reconcile_auth_scope_bases(&activation_functions('2', false))
    })
    .await
    .unwrap();
    let owner = mint_test_credential(&state, "owned-agent@example.com").await;
    let owner_id = owner["session"]["userId"].as_str().unwrap().to_owned();
    let bearer = owner["token"].as_str().unwrap().to_owned();
    let router = app(state.clone());
    let invitation = mint_user_agent_invitation(&state, &router, &bearer).await;
    let registered = router
        .clone()
        .oneshot(agent_registration_http_request(json!({
            "invitation": invitation["invitation"],
        })))
        .await
        .unwrap();
    let registered = response_json(registered).await;
    let agent_id = registered["userId"].as_str().unwrap().to_owned();
    let credential = registered["credential"].as_str().unwrap().to_owned();
    let owner_recorded = with_snapback(&state.snapback, {
        let agent_id = agent_id.clone();
        move |snapback| snapback.remainder_auth_fixture().agent_owner(&agent_id)
    })
    .await
    .unwrap();
    assert_eq!(owner_recorded, Some(owner_id));

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
    let mut pair_request = auth_http_request(
        "POST",
        "/auth/agents/pair",
        serde_json::to_vec(&json!({
            "credential": credential,
            "pairingRequestId": pairing["pairingRequestId"],
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
    let listed = router
        .oneshot(session_auth_get_request("/auth/grant-requests", &bearer))
        .await
        .unwrap();
    let listed = response_json(listed).await;
    assert_eq!(listed.as_array().unwrap().len(), 1);
    assert_eq!(listed[0]["agentUserId"], agent_id);
    assert_eq!(listed[0]["ownerAssumption"], "ownedByGrantor");
}

#[tokio::test]
async fn a_wrong_class_secret_is_a_typed_mismatch_at_registration() {
    let state = sessions_activation_server_fixture_with_agents_async(agent_policy(
        AgentsMode::Invited,
        InvitedBy::Users,
    ))
    .await;
    let router = app(state);
    let recovery = crate::auth::crypto::RecoveryInvitation::generate(&OsRandom)
        .unwrap()
        .expose_secret()
        .to_owned();
    let credential = AgentCredential::generate(&OsRandom)
        .unwrap()
        .expose_secret()
        .to_owned();
    for wrong in [recovery, credential] {
        let response = router
            .clone()
            .oneshot(agent_registration_http_request(
                json!({ "invitation": wrong }),
            ))
            .await
            .unwrap();
        assert_eq!(
            response_json(response).await["diagnostic"]["code"],
            "SNAPBACK_AUTH_CREDENTIAL_CLASS_MISMATCH"
        );
    }
}

#[tokio::test]
async fn registered_agent_completes_the_full_pairing_journey() {
    let state = sessions_activation_server_fixture_with_agents_async(agent_policy(
        AgentsMode::Open,
        InvitedBy::Operators,
    ))
    .await;
    // The pairing journey requests the Query tier and expects it to expand to
    // the activation function set (asserted as fn:listItems below); seed the
    // scope bases the fixture now leaves to its caller.
    with_snapback(&state.snapback, |snapback| {
        snapback
            .remainder_auth_fixture()
            .reconcile_auth_scope_bases(&activation_functions('2', false))
    })
    .await
    .unwrap();
    let owner = mint_test_credential(&state, "pairing-owner@example.com").await;
    let bearer = owner["token"].as_str().unwrap().to_owned();
    let router = app(state.clone());
    let registered = router
        .clone()
        .oneshot(agent_registration_http_request(
            json!({ "displayName": "Journey Agent" }),
        ))
        .await
        .unwrap();
    let registered = response_json(registered).await;
    let agent_id = registered["userId"].as_str().unwrap().to_owned();
    let credential = registered["credential"].as_str().unwrap().to_owned();
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
    assert_eq!(paired["agentUserId"], agent_id);

    let listed = router
        .clone()
        .oneshot(session_auth_get_request("/auth/grant-requests", &bearer))
        .await
        .unwrap();
    let listed = response_json(listed).await;
    assert_eq!(listed[0]["requestId"], pairing_request_id);
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
    assert!(token["token"].as_str().unwrap().starts_with("sbagt_"));
    assert_eq!(token["actorUserId"], agent_id);
    assert_eq!(token["effectiveUserId"], owner["session"]["userId"]);
    assert_eq!(token["scopes"][0]["fn"], "fn:listItems");
    let scoped_token = token["token"].as_str().unwrap().to_owned();

    let query = Request::builder()
        .method("POST")
        .uri("/query/listItems")
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::AUTHORIZATION, format!("Bearer {scoped_token}"))
        .header("x-snapback-auth-client-protocol", "1")
        .via_hosted_terminator(TEST_HOSTED_CLIENT_SOURCE)
        .body(Body::from(r#"{"args":{}}"#))
        .unwrap();
    let query = router.clone().oneshot(query).await.unwrap();
    assert_eq!(query.status(), StatusCode::OK);

    let mut release = auth_http_request(
        "POST",
        "/auth/agents/token/release",
        serde_json::to_vec(&json!({ "token": scoped_token })).unwrap(),
        true,
        None,
        None,
    );
    offer_auth_client_protocol(&mut release);
    assert_eq!(
        router.oneshot(release).await.unwrap().status(),
        StatusCode::NO_CONTENT
    );
}

#[tokio::test]
async fn deactivated_agent_cannot_re_register_or_reuse_its_credential() {
    let state = sessions_activation_server_fixture_with_agents_async(agent_policy(
        AgentsMode::Open,
        InvitedBy::Operators,
    ))
    .await;
    let router = app(state.clone());
    let registered = router
        .clone()
        .oneshot(agent_registration_http_request(json!({})))
        .await
        .unwrap();
    let registered = response_json(registered).await;
    let agent_id = registered["userId"].as_str().unwrap().to_owned();
    let credential = registered["credential"].as_str().unwrap().to_owned();
    let now_ms = state.auth_provider.as_ref().unwrap().now_ms();
    with_snapback(&state.snapback, {
        let agent_id = agent_id.clone();
        move |snapback| {
            let manifest = snapback.remainder_auth_fixture().schema().clone();
            snapback
                .remainder_auth_fixture()
                .deactivate_agent(&agent_id, now_ms, &manifest)
        }
    })
    .await
    .unwrap();

    let mut re_register = agent_registration_http_request(json!({}));
    re_register.headers_mut().insert(
        header::AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {credential}")).unwrap(),
    );
    let re_register = router.clone().oneshot(re_register).await.unwrap();
    assert_eq!(
        response_json(re_register).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_REQUEST_INVALID"
    );

    let mut rotate = auth_http_request(
        "POST",
        "/auth/agents/rotate",
        serde_json::to_vec(&json!({ "credential": credential })).unwrap(),
        true,
        None,
        None,
    );
    offer_auth_client_protocol(&mut rotate);
    let rotate = router.oneshot(rotate).await.unwrap();
    assert_eq!(
        response_json(rotate).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_AGENT_DEACTIVATED"
    );
}

#[tokio::test]
async fn agent_token_route_accepts_exactly_one_target_and_returns_complete_receipts() {
    let state = sessions_activation_server_fixture_with_agents_async(agent_policy(
        AgentsMode::Open,
        InvitedBy::Operators,
    ))
    .await;
    let provider = state.auth_provider.clone().unwrap();
    let now_ms = provider.now_ms();
    let (agent_user_id, credential) = with_snapback(&state.snapback, move |snapback| {
        let mut db = snapback.remainder_auth_fixture();
        db.auth_catalog()
            .insert_human_user_for_test("grant-user", now_ms)?;
        let issued = db.register_agent_principal(
            None,
            Some("Route Agent".to_owned()),
            None,
            ServerProfile::Test,
            now_ms,
            &OsRandom,
        )?;
        db.auth_catalog()
            .insert_agent_token_route_fixtures_for_test(&issued.user_id, now_ms)?;
        Ok::<_, SnapbackError>((issued.user_id, issued.secret.expose_secret().to_owned()))
    })
    .await
    .unwrap();
    let router = app(state.clone());

    let mut ordinary_request = auth_http_request(
        "POST",
        "/auth/agents/token",
        serde_json::to_vec(&json!({
            "credential": credential,
            "grantId": "route-grant",
        }))
        .unwrap(),
        true,
        None,
        None,
    );
    offer_auth_client_protocol(&mut ordinary_request);
    let ordinary = router.clone().oneshot(ordinary_request).await.unwrap();
    let ordinary_status = ordinary.status();
    let ordinary = response_json(ordinary).await;
    assert_eq!(ordinary_status, StatusCode::OK, "{ordinary}");
    assert_eq!(ordinary["grantId"], "route-grant");
    assert_eq!(ordinary["actorUserId"], agent_user_id);
    assert_eq!(ordinary["effectiveUserId"], "grant-user");
    assert_eq!(ordinary["grantExpiresAtMs"], now_ms + 60_000);
    assert!(
        ordinary["expiresInMs"]
            .as_u64()
            .is_some_and(|remaining| remaining > 59_000 && remaining <= 60_000),
        "the receipt reports a server-relative token lifetime: {ordinary}"
    );
    assert_eq!(ordinary["scopes"][0]["fn"], "fn:listItems");
    assert!(ordinary["token"].as_str().unwrap().starts_with("sbagt_"));
    let first_token = ordinary["token"].as_str().unwrap().to_owned();
    let first_open = router
        .clone()
        .oneshot(connection_open_request(Some(&first_token), json!({})))
        .await
        .unwrap();
    assert_eq!(first_open.status(), StatusCode::OK);
    let first_open = response_json(first_open).await;
    let first_connection_id = first_open["connectionId"].as_str().unwrap().to_owned();
    let first_connection_token = first_open["connectionToken"].as_str().unwrap().to_owned();
    let first_grant_id = state
        .connections
        .lock()
        .grants
        .get(&first_connection_id)
        .unwrap()
        .grant_id
        .clone();
    let notifier = state.ephemeral.delivery_notifier();
    let (first_registration, _) = notifier
        .register_bound(&first_connection_id, first_grant_id)
        .unwrap();
    tokio::time::sleep(Duration::from_millis(2)).await;

    let mut pairing_request = auth_http_request(
        "POST",
        "/auth/agents/token",
        serde_json::to_vec(&json!({
            "credential": credential,
            "pairingRequestId": "route-pairing",
        }))
        .unwrap(),
        true,
        None,
        None,
    );
    offer_auth_client_protocol(&mut pairing_request);
    let pairing = router.clone().oneshot(pairing_request).await.unwrap();
    let pairing_status = pairing.status();
    let pairing = response_json(pairing).await;
    assert_eq!(pairing_status, StatusCode::OK, "{pairing}");
    assert_eq!(pairing["grantId"], "route-grant");
    assert_eq!(pairing["grantExpiresAtMs"], now_ms + 60_000);
    assert_eq!(pairing["scopes"], ordinary["scopes"]);
    let second_token = pairing["token"].as_str().unwrap().to_owned();
    let second_open = router
        .clone()
        .oneshot(connection_open_request(Some(&second_token), json!({})))
        .await
        .unwrap();
    assert_eq!(second_open.status(), StatusCode::OK);
    let second_open = response_json(second_open).await;
    let second_connection_id = second_open["connectionId"].as_str().unwrap().to_owned();
    let second_connection_token = second_open["connectionToken"].as_str().unwrap().to_owned();
    let second_grant_id = state
        .connections
        .lock()
        .grants
        .get(&second_connection_id)
        .unwrap()
        .grant_id
        .clone();
    let (second_registration, _) = notifier
        .register_bound(&second_connection_id, second_grant_id)
        .unwrap();
    tokio::time::sleep(Duration::from_millis(2)).await;

    // Fill the grant's ten-token carrier cap, then mint the eleventh. The
    // oldest token's exact connection becomes terminal while the second
    // token on the same durable grant remains current.
    for _ in 0..8 {
        let mut fill = auth_http_request(
            "POST",
            "/auth/agents/token",
            serde_json::to_vec(&json!({
                "credential": credential,
                "grantId": "route-grant",
            }))
            .unwrap(),
            true,
            None,
            None,
        );
        offer_auth_client_protocol(&mut fill);
        assert_eq!(
            router.clone().oneshot(fill).await.unwrap().status(),
            StatusCode::OK
        );
        tokio::time::sleep(Duration::from_millis(2)).await;
    }
    let mut evict = auth_http_request(
        "POST",
        "/auth/agents/token",
        serde_json::to_vec(&json!({
            "credential": credential,
            "grantId": "route-grant",
        }))
        .unwrap(),
        true,
        None,
        None,
    );
    offer_auth_client_protocol(&mut evict);
    let evict = router.clone().oneshot(evict).await.unwrap();
    assert_eq!(evict.status(), StatusCode::OK);
    let released_token = response_json(evict).await["token"]
        .as_str()
        .unwrap()
        .to_owned();
    let terminal = notifier
        .terminal_if_current(&first_connection_id, first_registration)
        .expect("cap eviction projects the exact carrier terminal event");
    assert_eq!(
        terminal.code,
        crate::live_wire::LiveAuthErrorCode::ScopedTokenInvalid
    );
    assert_eq!(
        terminal.reason,
        crate::live_wire::LiveAuthErrorReason::Revoked
    );
    assert_eq!(
        terminal.authority_disposition,
        crate::live_wire::LiveAuthorityDisposition::Carrier
    );
    assert!(
        notifier
            .terminal_if_current(&second_connection_id, second_registration)
            .is_none(),
        "a sibling token on the same grant survives oldest-carrier eviction"
    );
    {
        let connections = state.connections.lock();
        assert!(!connections.grants.contains_key(&first_connection_id));
        assert!(
            connections
                .grants
                .get(&second_connection_id)
                .is_some_and(|record| { record.token == second_connection_token })
        );
        assert_ne!(first_connection_token, second_connection_token);
        connections.assert_grant_indexes_consistent();
    }

    let release_request = || {
        let mut request = auth_http_request(
            "POST",
            "/auth/agents/token/release",
            serde_json::to_vec(&json!({ "token": released_token.clone() })).unwrap(),
            true,
            None,
            None,
        );
        offer_auth_client_protocol(&mut request);
        request
    };
    let mut header_smuggle = release_request();
    header_smuggle.headers_mut().insert(
        header::AUTHORIZATION,
        HeaderValue::from_static("Bearer sbs_header-smuggle"),
    );
    let header_smuggle = router.clone().oneshot(header_smuggle).await.unwrap();
    assert_eq!(header_smuggle.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_json(header_smuggle).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_REQUEST_INVALID"
    );
    let mut wrong_class = auth_http_request(
        "POST",
        "/auth/agents/token/release",
        serde_json::to_vec(&json!({ "token": credential.clone() })).unwrap(),
        true,
        None,
        None,
    );
    offer_auth_client_protocol(&mut wrong_class);
    let wrong_class = router.clone().oneshot(wrong_class).await.unwrap();
    assert_eq!(wrong_class.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        response_json(wrong_class).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_CREDENTIAL_CLASS_MISMATCH"
    );
    let released = router.clone().oneshot(release_request()).await.unwrap();
    assert_eq!(released.status(), StatusCode::NO_CONTENT);
    assert_eq!(
        released.headers()[header::CACHE_CONTROL],
        "no-store, private"
    );
    assert_eq!(
        router
            .clone()
            .oneshot(release_request())
            .await
            .unwrap()
            .status(),
        StatusCode::NO_CONTENT,
        "a lost successful release response is safely retryable"
    );
    assert_eq!(
        router
            .clone()
            .oneshot(connection_open_request(Some(&released_token), json!({})))
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED,
        "the exact released carrier cannot establish new work"
    );
    assert!(
        notifier
            .terminal_if_current(&second_connection_id, second_registration)
            .is_none(),
        "releasing one unbound carrier does not disturb a sibling"
    );

    let mut pending_request = auth_http_request(
        "POST",
        "/auth/agents/token",
        serde_json::to_vec(&json!({
            "credential": credential,
            "pairingRequestId": "route-pending",
        }))
        .unwrap(),
        true,
        None,
        None,
    );
    offer_auth_client_protocol(&mut pending_request);
    let pending = router.clone().oneshot(pending_request).await.unwrap();
    assert_eq!(pending.status(), StatusCode::CONFLICT);
    assert_eq!(
        response_json(pending).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_GRANT_PENDING"
    );

    for invalid in [
        json!({"credential": credential}),
        json!({
            "credential": credential,
            "grantId": "route-grant",
            "pairingRequestId": "route-pairing",
        }),
    ] {
        let mut request = auth_http_request(
            "POST",
            "/auth/agents/token",
            serde_json::to_vec(&invalid).unwrap(),
            true,
            None,
            None,
        );
        offer_auth_client_protocol(&mut request);
        let response = router.clone().oneshot(request).await.unwrap();
        assert_eq!(
            response_json(response).await["diagnostic"]["code"],
            "SNAPBACK_AUTH_REQUEST_INVALID"
        );
    }

    with_snapback(&state.snapback, move |snapback| {
        snapback
            .remainder_auth_fixture()
            .auth_catalog()
            .set_agent_credential_rotated_at_for_test(&agent_user_id, 0)
    })
    .await
    .unwrap();
    let mut rotate = auth_http_request(
        "POST",
        "/auth/agents/rotate",
        serde_json::to_vec(&json!({ "credential": credential })).unwrap(),
        true,
        None,
        None,
    );
    offer_auth_client_protocol(&mut rotate);
    assert_eq!(
        router.clone().oneshot(rotate).await.unwrap().status(),
        StatusCode::OK
    );
    let terminal = notifier
        .terminal_if_current(&second_connection_id, second_registration)
        .expect("credential rotation projects every old-generation carrier");
    assert_eq!(
        terminal.code,
        crate::live_wire::LiveAuthErrorCode::ScopedTokenInvalid
    );
    assert_eq!(
        terminal.reason,
        crate::live_wire::LiveAuthErrorReason::Revoked
    );
    assert_eq!(
        terminal.authority_disposition,
        crate::live_wire::LiveAuthorityDisposition::DurableDelete
    );
    assert!(
        !state
            .connections
            .lock()
            .grants
            .contains_key(&second_connection_id)
    );
}

/// @ref LLP 0055#ending-authority-revocation-expiry-deactivation — the
/// owner bulk endpoint ends every grant to the named actor, is idempotent,
/// and reveals nothing to a different signed-in user.
#[tokio::test]
async fn bulk_grant_revocation_is_owner_scoped_idempotent_and_no_store_over_http() {
    let state = sessions_activation_server_fixture_with_agents_async(agent_policy(
        AgentsMode::Open,
        InvitedBy::Operators,
    ))
    .await;
    let owner = mint_test_credential(&state, "bulk-owner@example.com").await;
    let stranger = mint_test_credential(&state, "bulk-stranger@example.com").await;
    let owner_id = owner["session"]["userId"].as_str().unwrap().to_owned();
    let owner_bearer = owner["token"].as_str().unwrap().to_owned();
    let stranger_bearer = stranger["token"].as_str().unwrap().to_owned();
    let provider = state.auth_provider.clone().unwrap();
    let now_ms = provider.now_ms();
    let owner_id_for_setup = owner_id.clone();
    let agent_user_id = with_snapback(&state.snapback, move |snapback| {
        let mut db = snapback.remainder_auth_fixture();
        let issued = db.register_agent_principal(
            None,
            Some("Bulk Route Agent".to_owned()),
            None,
            ServerProfile::Test,
            now_ms,
            &OsRandom,
        )?;
        db.auth_catalog().insert_bulk_route_grants_for_test(
            &issued.user_id,
            &owner_id_for_setup,
            now_ms,
        )?;
        Ok::<_, SnapbackError>(issued.user_id)
    })
    .await
    .unwrap();
    let router = app(state);

    let request = |method: &'static str, uri: &str, bearer: &str| {
        let mut request = auth_http_request(method, uri, Vec::new(), false, None, None);
        offer_auth_client_protocol(&mut request);
        request.headers_mut().insert(
            header::AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {bearer}")).unwrap(),
        );
        request
    };

    let foreign = router
        .clone()
        .oneshot(request(
            "DELETE",
            &format!("/auth/grants/by-actor/{agent_user_id}"),
            &stranger_bearer,
        ))
        .await
        .unwrap();
    assert_eq!(foreign.status(), StatusCode::NO_CONTENT);
    assert_eq!(
        foreign.headers()[header::CACHE_CONTROL],
        "no-store, private"
    );

    let before = router
        .clone()
        .oneshot(request("GET", "/auth/grants", &owner_bearer))
        .await
        .unwrap();
    let before_status = before.status();
    let before = response_json(before).await;
    assert_eq!(before_status, StatusCode::OK, "{before}");
    assert_eq!(before.as_array().unwrap().len(), 2);
    assert!(
        before
            .as_array()
            .unwrap()
            .iter()
            .all(|grant| grant["revokedAtMs"].is_null()),
        "the foreign caller cannot alter the owner's grants"
    );

    for attempt in 1..=2 {
        let revoked = router
            .clone()
            .oneshot(request(
                "DELETE",
                &format!("/auth/grants/by-actor/{agent_user_id}"),
                &owner_bearer,
            ))
            .await
            .unwrap();
        assert_eq!(
            revoked.status(),
            StatusCode::NO_CONTENT,
            "attempt {attempt}"
        );
        assert_eq!(
            revoked.headers()[header::CACHE_CONTROL],
            "no-store, private"
        );
    }

    let after = router
        .oneshot(request("GET", "/auth/grants", &owner_bearer))
        .await
        .unwrap();
    let after = response_json(after).await;
    assert_eq!(after.as_array().unwrap().len(), 2);
    assert!(
        after
            .as_array()
            .unwrap()
            .iter()
            .all(|grant| grant["revokedAtMs"].as_u64().is_some()),
        "the first owner call revokes all grants and the retry is inert"
    );
}

#[tokio::test]
async fn production_step_up_delivery_fails_closed_without_capture() {
    let state = sessions_activation_server_fixture_async().await;
    let credential = mint_test_credential(&state, "prod-step-up@example.com").await;
    let bearer = credential["token"].as_str().unwrap().to_owned();
    let keyring = Arc::new(AuthKeyringStore::in_memory());
    keyring
        .load_or_mint_initial(super::now_millis(), &OsRandom)
        .unwrap();
    let provider = Arc::new(AuthProvider::new(AuthProviderProfile::Prod, keyring).unwrap());
    let state = state
        .try_with_auth_provider(provider)
        .expect("auth provider app state");
    let router = app(state.clone());
    let response = router
        .oneshot(session_auth_http_request(
            "/auth/step-up/request",
            serde_json::to_vec(&json!({
                "operation": "grantApproval",
                "requestId": "prod-target",
            }))
            .unwrap(),
            &bearer,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        response_json(response).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_STEP_UP_DELIVERY_UNAVAILABLE"
    );
    let challenge_count = with_snapback(&state.snapback, |snapback| {
        snapback
            .remainder_auth_fixture()
            .auth_catalog()
            .verification_address_count_for_test("prod-step-up@example.com")
    })
    .await
    .unwrap();
    assert_eq!(challenge_count, 0);
}

/// @ref LLP 0058#gate-algorithm — required provider-route credentials are
/// resolved before the closed body is parsed; only a valid live bearer may
/// reach the provider DTO parser.
#[tokio::test]
async fn session_auth_credentials_precede_refresh_and_logout_body_errors() {
    let (state, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
    let state = activate_test_sessions(state);
    let credential = mint_test_credential(&state, "precedence@example.com").await;
    let bearer = credential["token"].as_str().unwrap().to_owned();
    let unknown = SessionBearer::generate(&OsRandom)
        .unwrap()
        .expose_secret()
        .to_owned();
    let router = app(state);

    for uri in ["/auth/refresh", "/auth/logout"] {
        let mut missing = auth_http_request(
            "POST",
            uri,
            vec![b'x'; super::AUTH_REQUEST_BODY_LIMIT + 1],
            true,
            None,
            None,
        );
        offer_auth_client_protocol(&mut missing);
        let malformed = {
            let mut request = auth_http_request("POST", uri, br#"{"#.to_vec(), true, None, None);
            offer_auth_client_protocol(&mut request);
            request.headers_mut().insert(
                header::AUTHORIZATION,
                HeaderValue::from_static("Basic not-a-bearer"),
            );
            request
        };
        let unknown = session_auth_http_request(uri, br#"{"#.to_vec(), &unknown);
        for request in [missing, malformed, unknown] {
            let response = router
                .clone()
                .oneshot(request)
                .await
                .expect("credential-precedence response");
            assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
            assert_eq!(
                response_json(response).await["diagnostic"]["code"],
                "SNAPBACK_AUTH_REQUIRED"
            );
        }

        let valid = router
            .clone()
            .oneshot(session_auth_http_request(uri, br#"{"#.to_vec(), &bearer))
            .await
            .expect("valid bearer malformed-body response");
        assert_eq!(valid.status(), StatusCode::BAD_REQUEST);
        assert_eq!(
            response_json(valid).await["diagnostic"]["code"],
            "SNAPBACK_AUTH_REQUEST_INVALID"
        );
    }

    let logout = router
        .clone()
        .oneshot(session_auth_http_request(
            "/auth/logout",
            br#"{}"#.to_vec(),
            &bearer,
        ))
        .await
        .expect("terminalize precedence fixture");
    assert_eq!(logout.status(), StatusCode::NO_CONTENT);
    for uri in ["/auth/refresh", "/auth/logout"] {
        let response = router
            .clone()
            .oneshot(session_auth_http_request(uri, br#"{"#.to_vec(), &bearer))
            .await
            .expect("terminal credential precedence response");
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(
            response_json(response).await["diagnostic"]["code"],
            "SNAPBACK_AUTH_SESSION_EXPIRED"
        );
    }
}

/// @ref LLP 0059#operation-specific-publication — a refresh may commit its
/// successor, but a revocation that wins before the finite-response handoff
/// fences the credential bytes from publication.
#[tokio::test]
async fn refresh_credential_response_is_fenced_by_prepublication_revocation() {
    let (state, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
    let state = activate_test_sessions(state);
    let initial = mint_test_credential(&state, "refresh-fence@example.com").await;
    let predecessor = initial["token"].as_str().unwrap().to_owned();
    let refresh_authority =
        prepared_provider_route_authority(&state, InvocationSource::AuthRefresh, &predecessor).0;
    let refreshed = super::auth_refresh(
        State(state.clone()),
        Extension(refresh_authority.clone()),
        auth_provider_headers(Some(&predecessor)),
        Ok(Bytes::from_static(br#"{}"#)),
    )
    .await
    .expect("refresh commits before publication pause");
    let (refreshed_parts, refreshed_body) = refreshed.into_parts();
    let refreshed_bytes = axum::body::to_bytes(refreshed_body, usize::MAX)
        .await
        .expect("buffer committed refresh response");
    let refreshed_json: Value =
        serde_json::from_slice(&refreshed_bytes).expect("committed refresh response JSON");
    let successor = refreshed_json["token"].as_str().unwrap().to_owned();
    let refreshed =
        axum::response::Response::from_parts(refreshed_parts, Body::from(refreshed_bytes));

    let logout_authority =
        prepared_provider_route_authority(&state, InvocationSource::AuthLogout, &successor).0;
    let logout = super::auth_logout(
        State(state),
        Extension(logout_authority),
        auth_provider_headers(Some(&successor)),
        Ok(Bytes::from_static(br#"{}"#)),
    )
    .await
    .expect("revocation wins before refresh response handoff");
    assert_eq!(logout.status(), StatusCode::NO_CONTENT);

    let refresh_policy = super::route_registry()
        .into_iter()
        .find(|spec| spec.path == "/auth/refresh")
        .expect("registered refresh route")
        .effective_for(PolicyAuthMode::Sessions);
    let response = super::finish_registered_response(
        refresh_policy,
        refreshed,
        Some(refresh_authority.admission_lease()),
        Some(&refresh_authority),
    );
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    let body = response_json(response).await;
    assert_eq!(body["diagnostic"]["code"], "SNAPBACK_AUTH_SESSION_EXPIRED");
    let serialized = serde_json::to_string(&body).unwrap();
    assert!(!serialized.contains(&predecessor));
    assert!(!serialized.contains(&successor));
}

#[tokio::test]
async fn authorized_durable_http_body_holds_commit_through_final_poll() {
    let state = auth_invalidation_reset_fixture();
    let authorization = state
        .snapback
        .lock()
        .await
        .auth_invalidation_expectation_for_test()
        .expect("installed authorization expectation");
    let envelope = RealtimeEnvelope::Durable(crate::ephemeral::DurableMessage::authorized(
        br#"{"kind":"private_board"}"#.to_vec(),
        authorization.clone(),
    ));
    let permit = state
        .ephemeral
        .begin_final_send(&envelope)
        .expect("current durable publication is admitted")
        .expect("auth-scoped durable publication carries a permit");
    let mut response = Json(vec![envelope]).into_response();
    retain_realtime_authority_in(&mut response, vec![permit]);
    let admission = state
        .auth_admission_controller()
        .admit_for_mode(AuthMode::Sessions)
        .expect("sessions response admission");
    let policy = super::route_registry()
        .into_iter()
        .find(|spec| spec.path == "/outbox/{connection_id}")
        .expect("registered outbox route")
        .effective_for(PolicyAuthMode::Sessions);
    let response = finish_registered_response(policy, response, Some(&admission), None);

    let (prepared_tx, prepared_rx) = std::sync::mpsc::channel();
    let prepare_ephemeral = state.ephemeral.clone();
    let prepare = std::thread::spawn(move || {
        let reservation = prepare_ephemeral
            .reserve_authorization_commit(
                crate::storage::AuthorizationCommitPreflight::AllProtectedRooms,
                Arc::new(crate::storage::AuthorizationReservationCancellation::new()),
            )
            .expect("prepare successor authorization event");
        prepared_tx.send(reservation).unwrap();
    });
    assert!(
        prepared_rx.recv_timeout(Duration::from_millis(20)).is_err(),
        "the HTTP response body must retain the durable publication permit"
    );

    let _body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("poll response body to its final sink");
    let reservation = prepared_rx
        .recv_timeout(Duration::from_secs(1))
        .expect("authorization prepare resumes after the body completes");
    reservation.cancel();
    prepare.join().expect("prepare thread joins");
}

/// @ref LLP 0057#rotation — the shared gate resolves an attributable
/// predecessor from the projection without applying ordinary-use grace;
/// the refresh state machine owns the outside-grace family revocation.
#[tokio::test]
async fn refresh_gate_preserves_outside_grace_reuse_revocation() {
    let start_ms = super::now_millis();
    let clock = Arc::new(ManualServerAuthClock::new(start_ms));
    let mut snapback = LocalSnapback::memory().expect("manual-clock refresh fixture");
    let keyring = Arc::new(AuthKeyringStore::in_memory());
    snapback
        .remainder_auth_fixture()
        .activate_catalog(keyring.as_ref(), start_ms, &OsRandom)
        .expect("activate manual-clock auth catalog");
    let provider = Arc::new(
        AuthProvider::new_with_dependencies(
            AuthProviderProfile::Test,
            keyring,
            Arc::new(OsRandom),
            clock.clone(),
        )
        .expect("construct manual-clock provider"),
    );
    let mut context = bound_loopback_context();
    context.profile = ServerProfile::Test;
    let state = activate_test_sessions(
        test_app_state_from_snapback(snapback, context)
            .with_policy_auth_mode(PolicyAuthMode::Sessions)
            .try_with_auth_provider(provider)
            .expect("auth provider app state"),
    );
    let initial = mint_test_credential(&state, "reuse@example.com").await;
    let predecessor = initial["token"].as_str().unwrap().to_owned();
    let router = app(state);

    let rotated = router
        .clone()
        .oneshot(session_auth_http_request(
            "/auth/refresh",
            br#"{}"#.to_vec(),
            &predecessor,
        ))
        .await
        .expect("initial rotation response");
    assert_eq!(rotated.status(), StatusCode::OK);
    let successor = response_json(rotated).await["token"]
        .as_str()
        .unwrap()
        .to_owned();

    clock.set(start_ms + AUTH_SESSION_SUPERSESSION_GRACE_MS + 1);
    let reused = router
        .clone()
        .oneshot(session_auth_http_request(
            "/auth/refresh",
            br#"{}"#.to_vec(),
            &predecessor,
        ))
        .await
        .expect("outside-grace reuse response");
    assert_eq!(reused.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        response_json(reused).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_SESSION_EXPIRED"
    );

    let successor_after_reuse = router
        .oneshot(session_auth_http_request(
            "/auth/logout",
            br#"{}"#.to_vec(),
            &successor,
        ))
        .await
        .expect("revoked successor response");
    assert_eq!(successor_after_reuse.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        response_json(successor_after_reuse).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_SESSION_EXPIRED"
    );
}

/// @ref LLP 0057#logout-ordinary-supersession-and-family-alarm — every bearer class publishes the
/// same delayed response, while only an attributable tombstone revokes.
#[tokio::test]
async fn auth_family_alarm_is_delayed_opaque_and_revoke_only() {
    let (state, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
    let state = activate_test_sessions(state);
    let initial = mint_test_credential(&state, "alarm@example.com").await;
    let predecessor = initial["token"].as_str().unwrap().to_owned();
    let unknown = SessionBearer::generate(&OsRandom)
        .unwrap()
        .expose_secret()
        .to_owned();

    for bearer in [None, Some("malformed"), Some(unknown.as_str())] {
        let started = Instant::now();
        let response = super::auth_family_alarm(
            State(state.clone()),
            test_route_admission(&state),
            auth_provider_headers(bearer),
            Ok(Bytes::from_static(br#"{}"#)),
        )
        .await
        .expect("opaque alarm response");
        assert_eq!(response.status(), StatusCode::ACCEPTED);
        assert_eq!(response_json(response).await["accepted"], true);
        assert!(started.elapsed() >= Duration::from_millis(20));
    }

    // A current bearer is an opaque no-op and remains refreshable.
    let response = super::auth_family_alarm(
        State(state.clone()),
        test_route_admission(&state),
        auth_provider_headers(Some(&predecessor)),
        Ok(Bytes::from_static(br#"{}"#)),
    )
    .await
    .expect("current alarm response");
    assert_eq!(response.status(), StatusCode::ACCEPTED);
    assert_eq!(response_json(response).await["accepted"], true);
    let rotated = super::auth_refresh(
        State(state.clone()),
        prepared_provider_route_authority(&state, InvocationSource::AuthRefresh, &predecessor),
        auth_provider_headers(Some(&predecessor)),
        Ok(Bytes::from_static(br#"{}"#)),
    )
    .await
    .expect("current bearer survived alarm");
    let rotated = response_json(rotated).await;
    let successor = rotated["token"].as_str().unwrap().to_owned();

    // The predecessor is now an attributable tombstone. Its response is
    // unchanged, but the successor's family is revoked before publish.
    for _ in 0..2 {
        let started = Instant::now();
        let response = super::auth_family_alarm(
            State(state.clone()),
            test_route_admission(&state),
            auth_provider_headers(Some(&predecessor)),
            Ok(Bytes::from_static(br#"{}"#)),
        )
        .await
        .expect("tombstone/already-revoked alarm response");
        assert_eq!(response.status(), StatusCode::ACCEPTED);
        assert_eq!(response_json(response).await["accepted"], true);
        assert!(started.elapsed() >= Duration::from_millis(20));
    }
    let revoked = app(state.clone())
        .oneshot(session_auth_http_request(
            "/auth/logout",
            br#"{}"#.to_vec(),
            &successor,
        ))
        .await
        .expect("tombstone alarm revoked-family response");
    assert_eq!(revoked.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        response_json(revoked).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_SESSION_EXPIRED"
    );

    let invalid_body = super::auth_family_alarm(
        State(state.clone()),
        test_route_admission(&state),
        auth_provider_headers(None),
        Ok(Bytes::from_static(br#"{"bearer":"body-alias"}"#)),
    )
    .await
    .expect_err("family alarm body is closed");
    assert_eq!(
        invalid_body.0.diagnostic.code,
        "SNAPBACK_AUTH_REQUEST_INVALID"
    );
}

/// @ref LLP 0057#routes-operations-and-dtos — active dev refusal precedes the
/// installed provider, bearer, and even an over-limit malformed body.
#[tokio::test]
async fn auth_http_dev_refusal_precedes_provider_and_body_handling() {
    let (router, _) = auth_http_fixture(PolicyAuthMode::Dev);
    for uri in ["/auth/request-code", "/auth/family-alarm"] {
        let response = router
            .clone()
            .oneshot(auth_http_request(
                "POST",
                uri,
                vec![b'x'; super::AUTH_REQUEST_BODY_LIMIT + 1],
                false,
                None,
                None,
            ))
            .await
            .expect("dev-mode provider refusal");
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert_eq!(
            response.headers()[header::CACHE_CONTROL],
            "no-store, private"
        );
        assert_eq!(
            response_json(response).await["diagnostic"]["code"],
            "SNAPBACK_AUTH_MODE_DEV"
        );
    }
}

/// @ref LLP 0059#projected-session — registered required
/// session routes resolve their bearer through the process projection and
/// publish the terminating logout response through its committed outcome.
#[tokio::test]
async fn registered_session_auth_routes_resolve_projection_and_publish_logout() {
    let (state, _) = auth_runtime_fixture(PolicyAuthMode::Sessions);
    let state = activate_test_sessions(state);
    let credential = mint_test_credential(&state, "registered-session@example.com").await;
    let bearer = credential["token"].as_str().unwrap().to_owned();
    let router = app(state);

    let mut missing_request =
        auth_http_request("POST", "/auth/logout", br#"{}"#.to_vec(), true, None, None);
    offer_auth_client_protocol(&mut missing_request);
    let missing = router
        .clone()
        .oneshot(missing_request)
        .await
        .expect("missing registered bearer response");
    assert_eq!(missing.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        response_json(missing).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_REQUIRED"
    );

    let logout = session_auth_http_request("/auth/logout", br#"{}"#.to_vec(), &bearer);
    let response = router
        .clone()
        .oneshot(logout)
        .await
        .expect("projection-resolved logout response");
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert_eq!(
        response.headers()[header::CACHE_CONTROL],
        "no-store, private"
    );
}

/// @ref LLP 0059#operation-specific-publication — a successful finite app
/// request records authenticated use under the same prepared authority and
/// publishes the later deadline only after the durable outcome is known.
#[tokio::test]
async fn successful_finite_session_use_extends_the_projection_deadline() {
    let start_ms = 1_700_000_000_000;
    let clock = Arc::new(ManualServerAuthClock::new(start_ms));
    let mut snapback = LocalSnapback::memory().expect("manual-clock auth fixture");
    let keyring = Arc::new(AuthKeyringStore::in_memory());
    snapback
        .remainder_auth_fixture()
        .activate_catalog(keyring.as_ref(), start_ms, &OsRandom)
        .expect("activate manual-clock auth catalog");
    let provider = Arc::new(
        AuthProvider::new_with_dependencies(
            AuthProviderProfile::Test,
            keyring,
            Arc::new(OsRandom),
            clock.clone(),
        )
        .expect("construct manual-clock auth provider"),
    );
    let state = test_app_state_from_snapback(snapback, bound_loopback_context())
        .with_policy_auth_mode(PolicyAuthMode::Sessions)
        .try_with_auth_provider(provider)
        .expect("auth provider app state");
    let credential = mint_test_credential(&state, "sliding-use@example.com").await;
    let bearer = credential["token"].as_str().unwrap().to_owned();
    let coordinator = state.auth_coordinator.clone().unwrap();

    let use_at_ms = start_ms + AUTH_SESSION_USE_COALESCE_MS;
    clock.set(use_at_ms);
    let prepared = coordinator
        .resolve_required_bearer(&bearer, use_at_ms, clock.monotonic_now())
        .expect("resolve current bearer before finite use");
    let (resolved, publication) = prepared.into_parts();
    let authority = InvocationGate::prepare_authority(
        InvocationSource::HttpQuery,
        AuthMode::Sessions,
        ServerProfile::Test,
        0,
        0,
        &WireAuthorityFields::default(),
        resolved,
    )
    .expect("prepare finite request authority")
    .with_fenced_publication(publication);
    super::record_successful_finite_session_use(&state, &authority)
        .await
        .expect("record successful finite session use");

    let after_original_deadline = start_ms + AUTH_SESSION_SLIDING_WINDOW_MS + 1;
    coordinator
        .resolve_required_bearer(
            &bearer,
            after_original_deadline,
            clock.monotonic_at(after_original_deadline),
        )
        .expect("sliding use moved the projected deadline past its original value");
}

/// @ref LLP 0057#host-operation-dtos — mint projects the exact credential as a
/// named host-ops datum and records its administrative issue provenance;
/// active Dev keeps the operation unavailable until item 4 activates
/// Sessions.
#[test]
fn auth_mint_input_refusals_are_contextual_without_reflecting_args() {
    let submitted_email = "mint-parser-secret@example.test";
    for invalid in [
        serde_json::json!({
            "operation": "auth.mintSession",
            "args": { "email": submitted_email, "role": "admin" },
        }),
        serde_json::json!({
            "operation": "auth.mintSession",
            "userId": "credential-substitution",
        }),
    ] {
        let request: crate::host_ops::HostOpsRequest = serde_json::from_value(invalid).unwrap();
        let refusal = super::auth_host_operation_input::<crate::auth::wire::MintSessionRequest>(
            &request,
            Some(&super::MINT_SESSION_REFUSAL_CONTEXT),
        )
        .expect_err("mint input refuses");
        assert_eq!(refusal.diagnostic.code, "SNAPBACK_AUTH_REQUEST_INVALID");
        assert_eq!(refusal.diagnostic.subsystem, "auth");
        assert_eq!(
            refusal.diagnostic.details,
            serde_json::json!({
                "operation": "auth.mintSession",
                "expectedArgumentContract": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["email"],
                    "properties": {
                        "email": {
                            "type": "string",
                            "minLength": 1,
                        },
                    },
                },
                "guideAnchor": "/_snapback/guide/operating/host-ops.md#mint-a-session-over-http",
            })
        );
        assert!(
            !serde_json::to_string(&refusal.diagnostic)
                .unwrap()
                .contains(submitted_email)
        );
    }

    let rescue_request: crate::host_ops::HostOpsRequest =
        serde_json::from_value(serde_json::json!({ "operation": "auth.rescueCollidingTable" }))
            .unwrap();
    let rescue_refusal = super::auth_host_operation_input::<
        crate::auth::wire::RescueCollidingTableRequest,
    >(&rescue_request, None)
    .expect_err("rescue request refuses");
    assert_eq!(rescue_refusal.diagnostic.details, serde_json::json!({}));
}

#[tokio::test]
async fn auth_mint_host_op_has_exact_projection_and_sessions_only_activation() {
    let admin_token = "auth-http-admin";
    let body = serde_json::to_vec(&serde_json::json!({
        "operation": "auth.mintSession",
        "requestId": "hop_auth_mint_exact",
        "args": { "email": "operator@example.com" },
    }))
    .unwrap();

    let (sessions, impersonation) = auth_runtime_fixture(PolicyAuthMode::Sessions);
    let sessions = sessions
        .with_auth_runtime_facts(settled_sessions_state(), AuthProgramReadiness::item4(true))
        .expect("install settled sessions mint posture");
    let sessions = app(sessions);
    let response = sessions
        .clone()
        .oneshot(auth_http_request(
            "POST",
            "/_snapback/api/host-ops",
            body.clone(),
            true,
            Some(admin_token),
            Some(&impersonation),
        ))
        .await
        .expect("mint session host operation");
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers()[header::CACHE_CONTROL],
        "no-store, private"
    );
    let response = response_json(response).await;
    let response_text = serde_json::to_string(&response).unwrap();
    assert_eq!(response["resultKind"], "hostOpsResult");
    assert_eq!(response["requestId"], "hop_auth_mint_exact");
    assert_eq!(response["operation"], "auth.mintSession");
    assert_eq!(response["ok"], true);
    assert_eq!(response["authority"]["mode"], "devAdminBypass");
    assert_eq!(response["authority"]["reason"], "issuedBy: admin");
    assert_eq!(response["diagnostics"], serde_json::json!([]));
    assert_eq!(
        response["data"]
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect::<BTreeSet<_>>(),
        BTreeSet::from([
            "authorityDescriptor".to_owned(),
            "refreshAfter".to_owned(),
            "session".to_owned(),
            "token".to_owned(),
            "tokenType".to_owned(),
        ])
    );
    assert_eq!(
        response["data"]["authorityDescriptor"]["descriptorVersion"],
        1
    );
    assert_eq!(
        response["data"]["authorityDescriptor"]
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect::<BTreeSet<_>>(),
        BTreeSet::from([
            "authorityInstanceId".to_owned(),
            "descriptorVersion".to_owned(),
            "sessionGeneration".to_owned(),
        ])
    );
    assert_eq!(response["data"]["tokenType"], "Bearer");
    assert!(
        response["data"]["token"]
            .as_str()
            .unwrap()
            .starts_with("sbs_")
    );
    let token = response["data"]["token"].as_str().unwrap();
    let mut response_without_token = response.clone();
    response_without_token["data"]["token"] = serde_json::Value::Null;
    assert!(
        !serde_json::to_string(&response_without_token)
            .unwrap()
            .contains(token),
        "the session bearer must appear only at data.token"
    );
    assert!(!response_text.contains(admin_token));
    assert!(!response_text.contains(&impersonation));
    assert!(!response_text.contains("operator@example.com"));

    let submitted_email = "mint-refusal-secret@example.test";
    for invalid in [
        serde_json::json!({
            "operation": "auth.mintSession",
            "args": { "email": submitted_email, "role": "admin" },
        }),
        serde_json::json!({
            "operation": "auth.mintSession",
            "userId": "credential-substitution",
        }),
    ] {
        let invalid = sessions
            .clone()
            .oneshot(auth_http_request(
                "POST",
                "/_snapback/api/host-ops",
                serde_json::to_vec(&invalid).unwrap(),
                true,
                Some(admin_token),
                Some(&impersonation),
            ))
            .await
            .expect("closed mint args");
        assert_eq!(invalid.status(), StatusCode::OK);
        assert_eq!(
            invalid.headers()[header::CACHE_CONTROL],
            "no-store, private"
        );
        let invalid = response_json(invalid).await;
        assert_eq!(invalid["ok"], false);
        assert_eq!(
            invalid["diagnostics"][0]["code"],
            "SNAPBACK_AUTH_REQUEST_INVALID"
        );
        assert_eq!(invalid["diagnostics"][0]["subsystem"], "auth");
        assert_eq!(
            invalid["diagnostics"][0]["details"],
            serde_json::json!({
                "operation": "auth.mintSession",
                "expectedArgumentContract": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["email"],
                    "properties": {
                        "email": {
                            "type": "string",
                            "minLength": 1,
                        },
                    },
                },
                "guideAnchor": "/_snapback/guide/operating/host-ops.md#mint-a-session-over-http",
            })
        );
        let invalid_text = serde_json::to_string(&invalid).unwrap();
        assert!(!invalid_text.contains(submitted_email));
        assert!(!invalid_text.contains(admin_token));
        assert!(!invalid_text.contains(&impersonation));
    }

    let (injected_sessions_policy, injected_impersonation) =
        auth_http_fixture(PolicyAuthMode::Sessions);
    let unavailable = injected_sessions_policy
        .oneshot(auth_http_request(
            "POST",
            "/_snapback/api/host-ops",
            body.clone(),
            true,
            Some("auth-http-admin"),
            Some(&injected_impersonation),
        ))
        .await
        .expect("policy injection cannot replace durable sessions state");
    assert_eq!(unavailable.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        response_json(unavailable).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_POLICY_UNAVAILABLE"
    );

    let (dev, dev_impersonation) = auth_http_fixture(PolicyAuthMode::Dev);
    let unavailable = dev
        .oneshot(auth_http_request(
            "POST",
            "/_snapback/api/host-ops",
            body,
            true,
            Some("auth-http-admin"),
            Some(&dev_impersonation),
        ))
        .await
        .expect("dev mint activation fence");
    assert_eq!(unavailable.status(), StatusCode::SERVICE_UNAVAILABLE);
    let unavailable = response_json(unavailable).await;
    assert_eq!(
        unavailable["diagnostic"]["code"],
        "SNAPBACK_AUTH_POLICY_UNAVAILABLE"
    );
    assert_eq!(
        unavailable["diagnostic"]["details"]["observed"]["active"],
        "dev"
    );
    assert_eq!(
        unavailable["diagnostic"]["details"]["observed"]["desired"],
        "dev"
    );
    assert_eq!(
        unavailable["diagnostic"]["details"]["observed"]["modeState"],
        "settled"
    );
    assert_eq!(
        unavailable["diagnostic"]["details"]["observed"]["appDataAvailability"],
        "available"
    );
    let message = unavailable["diagnostic"]["message"].as_str().unwrap();
    assert!(
        message.contains("ensureApp({requestedMode:'sessions'})") && message.contains("restart")
    );
}

#[tokio::test]
async fn auth_host_handler_backstop_requires_both_authority_axes() {
    let (state, impersonation) = auth_runtime_fixture(PolicyAuthMode::Sessions);
    let request = || {
        serde_json::from_value::<crate::host_ops::HostOpsRequest>(serde_json::json!({
            "operation": "auth.mintSession",
            "args": { "email": "backstop@example.com" },
        }))
        .unwrap()
    };
    let mut admin_headers = HeaderMap::new();
    admin_headers.insert(
        "x-snapback-admin-token",
        HeaderValue::from_static("auth-http-admin"),
    );
    let route_admission = test_route_admission(&state).0;
    let missing_effect = super::execute_auth_host_operation(
        &state,
        &admin_headers,
        None,
        &route_admission,
        None,
        request(),
        None,
    )
    .await
    .expect_err("AdminWrite cannot substitute for impersonation capability");
    assert_eq!(
        missing_effect.0.diagnostic.code,
        "SNAPBACK_AUTH_IMPERSONATION_REQUIRED"
    );

    let verified = state
        .impersonation_capabilities
        .as_ref()
        .unwrap()
        .authorize(Some(&impersonation))
        .expect("verify test impersonation capability");
    let missing_admin = super::execute_auth_host_operation(
        &state,
        &HeaderMap::new(),
        Some(&verified),
        &route_admission,
        None,
        request(),
        None,
    )
    .await
    .expect_err("impersonation capability cannot substitute for AdminWrite");
    assert_eq!(
        missing_admin.0.diagnostic.code,
        "SNAPBACK_ADMIN_TOKEN_REQUIRED"
    );
    assert_eq!(missing_admin.0.diagnostic.details["presented"], false);
    assert_eq!(
        missing_admin.0.diagnostic.details["header"],
        "x-snapback-admin-token"
    );
}

#[tokio::test]
async fn scoped_token_authority_disposition_survives_http_serialization() {
    for (disposition, expected) in [
        (super::HttpAuthorityDisposition::Carrier, "carrier"),
        (
            super::HttpAuthorityDisposition::DurableDelete,
            "durableDelete",
        ),
    ] {
        let response = super::ApiError::from(super::scoped_token_invalid_http(
            "scoped token test classification",
            disposition,
        ))
        .into_response();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("diagnostic response bytes");
        let body: Value = serde_json::from_slice(&body).expect("diagnostic response JSON");
        assert_eq!(
            body["diagnostic"]["code"],
            "SNAPBACK_AUTH_SCOPED_TOKEN_INVALID"
        );
        assert_eq!(
            body["diagnostic"]["details"]["authorityDisposition"],
            expected
        );
    }
}

#[tokio::test]
async fn managed_authorization_finalization_failure_reaches_the_initiating_writer() {
    for projection_failure in [false, true] {
        let state = auth_invalidation_reset_fixture_with_context(ServerContext::detached());
        with_snapback(&state.snapback, move |snapback| {
            let ephemeral = snapback.ephemeral_api();
            if projection_failure {
                ephemeral.inject_authorization_issuer_projection_failure();
            } else {
                ephemeral.inject_authorization_outcome_observation_failure();
            }
        })
        .await;

        let error = super::with_snapback_authorization_write(
            &state.snapback,
            |_| Ok(crate::storage::AuthorizationCommitPreflight::AllProtectedRooms),
            move |snapback| {
                snapback.seed(SeedData {
                    tables: BTreeMap::from([(
                        "resetPermissions".to_owned(),
                        vec![serde_json::Map::from_iter([
                            (
                                "_id".to_owned(),
                                json!(if projection_failure {
                                    "projection-failure"
                                } else {
                                    "outcome-failure"
                                }),
                            ),
                            ("subject".to_owned(), json!("postcommit")),
                        ])],
                    )]),
                })
            },
        )
        .await
        .expect_err("checked after-Local failure must cross the managed caller boundary");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE"
        );
        assert!(error.diagnostic.message.contains(if projection_failure {
            "injected authorization issuer projection failure"
        } else {
            "injected committed authorization outcome observation failure"
        }));
    }
}

#[tokio::test]
async fn active_dev_ready_catalog_reset_stays_session_issuer_free() {
    // Catalog readiness is not the issuer predicate. A ready catalog can
    // remain active Dev during staging or after downgrade; startup only
    // installs an invalidation issuer when the active mode is Sessions.
    let (state, _) =
        auth_runtime_fixture_with_context(PolicyAuthMode::Dev, ServerContext::detached(), |_| {});
    assert!(state.auth_catalog_ready);
    assert_eq!(state.auth_mode_state().active, AuthMode::Dev);
    let coordinator = state
        .auth_coordinator
        .as_ref()
        .expect("ready Dev stream coordinator");
    let predecessor = coordinator
        .authorization_stream_incarnation()
        .expect("ready Dev predecessor");
    let route_admission = test_route_admission(&state).0;

    coordinated_app_reset(&state, &route_admission, None)
        .await
        .expect("ready Dev reset succeeds");
    let successor = coordinator
        .authorization_stream_incarnation()
        .expect("ready Dev successor remains available");
    assert_ne!(successor, predecessor);
    let durable = with_snapback(&state.snapback, |snapback| {
        snapback
            .remainder_auth_fixture()
            .authorization_version()
            .expect("durable ready Dev successor")
    })
    .await;
    assert_eq!(durable.incarnation, successor);
    assert!(
        state
            .auth_invalidation
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .is_none(),
        "ready Dev router has no sessions issuer",
    );
    assert!(
        state
            .connections
            .invalidation_expectation_for_test()
            .is_none(),
        "ready Dev connections have no sessions issuer",
    );
    assert!(
        state
            .ephemeral
            .authorization_expectation_for_test()
            .is_none(),
        "ready Dev rooms have no sessions issuer",
    );
    assert!(
        with_snapback(&state.snapback, |snapback| {
            snapback.auth_invalidation_expectation_for_test()
        })
        .await
        .is_none(),
        "ready Dev queries have no sessions issuer",
    );
}
