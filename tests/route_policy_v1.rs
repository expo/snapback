//! ENG-24594 acceptance for the enforceable route registry.
//!
//! These tests deliberately consume public registry metadata rather than
//! maintaining a second list of protected routes. A newly-added route either
//! receives a runnable probe here or fails the coverage equality assertion.

use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode, header};
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use snapback::admin::{AppState, ServerContext, ServerProfile};
use snapback::local::LocalSnapback;
use snapback::manifest::{
    FunctionDefinition, FunctionKind, FunctionManifest, FunctionRuntime, IbexModule,
};
use snapback::server::{
    CredentialResolution, EffectPolicy, InvocationAuthority, LegacyBodyPolicy, OperationTransport,
    PolicyAuthMode, ResponseSensitivity, RouteClass, RoutePolicy, RouteSpec, app,
    live_socket_operations, operation_registry, route_registry,
};
use std::collections::{BTreeMap, BTreeSet};
use std::time::{Duration, Instant};
use tokio::net::TcpListener;
use tower::ServiceExt;

fn materialize_path(path: &str) -> String {
    path.replace("{connection_id}", "policy_probe")
        .replace("{table}", "missing_table")
        .replace("{name}", "missing_function")
        .replace("{*path}", "assets/policy-probe.js")
}

fn request(method: &str, uri: &str, body: Option<Value>) -> Request<Body> {
    let mut builder = Request::builder().method(method).uri(uri);
    let body = match body {
        Some(body) => {
            builder = builder.header("content-type", "application/json");
            Body::from(serde_json::to_vec(&body).expect("serialize policy probe"))
        }
        None => Body::empty(),
    };
    builder.body(body).expect("build policy probe")
}

async fn diagnostic_code(response: axum::response::Response) -> String {
    let bytes = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read diagnostic body");
    let body: Value = serde_json::from_slice(&bytes).expect("diagnostic JSON");
    body["diagnostic"]["code"]
        .as_str()
        .expect("diagnostic code")
        .to_owned()
}

fn runner_fixture() -> LocalSnapback {
    let mut snapback = LocalSnapback::memory().expect("in-memory runner fixture");
    let function = |name: &str, kind| {
        FunctionDefinition::new(
            name,
            kind,
            FunctionRuntime::IbexModule(IbexModule {
                source: format!(
                    "globalThis.__snapbackHandlers = {{ {name}() {{ return null; }} }};"
                ),
                export: name.to_owned(),
            }),
        )
    };
    snapback.load_functions(FunctionManifest {
        functions: vec![
            function("policy_query", FunctionKind::Query),
            function("policy_mutation", FunctionKind::Mutation),
            function("policy_action", FunctionKind::Action),
        ],
        ..FunctionManifest::default()
    });
    snapback
}

fn exposed_context(token: &str) -> ServerContext {
    ServerContext {
        host: "0.0.0.0".to_owned(),
        port: 4287,
        loopback: false,
        profile: ServerProfile::Dev,
        pid: std::process::id(),
        started: Instant::now(),
        started_at_ms: 0,
        admin_token: Some(token.to_owned()),
        admin_token_minted: false,
        admin_token_file: None,
        console_credentials: Default::default(),
        admin_dist: None,
    }
}

fn set_json_path(value: &mut Value, path: &[&str], replacement: Value) {
    assert!(!path.is_empty(), "JSON path must name a field");
    let mut cursor = value;
    for segment in &path[..path.len() - 1] {
        let fields = cursor
            .as_object_mut()
            .unwrap_or_else(|| panic!("non-object JSON path parent before {segment}"));
        cursor = fields
            .entry((*segment).to_owned())
            .or_insert_with(|| json!({}));
    }
    cursor
        .as_object_mut()
        .expect("JSON path parent must be an object")
        .insert(path[path.len() - 1].to_owned(), replacement);
}

fn populated_legacy_field(field: &str) -> Value {
    match field {
        "auth" => json!({
            "principal": "forged-principal",
            "session_id": "forged-session",
            "user_id": "forged-user",
            "permissions": []
        }),
        _ => json!(format!("forged-{field}")),
    }
}

/// LLP 0031#enforcement — the registry is not merely a parallel declaration.
/// Every declared path is recognized by the router, and only its declared
/// method plus the structural HTTP affordances (`OPTIONS`, and Axum's `HEAD`
/// fallback for `GET`) are installed. Every other standard-method mismatch
/// must remain a 405 rather than acquiring an unregistered handler.
#[tokio::test]
async fn registry_and_router_have_black_box_path_method_parity() {
    let router = app(AppState::detached(
        LocalSnapback::memory().expect("in-memory parity instance"),
    ));
    let registry = route_registry();
    assert!(!registry.is_empty(), "route registry must not be empty");

    let expected = BTreeSet::from([
        ("GET", "/"),
        ("GET", "/health"),
        ("GET", "/inspect"),
        ("POST", "/auth/request-code"),
        ("POST", "/auth/exchange"),
        ("POST", "/auth/refresh"),
        ("POST", "/auth/logout"),
        ("POST", "/auth/family-alarm"),
        ("POST", "/query/{name}"),
        ("POST", "/client-mutations/acknowledge"),
        ("POST", "/mutation/{name}"),
        ("POST", "/action/{name}"),
        ("POST", "/app/ensure"),
        ("POST", "/connection/open"),
        ("POST", "/live/{name}/subscribe"),
        ("POST", "/live/{name}/resume"),
        ("POST", "/live/{name}/unsubscribe"),
        ("GET", "/live/{connection_id}/stream"),
        ("GET", "/outbox/{connection_id}"),
        ("POST", "/ephemeral/collections/ensure"),
        ("POST", "/ephemeral/publish"),
        ("POST", "/ephemeral/subscribe"),
        ("POST", "/ephemeral/delete"),
        ("POST", "/_snapback/api/schema/load"),
        ("GET", "/_snapback/api/auth/mailbox"),
        ("POST", "/_snapback/api/functions/load"),
        ("POST", "/_snapback/api/app/reset"),
        ("POST", "/_snapback/api/client-mutations/purge"),
        ("POST", "/_snapback/api/host-ops"),
        (
            "POST",
            "/_snapback/api/connections/{connection_id}/disconnect",
        ),
        ("GET", "/_snapback/api/config/status"),
        ("GET", "/_snapback/api/config/plan"),
        ("POST", "/_snapback/api/config/set"),
        ("POST", "/_snapback/api/config/unset"),
        ("POST", "/_snapback/api/config/verify"),
        ("GET", "/_snapback/admin"),
        ("GET", "/_snapback/admin/"),
        ("GET", "/_snapback/admin/setup"),
        ("GET", "/_snapback/admin/{*path}"),
        ("GET", "/_snapback/api/health"),
        ("POST", "/_snapback/api/console/credential"),
        ("POST", "/_snapback/api/admin-secret-read/mint"),
        ("GET", "/_snapback/api/inspect"),
        ("GET", "/_snapback/api/receipts"),
        ("GET", "/_snapback/api/data/{table}"),
        ("POST", "/_snapback/api/functions/{name}/run"),
        ("POST", "/_snapback/api/cron/tick"),
        ("POST", "/_snapback/api/cron/{name}/run"),
        ("POST", "/_snapback/api/ephemeral/cleanup"),
    ]);
    assert_eq!(
        registry
            .iter()
            .map(|route| (route.method, route.path))
            .collect::<BTreeSet<_>>(),
        expected,
        "the complete HTTP surface must change intentionally"
    );

    let mut seen = BTreeSet::new();
    for route in registry {
        assert!(
            seen.insert((route.method, route.path)),
            "duplicate registry entry: {} {}",
            route.method,
            route.path
        );
        let path = materialize_path(route.path);

        for method in ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"] {
            let response = router
                .clone()
                .oneshot(request(method, &path, None))
                .await
                .expect("probe registered path and method");
            let installed = route.accepts_http_method(method);
            if installed {
                assert_ne!(
                    response.status(),
                    StatusCode::METHOD_NOT_ALLOWED,
                    "router omitted declared method {method} {} (registry declares {} {})",
                    route.path,
                    route.method,
                    route.path
                );
            } else {
                assert_eq!(
                    response.status(),
                    StatusCode::METHOD_NOT_ALLOWED,
                    "router installed unregistered method {method} {} (registry declares {} {})",
                    route.path,
                    route.method,
                    route.path
                );
            }
        }
    }
}

/// @ref LLP 0054#routes-operations-and-dtos — the five provider paths have closed
/// independent carrier/response classifications, and active dev mode refuses
/// them before inspecting bearer or body shape.
#[tokio::test]
async fn auth_provider_routes_are_classified_and_dev_refusal_is_opaque_no_store() {
    let registry = route_registry();
    let provider = registry
        .iter()
        .filter(|route| route.path.starts_with("/auth/"))
        .map(|route| (route.path, *route))
        .collect::<BTreeMap<_, _>>();
    assert_eq!(provider.len(), 5);

    let request_code = provider["/auth/request-code"];
    assert_eq!(request_code.path_policy, RoutePolicy::Public);
    assert_eq!(
        request_code.credential_resolution,
        CredentialResolution::None
    );
    assert_eq!(
        request_code.response_sensitivity,
        ResponseSensitivity::PublicNoStore
    );

    let exchange = provider["/auth/exchange"];
    assert_eq!(exchange.path_policy, RoutePolicy::Public);
    assert_eq!(
        exchange.credential_resolution,
        CredentialResolution::ChallengeProof
    );
    assert_eq!(
        exchange.response_sensitivity,
        ResponseSensitivity::CredentialSecret
    );

    for path in ["/auth/refresh", "/auth/logout"] {
        let route = provider[path];
        assert_eq!(route.path_policy, RoutePolicy::SessionAuth);
        assert_eq!(
            route.credential_resolution,
            CredentialResolution::RequiredSessionBearer
        );
        assert_eq!(
            route.invocation_authority,
            InvocationAuthority::ResolvedCaller
        );
    }

    let alarm = provider["/auth/family-alarm"];
    assert_eq!(alarm.path_policy, RoutePolicy::Public);
    assert_eq!(
        alarm.credential_resolution,
        CredentialResolution::FamilyAlarmBearer
    );
    assert_eq!(
        alarm.response_sensitivity,
        ResponseSensitivity::PublicNoStore
    );

    let mailbox = registry
        .iter()
        .find(|route| route.path == "/_snapback/api/auth/mailbox")
        .expect("registered capture mailbox route");
    assert_eq!(mailbox.method, "GET");
    assert_eq!(mailbox.class, RouteClass::SystemApi);
    assert_eq!(mailbox.path_policy, RoutePolicy::AdminWrite);
    assert_eq!(
        mailbox.credential_resolution,
        CredentialResolution::AdminCredential
    );
    assert_eq!(mailbox.invocation_authority, InvocationAuthority::Operator);
    assert_eq!(mailbox.effect_policy, EffectPolicy::ImpersonationCapability);
    assert_eq!(
        mailbox.response_sensitivity,
        ResponseSensitivity::CredentialSecret
    );

    let router = app(AppState::detached(
        LocalSnapback::memory().expect("in-memory auth route fixture"),
    ));
    for path in provider.keys() {
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(*path)
                    .header("content-type", "application/json")
                    .header(header::AUTHORIZATION, "Bearer planted-dev-oracle")
                    .body(Body::from(r#"{"auth":{"userId":"planted"}}"#))
                    .unwrap(),
            )
            .await
            .expect("probe dev-mode provider route");
        assert_eq!(response.status(), StatusCode::NOT_FOUND, "{path}");
        assert_eq!(
            response.headers()[header::CACHE_CONTROL],
            "no-store, private",
            "{path}"
        );
        assert_eq!(diagnostic_code(response).await, "SNAPBACK_AUTH_MODE_DEV");
    }
}

/// LLP 0031#independent-policy-axes — dev-mode client assertion has no
/// implicit sessions meaning. Every AppAuth and ConnectionAuth entry must
/// materialize a closed sessions policy which rejects, rather than ignores,
/// client-auth-bearing fields and cannot install client-asserted authority.
#[test]
fn session_overlay_closes_every_client_asserted_http_route() {
    let mut covered = BTreeSet::new();

    for route in route_registry() {
        assert_eq!(
            route.path_policy, route.policy,
            "legacy and independent path-policy fields drifted for {} {}",
            route.method, route.path
        );

        let dev = route.effective_for(PolicyAuthMode::Dev);
        assert_eq!(dev.path_policy, route.path_policy);
        assert_eq!(dev.credential_resolution, route.credential_resolution);
        assert_eq!(dev.invocation_authority, route.invocation_authority);
        assert_eq!(dev.legacy_body_policy, route.legacy_body_policy);
        assert_eq!(dev.effect_policy, route.effect_policy);
        assert_eq!(dev.response_sensitivity, route.response_sensitivity);

        let client_auth_ingress = matches!(
            route.path_policy,
            RoutePolicy::AppAuth | RoutePolicy::ConnectionAuth
        ) || dev.legacy_body_policy == LegacyBodyPolicy::Allowed;
        if !client_auth_ingress {
            continue;
        }
        covered.insert((route.method, route.path));

        let sessions = route.effective_for(PolicyAuthMode::Sessions);
        assert_ne!(
            sessions.legacy_body_policy,
            LegacyBodyPolicy::Allowed,
            "session mode must never accept client auth for {} {}",
            route.method,
            route.path
        );
        if dev.legacy_body_policy == LegacyBodyPolicy::Allowed {
            assert_eq!(
                sessions.legacy_body_policy,
                LegacyBodyPolicy::Rejected,
                "a dev body-auth ingress must explicitly reject it in sessions for {} {}",
                route.method,
                route.path
            );
        }
        assert_ne!(
            sessions.credential_resolution,
            CredentialResolution::LegacyBodyAuth,
            "session mode still resolves body auth for {} {}",
            route.method,
            route.path
        );
        assert_ne!(
            sessions.invocation_authority,
            InvocationAuthority::ClientAsserted,
            "session mode still installs client authority for {} {}",
            route.method,
            route.path
        );

        match route.path_policy {
            RoutePolicy::AppAuth => {
                assert_eq!(
                    dev.credential_resolution,
                    CredentialResolution::LegacyBodyAuth
                );
                assert_eq!(
                    dev.invocation_authority,
                    InvocationAuthority::ClientAsserted
                );
                assert_eq!(sessions.path_policy, RoutePolicy::Public);
                assert_eq!(
                    sessions.credential_resolution,
                    CredentialResolution::OptionalSessionBearer
                );
                assert_eq!(
                    sessions.invocation_authority,
                    InvocationAuthority::ResolvedCaller
                );
            }
            RoutePolicy::ConnectionAuth => {
                assert_eq!(
                    dev.credential_resolution,
                    match route.path {
                        "/live/{connection_id}/stream" =>
                            CredentialResolution::ConnectionGrantHeaderOrWebSocketSubprotocol,
                        "/outbox/{connection_id}" =>
                            CredentialResolution::ConnectionGrantHeaderOrDevQuery,
                        _ => CredentialResolution::ConnectionGrantHeader,
                    }
                );
                assert_eq!(sessions.path_policy, RoutePolicy::ConnectionAuth);
                assert_eq!(
                    sessions.credential_resolution,
                    match route.path {
                        "/live/{connection_id}/stream" =>
                            CredentialResolution::ConnectionGrantHeaderOrWebSocketSubprotocol,
                        _ => CredentialResolution::ConnectionGrantHeader,
                    }
                );
                assert_eq!(
                    sessions.invocation_authority,
                    InvocationAuthority::ConnectionBound
                );
            }
            RoutePolicy::Public => {
                assert_eq!(dev.legacy_body_policy, LegacyBodyPolicy::Allowed);
                assert_eq!(
                    dev.invocation_authority,
                    InvocationAuthority::ClientAsserted
                );
                assert_eq!(sessions.path_policy, RoutePolicy::Public);
                assert_eq!(
                    sessions.credential_resolution,
                    CredentialResolution::OptionalSessionBearer
                );
                assert_eq!(
                    sessions.invocation_authority,
                    InvocationAuthority::ResolvedCaller
                );
            }
            _ => panic!(
                "unexpected client-auth-bearing policy for {} {}",
                route.method, route.path
            ),
        }
    }

    assert!(
        !covered.is_empty(),
        "route registry must contain client-auth-bearing ingress"
    );
}

/// LLP 0031#independent-policy-axes — invalid combinations are rejected at
/// registration, rather than merely receiving a cache header at runtime.
#[test]
fn route_policy_validation_rejects_invalid_combinations() {
    for route in route_registry() {
        route.validate().unwrap_or_else(|error| {
            panic!(
                "registered route failed validation: {} {}: {error}",
                route.method, route.path
            )
        });
    }

    let invalid = [
        (
            "tokenless public raw response",
            RouteSpec::new(
                "GET",
                "/invalid/public-raw",
                RouteClass::AppData,
                RoutePolicy::Public,
                CredentialResolution::None,
                InvocationAuthority::None,
                LegacyBodyPolicy::NotApplicable,
                ResponseSensitivity::SensitiveApplicationData,
            ),
        ),
        (
            "AppAuth without a sessions overlay",
            RouteSpec::new(
                "POST",
                "/invalid/app-auth",
                RouteClass::AppData,
                RoutePolicy::AppAuth,
                CredentialResolution::LegacyBodyAuth,
                InvocationAuthority::ClientAsserted,
                LegacyBodyPolicy::Allowed,
                ResponseSensitivity::ApplicationData,
            ),
        ),
        (
            "ConnectionAuth without a connection grant",
            RouteSpec::new(
                "POST",
                "/invalid/connection-auth",
                RouteClass::AppData,
                RoutePolicy::ConnectionAuth,
                CredentialResolution::None,
                InvocationAuthority::ClientAsserted,
                LegacyBodyPolicy::Allowed,
                ResponseSensitivity::ApplicationData,
            ),
        ),
        (
            "AdminSecretRead with an ordinary admin credential",
            RouteSpec::new(
                "GET",
                "/_snapback/api/invalid-secret-read",
                RouteClass::SystemApi,
                RoutePolicy::AdminSecretRead,
                CredentialResolution::AdminCredential,
                InvocationAuthority::Operator,
                LegacyBodyPolicy::NotApplicable,
                ResponseSensitivity::SensitiveApplicationData,
            ),
        ),
        (
            "impersonation effect without AdminWrite",
            RouteSpec::new(
                "POST",
                "/_snapback/api/invalid-impersonation",
                RouteClass::SystemApi,
                RoutePolicy::AdminRead,
                CredentialResolution::AdminCredential,
                InvocationAuthority::DevImpersonation,
                LegacyBodyPolicy::NotApplicable,
                ResponseSensitivity::OperatorMetadata,
            )
            .with_effect(EffectPolicy::ImpersonationCapability),
        ),
    ];

    for (label, route) in invalid {
        assert!(
            route.validate().is_err(),
            "invalid policy combination was accepted: {label}"
        );
    }
}

fn transport_name(transport: OperationTransport) -> &'static str {
    match transport {
        OperationTransport::EnsureApp => "app-ensure",
        OperationTransport::LiveSocket => "live-socket",
        OperationTransport::DirectFunctionRunner => "direct-runner",
        OperationTransport::HostOps => "host-ops",
    }
}

/// LLP 0031#router-registry-parity-and-the-centralized-gate — multiplexed
/// operations cannot inherit whichever branch happens to be weakest. The
/// socket family, direct function-kind split, and host-op split are pinned as
/// closed sets, and every operation names a registered carrier path.
#[test]
fn operation_registry_is_exhaustive_and_bound_to_registered_carriers() {
    let operations = operation_registry();
    let route_paths = route_registry()
        .into_iter()
        .map(|route| route.path)
        .collect::<BTreeSet<_>>();
    let mut seen = BTreeSet::new();

    for operation in &operations {
        assert!(
            seen.insert((transport_name(operation.transport), operation.operation)),
            "duplicate operation metadata for {} {}",
            transport_name(operation.transport),
            operation.operation
        );
        assert!(
            route_paths.contains(operation.parent_path),
            "operation {} names an unregistered carrier {}",
            operation.operation,
            operation.parent_path
        );

        let dev = operation.effective_for(PolicyAuthMode::Dev);
        assert_eq!(dev.path_policy, operation.path_policy);
        assert_eq!(dev.credential_resolution, operation.credential_resolution);
        assert_eq!(dev.invocation_authority, operation.invocation_authority);
        assert_eq!(dev.legacy_body_policy, operation.legacy_body_policy);
        assert_eq!(dev.effect_policy, operation.effect_policy);
        assert_eq!(dev.response_sensitivity, operation.response_sensitivity);
    }

    let live = operations
        .iter()
        .filter(|operation| operation.transport == OperationTransport::LiveSocket)
        .map(|operation| (operation.operation, operation.class))
        .collect::<BTreeMap<_, _>>();
    assert_eq!(
        live,
        BTreeMap::from([
            ("ephemeral_delete", RouteClass::AppData),
            ("ephemeral_publish", RouteClass::AppData),
            ("ephemeral_subscribe", RouteClass::AppData),
            ("ephemeral_unsubscribe", RouteClass::AppData),
            ("live_ping", RouteClass::AppData),
        ]),
        "closed LiveSocketClientMessage family drifted from operation metadata"
    );
    assert_eq!(
        live,
        live_socket_operations().into_iter().collect(),
        "compatibility socket projection drifted from the operation registry"
    );

    let ensure = operations
        .iter()
        .filter(|operation| operation.transport == OperationTransport::EnsureApp)
        .map(|operation| operation.operation)
        .collect::<BTreeSet<_>>();
    assert_eq!(
        ensure,
        BTreeSet::from([
            "app.ensure.attest",
            "app.ensure.legacy",
            "app.ensure.provision",
        ]),
        "app.ensure must classify every intent branch"
    );

    let direct = operations
        .iter()
        .filter(|operation| operation.transport == OperationTransport::DirectFunctionRunner)
        .map(|operation| operation.operation)
        .collect::<BTreeSet<_>>();
    assert_eq!(
        direct,
        BTreeSet::from([
            "direct_runner.action",
            "direct_runner.mutation",
            "direct_runner.query",
            "direct_runner.unknown",
        ]),
        "direct runner must classify every function-kind branch"
    );

    let host_ops = operations
        .iter()
        .filter(|operation| operation.transport == OperationTransport::HostOps)
        .map(|operation| operation.operation)
        .collect::<BTreeSet<_>>();
    assert_eq!(
        host_ops,
        BTreeSet::from([
            "host_ops.app.inspect",
            "host_ops.app.reset",
            "host_ops.auth.mintSession",
            "host_ops.auth.rescueCollidingTable",
            "host_ops.function.explain",
            "host_ops.function.explain.impersonated",
            "host_ops.function.run.action",
            "host_ops.function.run.impersonated",
            "host_ops.function.run.mutation",
            "host_ops.function.run.query",
            "host_ops.function.run.unknown",
            "host_ops.functions.load",
            "host_ops.schema.load",
        ]),
        "host-op authority branches must remain explicit"
    );
}

fn impersonation_state(profile: ServerProfile) -> (AppState, String) {
    let (registry, operator) =
        snapback::admin_impersonation::ImpersonationCapabilityRegistry::generate(
            "nonce-policy".to_owned(),
            &snapback::auth::crypto::OsRandom,
        )
        .expect("generate policy capability");
    let mut bearer = None;
    operator
        .emit_once_to_terminal(|value| {
            bearer = Some(value.to_owned());
            Ok(())
        })
        .expect("capture test capability");
    let mut context = exposed_context("sekrit");
    context.profile = profile;
    (
        AppState::from_snapback(runner_fixture(), context)
            .with_impersonation_capabilities(registry),
        bearer.expect("captured capability"),
    )
}

async fn impersonation_host_request(
    router: &axum::Router,
    body: Value,
    admin: Option<&str>,
    capabilities: &[&str],
) -> axum::response::Response {
    let mut request = request("POST", "/_snapback/api/host-ops", Some(body));
    if let Some(admin) = admin {
        request.headers_mut().insert(
            "x-snapback-admin-token",
            admin.parse().expect("admin header"),
        );
    }
    for capability in capabilities {
        request.headers_mut().append(
            snapback::admin_impersonation::IMPERSONATION_CAPABILITY_HEADER,
            capability.parse().expect("impersonation header"),
        );
    }
    router
        .clone()
        .oneshot(request)
        .await
        .expect("impersonation host request")
}

/// @ref LLP 0054#impersonationcapability-carrier — the selected operation's
/// AdminWrite and independent effect axes are both mandatory and cannot
/// substitute for each other or leak into an ordinary selected operation.
#[tokio::test]
async fn impersonation_effect_is_selected_exactly_and_non_substitutable() {
    // auth.mintSession is intentionally item-3 fenced in Dev and exposes its
    // independent impersonation effect only through the Sessions overlay.
    let (state, bearer) = impersonation_state(ServerProfile::Dev);
    let router = app(state.with_policy_auth_mode(PolicyAuthMode::Sessions));
    let mint = || json!({"operation": "auth.mintSession", "args": {}});

    let missing_admin = impersonation_host_request(&router, mint(), None, &[bearer.as_str()]).await;
    assert_eq!(missing_admin.status(), StatusCode::UNAUTHORIZED);
    assert_ne!(
        diagnostic_code(missing_admin).await,
        "SNAPBACK_AUTH_IMPERSONATION_REQUIRED",
        "effect authority must not replace the ordinary path credential"
    );

    for capabilities in [
        vec![],
        vec!["sbs_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.190a55ad"],
        vec!["sbrl_not_sbic"],
    ] {
        let denied =
            impersonation_host_request(&router, mint(), Some("sekrit"), &capabilities).await;
        assert_eq!(denied.status(), StatusCode::FORBIDDEN);
        assert_eq!(
            diagnostic_code(denied).await,
            "SNAPBACK_AUTH_IMPERSONATION_REQUIRED"
        );
    }
    let duplicate = impersonation_host_request(
        &router,
        mint(),
        Some("sekrit"),
        &[bearer.as_str(), bearer.as_str()],
    )
    .await;
    assert_eq!(duplicate.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        diagnostic_code(duplicate).await,
        "SNAPBACK_AUTH_IMPERSONATION_REQUIRED"
    );

    let admitted =
        impersonation_host_request(&router, mint(), Some("sekrit"), &[bearer.as_str()]).await;
    assert_eq!(
        admitted.status(),
        StatusCode::OK,
        "both independent authorities must reach the structurally gated handler"
    );

    // Keep the ordinary Dev operation assertions on the active Dev policy;
    // Sessions gives query runners the separate AdminSecretRead path axis.
    let (state, bearer) = impersonation_state(ServerProfile::Dev);
    let router = app(state);

    let ordinary = impersonation_host_request(
        &router,
        json!({"operation": "app.reset"}),
        Some("sekrit"),
        &[bearer.as_str()],
    )
    .await;
    assert_eq!(ordinary.status(), StatusCode::OK);
    let ordinary_without_admin = impersonation_host_request(
        &router,
        json!({"operation": "app.reset"}),
        None,
        &[bearer.as_str()],
    )
    .await;
    assert_ne!(ordinary_without_admin.status(), StatusCode::OK);

    let run_without_effect = impersonation_host_request(
        &router,
        json!({
            "operation": "function.run",
            "function": "policy_query",
            "args": {},
            "userId": "user_test"
        }),
        Some("sekrit"),
        &[],
    )
    .await;
    assert_eq!(run_without_effect.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        diagnostic_code(run_without_effect).await,
        "SNAPBACK_AUTH_IMPERSONATION_REQUIRED",
        "dev function.run impersonation must require the effect capability"
    );
}

#[tokio::test]
async fn impersonation_capability_is_process_bound_and_forbidden_in_prod() {
    let (stale_state, stale_bearer) = impersonation_state(ServerProfile::Dev);
    drop(stale_state);
    let (live_state, live_bearer) = impersonation_state(ServerProfile::Dev);
    let live_router = app(live_state);
    let body = json!({"operation": "auth.rescueCollidingTable", "args": {}});
    let stale = impersonation_host_request(
        &live_router,
        body.clone(),
        Some("sekrit"),
        &[stale_bearer.as_str()],
    )
    .await;
    assert_eq!(stale.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        diagnostic_code(stale).await,
        "SNAPBACK_AUTH_IMPERSONATION_REQUIRED"
    );
    assert_ne!(stale_bearer, live_bearer);

    let (prod_state, prod_bearer) = impersonation_state(ServerProfile::Prod);
    let prod = impersonation_host_request(
        &app(prod_state),
        body,
        Some("sekrit"),
        &[prod_bearer.as_str()],
    )
    .await;
    assert_eq!(prod.status(), StatusCode::FORBIDDEN);
    assert_eq!(prod.headers()[header::CACHE_CONTROL], "no-store, private");

    // Rescue is deliberately narrower than the other local impersonation
    // effects: frozen LLP 0039 admits it only in dev/test, never demo.
    let (demo_state, demo_bearer) = impersonation_state(ServerProfile::Demo);
    let demo = impersonation_host_request(
        &app(demo_state),
        json!({"operation": "auth.rescueCollidingTable", "args": {}}),
        Some("sekrit"),
        &[demo_bearer.as_str()],
    )
    .await;
    assert_eq!(demo.status(), StatusCode::FORBIDDEN);
    assert_eq!(diagnostic_code(demo).await, "SNAPBACK_PROFILE_FORBIDS");
}

/// LLP 0039#authority-resolution — every socket operation and direct runner
/// branch is a client-auth-bearing ingress in dev, except the fieldless ping.
/// Its sessions materialization must either reject such fields explicitly or
/// make them structurally inapplicable, and it must never install client-
/// asserted authority.
#[test]
fn session_overlay_closes_socket_and_direct_runner_body_authority() {
    let mut socket_count = 0;
    let mut direct_count = 0;

    for operation in operation_registry() {
        if !matches!(
            operation.transport,
            OperationTransport::LiveSocket | OperationTransport::DirectFunctionRunner
        ) {
            continue;
        }

        let dev = operation.effective_for(PolicyAuthMode::Dev);
        let sessions = operation.effective_for(PolicyAuthMode::Sessions);
        assert_ne!(
            sessions.legacy_body_policy,
            LegacyBodyPolicy::Allowed,
            "sessions still accepts client auth for {}",
            operation.operation
        );
        if dev.legacy_body_policy == LegacyBodyPolicy::Allowed {
            assert_eq!(
                sessions.legacy_body_policy,
                LegacyBodyPolicy::Rejected,
                "sessions must reject, not silently ignore, auth fields for {}",
                operation.operation
            );
        }
        assert_ne!(
            sessions.credential_resolution,
            CredentialResolution::LegacyBodyAuth,
            "sessions still resolves body credentials for {}",
            operation.operation
        );
        assert_ne!(
            sessions.invocation_authority,
            InvocationAuthority::ClientAsserted,
            "sessions still installs client authority for {}",
            operation.operation
        );

        match operation.transport {
            OperationTransport::LiveSocket => {
                socket_count += 1;
                assert_eq!(sessions.path_policy, RoutePolicy::ConnectionAuth);
                assert_eq!(
                    sessions.credential_resolution,
                    CredentialResolution::BoundConnectionGrant
                );
                assert_eq!(
                    sessions.invocation_authority,
                    InvocationAuthority::ConnectionBound
                );
                assert_eq!(
                    sessions.response_sensitivity,
                    if operation.operation == "live_ping" {
                        ResponseSensitivity::PublicProjection
                    } else {
                        ResponseSensitivity::ApplicationData
                    }
                );
            }
            OperationTransport::DirectFunctionRunner => {
                direct_count += 1;
                assert_eq!(
                    dev.invocation_authority,
                    InvocationAuthority::ClientAsserted
                );
                assert_eq!(dev.legacy_body_policy, LegacyBodyPolicy::Allowed);
                assert_eq!(
                    sessions.invocation_authority,
                    InvocationAuthority::AnonymousAdminBypass
                );
                assert_eq!(
                    sessions.response_sensitivity,
                    ResponseSensitivity::SensitiveApplicationData
                );
                match operation.operation {
                    "direct_runner.query" => {
                        assert_eq!(sessions.effect_policy, EffectPolicy::FunctionKind);
                        assert_eq!(sessions.path_policy, RoutePolicy::AdminSecretRead);
                        assert_eq!(
                            sessions.credential_resolution,
                            CredentialResolution::AdminSecretReadLease
                        );
                    }
                    "direct_runner.unknown" => {
                        assert_eq!(sessions.path_policy, RoutePolicy::AdminWrite);
                        assert_eq!(sessions.effect_policy, EffectPolicy::Unavailable);
                    }
                    _ => {
                        assert_eq!(sessions.effect_policy, EffectPolicy::FunctionKind);
                        assert_eq!(sessions.path_policy, RoutePolicy::AdminWrite);
                        assert_eq!(
                            sessions.credential_resolution,
                            CredentialResolution::AdminCredential
                        );
                    }
                }
            }
            OperationTransport::HostOps => unreachable!("filtered above"),
            OperationTransport::EnsureApp => unreachable!("filtered above"),
        }
    }

    assert_eq!(socket_count, 5, "all socket variants must be swept");
    assert_eq!(direct_count, 4, "all direct runner branches must be swept");
}

/// LLP 0031#complete-existing-route--auth-mode-matrix — host-ops branches are
/// part of the same sessions closure. In particular, query-shaped app output
/// must not inherit the tokenless-loopback AdminRead floor.
#[test]
fn session_overlay_closes_every_host_ops_branch() {
    let host_ops = operation_registry()
        .into_iter()
        .filter(|operation| operation.transport == OperationTransport::HostOps)
        .map(|operation| {
            (
                operation.operation,
                operation.effective_for(PolicyAuthMode::Sessions),
            )
        })
        .collect::<BTreeMap<_, _>>();

    for name in [
        "host_ops.app.inspect",
        "host_ops.function.explain",
        "host_ops.function.run.query",
    ] {
        let policy = host_ops.get(name).expect("secret-read host operation");
        assert_eq!(policy.path_policy, RoutePolicy::AdminSecretRead, "{name}");
        assert_eq!(
            policy.credential_resolution,
            CredentialResolution::AdminSecretReadLease,
            "{name}"
        );
    }

    for name in [
        "host_ops.app.reset",
        "host_ops.schema.load",
        "host_ops.functions.load",
        "host_ops.auth.mintSession",
        "host_ops.auth.rescueCollidingTable",
        "host_ops.function.run.mutation",
        "host_ops.function.run.action",
    ] {
        let policy = host_ops.get(name).expect("admin-write host operation");
        assert_eq!(policy.path_policy, RoutePolicy::AdminWrite, "{name}");
    }

    for name in [
        "host_ops.function.explain.impersonated",
        "host_ops.function.run.unknown",
    ] {
        assert_eq!(
            host_ops
                .get(name)
                .expect("unavailable host operation")
                .effect_policy,
            EffectPolicy::Unavailable,
            "{name}"
        );
    }

    let impersonated = host_ops
        .get("host_ops.function.run.impersonated")
        .expect("impersonated function.run");
    assert_eq!(impersonated.path_policy, RoutePolicy::AdminWrite);
    assert_eq!(
        impersonated.invocation_authority,
        InvocationAuthority::DevImpersonation
    );
    assert_eq!(
        impersonated.effect_policy,
        EffectPolicy::ImpersonationCapability
    );
}

/// LLP 0031#complete-existing-route--auth-mode-matrix — `/app/ensure` is one
/// URL but three privilege branches. Sessions may compare an identity pair or
/// perform explicitly privileged provisioning; the legacy inferred branch is
/// unavailable.
#[test]
fn session_overlay_classifies_every_app_ensure_branch() {
    let ensure = operation_registry()
        .into_iter()
        .filter(|operation| operation.transport == OperationTransport::EnsureApp)
        .map(|operation| {
            (
                operation.operation,
                operation.effective_for(PolicyAuthMode::Sessions),
            )
        })
        .collect::<BTreeMap<_, _>>();

    let legacy = ensure.get("app.ensure.legacy").expect("legacy branch");
    assert_eq!(legacy.effect_policy, EffectPolicy::Unavailable);

    let attest = ensure.get("app.ensure.attest").expect("attest branch");
    assert_eq!(attest.path_policy, RoutePolicy::Public);
    assert_eq!(attest.credential_resolution, CredentialResolution::None);
    assert_eq!(attest.invocation_authority, InvocationAuthority::None);
    assert_eq!(attest.effect_policy, EffectPolicy::None);

    let provision = ensure
        .get("app.ensure.provision")
        .expect("provision branch");
    assert_eq!(provision.path_policy, RoutePolicy::AdminWrite);
    assert_eq!(
        provision.credential_resolution,
        CredentialResolution::AdminCredential
    );
    assert_eq!(
        provision.invocation_authority,
        InvocationAuthority::Operator
    );
    assert_eq!(provision.effect_policy, EffectPolicy::Provisioning);
}

#[derive(Clone)]
struct SessionBodyProbe {
    uri: &'static str,
    base: Value,
    forbidden_fields: Vec<Vec<&'static str>>,
}

impl SessionBodyProbe {
    fn bodies(&self) -> Vec<(String, Value)> {
        let mut bodies = Vec::new();
        for path in &self.forbidden_fields {
            let label = path.join(".");
            let field = path.last().expect("forbidden field path");
            for (value_label, value) in [
                ("populated", populated_legacy_field(field)),
                ("explicit-null", Value::Null),
            ] {
                let mut body = self.base.clone();
                set_json_path(&mut body, path, value);
                bodies.push((format!("{label} ({value_label})"), body));
            }
        }
        bodies
    }
}

fn session_http_body_probes() -> BTreeMap<(&'static str, &'static str), SessionBodyProbe> {
    let handler_fields = || {
        vec![
            vec!["auth"],
            vec!["ctx_ledger", "auth_fingerprint"],
            vec!["ctx_ledger", "authFingerprint"],
        ]
    };
    let ephemeral_fields = || {
        vec![
            vec!["auth"],
            vec!["principal"],
            vec!["session_id"],
            vec!["sessionId"],
            vec!["user_id"],
            vec!["userId"],
            vec!["custom_key"],
            vec!["customKey"],
        ]
    };
    BTreeMap::from([
        (
            ("POST", "/query/{name}"),
            SessionBodyProbe {
                uri: "/query/missing_function",
                base: json!({ "args": {} }),
                forbidden_fields: handler_fields(),
            },
        ),
        (
            ("POST", "/client-mutations/acknowledge"),
            SessionBodyProbe {
                uri: "/client-mutations/acknowledge",
                base: json!({ "clientMutationIds": [] }),
                forbidden_fields: handler_fields(),
            },
        ),
        (
            ("POST", "/mutation/{name}"),
            SessionBodyProbe {
                uri: "/mutation/missing_function",
                base: json!({ "args": {} }),
                forbidden_fields: handler_fields(),
            },
        ),
        (
            ("POST", "/action/{name}"),
            SessionBodyProbe {
                uri: "/action/missing_function",
                base: json!({ "args": {} }),
                forbidden_fields: handler_fields(),
            },
        ),
        (
            ("POST", "/connection/open"),
            SessionBodyProbe {
                uri: "/connection/open",
                base: json!({}),
                forbidden_fields: vec![
                    vec!["auth"],
                    vec!["principal"],
                    vec!["session_id"],
                    vec!["sessionId"],
                    vec!["user_id"],
                    vec!["userId"],
                ],
            },
        ),
        (
            ("POST", "/live/{name}/subscribe"),
            SessionBodyProbe {
                uri: "/live/missing_function/subscribe",
                base: json!({
                    "connection_id": "policy_probe",
                    "input": { "args": {} }
                }),
                forbidden_fields: vec![
                    vec!["input", "auth"],
                    vec!["input", "ctx_ledger", "auth_fingerprint"],
                    vec!["input", "ctx_ledger", "authFingerprint"],
                ],
            },
        ),
        (
            ("POST", "/live/{name}/resume"),
            SessionBodyProbe {
                uri: "/live/missing_function/resume",
                base: json!({
                    "subscription_id": "missing_subscription",
                    "connection_id": "policy_probe",
                    "recorded_permission_epochs": {}
                }),
                forbidden_fields: vec![vec!["auth"]],
            },
        ),
        (
            ("POST", "/live/{name}/unsubscribe"),
            SessionBodyProbe {
                uri: "/live/missing_function/unsubscribe",
                base: json!({
                    "subscription_id": "missing_subscription",
                    "connection_id": "policy_probe"
                }),
                forbidden_fields: vec![vec!["auth"]],
            },
        ),
        (
            ("POST", "/ephemeral/publish"),
            SessionBodyProbe {
                uri: "/ephemeral/publish",
                base: json!({
                    "collection": "missing_collection",
                    "scope": {},
                    "connection_id": "policy_probe",
                    "value": [],
                    "ttl_ms": null
                }),
                forbidden_fields: ephemeral_fields(),
            },
        ),
        (
            ("POST", "/ephemeral/subscribe"),
            SessionBodyProbe {
                uri: "/ephemeral/subscribe",
                base: json!({
                    "collection": "missing_collection",
                    "scope": {},
                    "connection_id": "policy_probe"
                }),
                forbidden_fields: ephemeral_fields(),
            },
        ),
        (
            ("POST", "/ephemeral/delete"),
            SessionBodyProbe {
                uri: "/ephemeral/delete",
                base: json!({
                    "collection": "missing_collection",
                    "scope": {},
                    "connection_id": "policy_probe"
                }),
                forbidden_fields: ephemeral_fields(),
            },
        ),
        (
            ("POST", "/_snapback/api/functions/{name}/run"),
            SessionBodyProbe {
                uri: "/_snapback/api/functions/missing_function/run",
                base: json!({ "args": {} }),
                forbidden_fields: handler_fields(),
            },
        ),
    ])
}

/// LLP 0031#enforcement — sessions rejection is executable policy, not just
/// registry metadata. The probe set is exactly equal to every body-bearing
/// HTTP route whose effective sessions policy rejects legacy authority, and
/// every relevant field is checked both populated and explicitly null before
/// a handler-specific error can win.
#[tokio::test]
async fn sessions_runtime_rejects_body_auth_on_every_http_ingress() {
    let state = AppState::detached(
        LocalSnapback::memory().expect("in-memory sessions HTTP policy instance"),
    )
    .with_policy_auth_mode(PolicyAuthMode::Sessions);
    let grant = state
        .connections
        .open(Some("policy_probe".to_owned()), None, true)
        .expect("known sessions connection grant");
    let router = app(state);
    let protected = route_registry()
        .into_iter()
        .filter(|route| {
            route
                .effective_for(PolicyAuthMode::Sessions)
                .legacy_body_policy
                == LegacyBodyPolicy::Rejected
        })
        .map(|route| (route.method, route.path))
        .collect::<BTreeSet<_>>();
    let probes = session_http_body_probes();
    assert_eq!(
        probes.keys().copied().collect::<BTreeSet<_>>(),
        protected,
        "sessions body-rejection probes must exactly cover effective HTTP metadata"
    );

    for route in route_registry().into_iter().filter(|route| {
        route
            .effective_for(PolicyAuthMode::Sessions)
            .legacy_body_policy
            == LegacyBodyPolicy::Rejected
    }) {
        let probe = probes
            .get(&(route.method, route.path))
            .expect("metadata-covered sessions HTTP probe");
        for (field, body) in probe.bodies() {
            let mut request = request(route.method, probe.uri, Some(body));
            if route.path_policy == RoutePolicy::ConnectionAuth {
                request.headers_mut().insert(
                    "x-snapback-connection-token",
                    grant
                        .connection_token
                        .parse()
                        .expect("connection token header"),
                );
            }
            let response = router
                .clone()
                .oneshot(request)
                .await
                .expect("sessions HTTP body-auth probe");
            assert_eq!(
                response.status(),
                StatusCode::BAD_REQUEST,
                "{field} did not fail before handler dispatch for {} {}",
                route.method,
                route.path
            );
            assert_eq!(
                diagnostic_code(response).await,
                "SNAPBACK_AUTH_BODY_AUTH_UNSUPPORTED",
                "{field} diagnostic drifted for {} {}",
                route.method,
                route.path
            );
        }
    }
}

/// Optional session resolution is optional only when the bearer is absent. A
/// presented credential can never fall back to anonymous while the provider
/// resolver is not installed.
#[tokio::test]
async fn sessions_presented_optional_bearer_fails_closed_before_dispatch() {
    let router = app(AppState::detached(
        LocalSnapback::memory().expect("in-memory optional-bearer policy instance"),
    )
    .with_policy_auth_mode(PolicyAuthMode::Sessions));
    for (uri, body) in [
        ("/query/missing_function", json!({ "args": {} })),
        ("/connection/open", json!({})),
    ] {
        let mut request = request("POST", uri, Some(body));
        request.headers_mut().insert(
            header::AUTHORIZATION,
            "Bearer unresolved_session".parse().expect("bearer header"),
        );
        let response = router
            .clone()
            .oneshot(request)
            .await
            .expect("optional-bearer fail-closed probe");
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE, "{uri}");
        assert_eq!(
            diagnostic_code(response).await,
            "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
            "{uri} treated an unresolved presented bearer as anonymous"
        );
    }
}

/// The body gate is envelope-aware: application data may legitimately use
/// identity-looking column or argument names. Only transport authority fields
/// are reserved, never descendants of `args`, `scope`, or an app value.
#[tokio::test]
async fn sessions_body_auth_rejection_does_not_scan_application_payloads() {
    let state = AppState::detached(
        LocalSnapback::memory().expect("in-memory sessions location policy instance"),
    )
    .with_policy_auth_mode(PolicyAuthMode::Sessions);
    let grant = state
        .connections
        .open(Some("policy_location".to_owned()), None, true)
        .expect("known location-aware connection grant");
    let router = app(state);
    let cases = [
        (
            "handler args",
            "/query/missing_function",
            json!({
                "args": {
                    "auth": "domain-value",
                    "principal": "domain-value",
                    "session_id": "domain-value",
                    "user_id": "domain-value",
                    "custom_key": "domain-value",
                    "auth_fingerprint": "domain-value"
                }
            }),
            false,
        ),
        (
            "ephemeral scope",
            "/ephemeral/subscribe",
            json!({
                "collection": "missing_collection",
                "scope": {
                    "auth": "domain-value",
                    "principal": "domain-value",
                    "session_id": "domain-value",
                    "user_id": "domain-value",
                    "custom_key": "domain-value",
                    "auth_fingerprint": "domain-value"
                },
                "connection_id": "policy_location"
            }),
            true,
        ),
    ];

    for (label, uri, body, connection_scoped) in cases {
        let mut request = request("POST", uri, Some(body));
        if connection_scoped {
            request.headers_mut().insert(
                "x-snapback-connection-token",
                grant
                    .connection_token
                    .parse()
                    .expect("connection token header"),
            );
        }
        let response = router
            .clone()
            .oneshot(request)
            .await
            .expect("location-aware sessions body probe");
        assert_ne!(
            diagnostic_code(response).await,
            "SNAPBACK_AUTH_BODY_AUTH_UNSUPPORTED",
            "identity-looking application {label} was mistaken for transport authority"
        );
    }
}

fn direct_runner_body_probes() -> BTreeMap<&'static str, SessionBodyProbe> {
    BTreeMap::from([
        (
            "direct_runner.query",
            SessionBodyProbe {
                uri: "/_snapback/api/functions/policy_query/run",
                base: json!({ "args": {} }),
                forbidden_fields: vec![
                    vec!["auth"],
                    vec!["ctx_ledger", "auth_fingerprint"],
                    vec!["ctx_ledger", "authFingerprint"],
                ],
            },
        ),
        (
            "direct_runner.mutation",
            SessionBodyProbe {
                uri: "/_snapback/api/functions/policy_mutation/run",
                base: json!({ "args": {} }),
                forbidden_fields: vec![
                    vec!["auth"],
                    vec!["ctx_ledger", "auth_fingerprint"],
                    vec!["ctx_ledger", "authFingerprint"],
                ],
            },
        ),
        (
            "direct_runner.action",
            SessionBodyProbe {
                uri: "/_snapback/api/functions/policy_action/run",
                base: json!({ "args": {} }),
                forbidden_fields: vec![
                    vec!["auth"],
                    vec!["ctx_ledger", "auth_fingerprint"],
                    vec!["ctx_ledger", "authFingerprint"],
                ],
            },
        ),
        (
            "direct_runner.unknown",
            SessionBodyProbe {
                uri: "/_snapback/api/functions/missing_function/run",
                base: json!({ "args": {} }),
                forbidden_fields: vec![
                    vec!["auth"],
                    vec!["ctx_ledger", "auth_fingerprint"],
                    vec!["ctx_ledger", "authFingerprint"],
                ],
            },
        ),
    ])
}

/// The direct runner is one URL but three concrete function-kind policies.
/// A valid ordinary admin credential must not mask sessions body rejection,
/// including on the query branch whose eventual read carrier is stronger.
#[tokio::test]
async fn sessions_runtime_rejects_body_auth_for_every_direct_runner_kind() {
    let state = AppState::from_snapback(runner_fixture(), exposed_context("sekrit"))
        .with_policy_auth_mode(PolicyAuthMode::Sessions);
    let router = app(state);
    let protected = operation_registry()
        .into_iter()
        .filter(|operation| {
            operation.transport == OperationTransport::DirectFunctionRunner
                && operation.effect_policy == EffectPolicy::FunctionKind
                && operation.legacy_body_policy == LegacyBodyPolicy::Allowed
        })
        .map(|operation| operation.operation)
        .collect::<BTreeSet<_>>();
    let probes = direct_runner_body_probes();
    assert_eq!(
        probes.keys().copied().collect::<BTreeSet<_>>(),
        protected,
        "direct-runner body probes must exactly cover registered function-kind branches"
    );

    for (operation, probe) in probes {
        for (field, body) in probe.bodies() {
            let mut request = request("POST", probe.uri, Some(body));
            request.headers_mut().insert(
                "x-snapback-admin-token",
                "sekrit".parse().expect("admin token header"),
            );
            let response = router
                .clone()
                .oneshot(request)
                .await
                .expect("sessions direct-runner body-auth probe");
            assert_eq!(
                response.status(),
                StatusCode::BAD_REQUEST,
                "{field} did not fail before {operation} dispatch"
            );
            assert_eq!(
                diagnostic_code(response).await,
                "SNAPBACK_AUTH_BODY_AUTH_UNSUPPORTED",
                "{field} diagnostic drifted for {operation}"
            );
        }
    }
}

#[derive(Clone)]
struct AdminPolicyProbe {
    label: &'static str,
    method: &'static str,
    uri: &'static str,
    body: Option<Value>,
}

async fn admin_policy_outcome(
    router: &axum::Router,
    probe: &AdminPolicyProbe,
    credential: Option<&str>,
) -> (StatusCode, String) {
    let mut request = request(probe.method, probe.uri, probe.body.clone());
    if let Some(credential) = credential {
        request.headers_mut().insert(
            "x-snapback-admin-token",
            credential.parse().expect("admin credential header"),
        );
    }
    let response = router
        .clone()
        .oneshot(request)
        .await
        .expect("admin policy probe");
    let status = response.status();
    (status, diagnostic_code(response).await)
}

/// A multiplexed route must not look up function kind before authenticating
/// its coarse outer floor. On a hostile bind, missing and wrong credentials
/// therefore receive one AdminRead denial across read and write branches;
/// branch-specific authorization runs only after that carrier is admitted.
#[tokio::test]
async fn hostile_bind_multiplexed_denials_use_one_pre_kind_floor() {
    let router = app(AppState::from_snapback(
        runner_fixture(),
        exposed_context("sekrit"),
    ));
    let dedicated_read = AdminPolicyProbe {
        label: "dedicated admin read",
        method: "GET",
        uri: "/_snapback/api/health",
        body: None,
    };
    let dedicated_write = AdminPolicyProbe {
        label: "dedicated admin write",
        method: "POST",
        uri: "/_snapback/api/app/reset",
        body: Some(json!({})),
    };
    let reads = [
        AdminPolicyProbe {
            label: "direct-runner query",
            method: "POST",
            uri: "/_snapback/api/functions/policy_query/run",
            body: Some(json!({ "args": {}, "auth": {} })),
        },
        AdminPolicyProbe {
            label: "host-ops function.run query",
            method: "POST",
            uri: "/_snapback/api/host-ops",
            body: Some(json!({
                "operation": "function.run",
                "function": "policy_query",
                "args": {}
            })),
        },
    ];
    let writes = [
        AdminPolicyProbe {
            label: "direct-runner mutation",
            method: "POST",
            uri: "/_snapback/api/functions/policy_mutation/run",
            body: Some(json!({ "args": {}, "auth": {} })),
        },
        AdminPolicyProbe {
            label: "direct-runner action",
            method: "POST",
            uri: "/_snapback/api/functions/policy_action/run",
            body: Some(json!({ "args": {}, "auth": {} })),
        },
        AdminPolicyProbe {
            label: "host-ops function.run mutation",
            method: "POST",
            uri: "/_snapback/api/host-ops",
            body: Some(json!({
                "operation": "function.run",
                "function": "policy_mutation",
                "args": {}
            })),
        },
        AdminPolicyProbe {
            label: "host-ops function.run action",
            method: "POST",
            uri: "/_snapback/api/host-ops",
            body: Some(json!({
                "operation": "function.run",
                "function": "policy_action",
                "args": {}
            })),
        },
        AdminPolicyProbe {
            label: "host-ops app.reset",
            method: "POST",
            uri: "/_snapback/api/host-ops",
            body: Some(json!({ "operation": "app.reset" })),
        },
        AdminPolicyProbe {
            label: "host-ops app.inspect",
            method: "POST",
            uri: "/_snapback/api/host-ops",
            body: Some(json!({ "operation": "app.inspect" })),
        },
    ];

    for (credential_label, credential) in [("missing", None), ("wrong", Some("wrong-token"))] {
        let read_floor = admin_policy_outcome(&router, &dedicated_read, credential).await;
        assert_eq!(
            read_floor,
            (StatusCode::FORBIDDEN, "SNAPBACK_ADMIN_DISABLED".to_owned()),
            "{credential_label} configured token read contract drifted"
        );
        for probe in &reads {
            assert_eq!(
                admin_policy_outcome(&router, probe, credential).await,
                read_floor,
                "{} did not match {} with a {credential_label} token",
                probe.label,
                dedicated_read.label
            );
        }

        let write_floor = admin_policy_outcome(&router, &dedicated_write, credential).await;
        assert_eq!(
            write_floor,
            (
                StatusCode::UNAUTHORIZED,
                "SNAPBACK_ADMIN_TOKEN_REQUIRED".to_owned()
            ),
            "{credential_label} configured token write contract drifted"
        );
        for probe in &writes {
            assert_eq!(
                admin_policy_outcome(&router, probe, credential).await,
                read_floor,
                "{} disclosed its write branch before the coarse carrier gate with a {credential_label} token",
                probe.label,
            );
        }
    }
}

/// Sessions has two non-substitutable authorities behind the same deferred
/// paths (secret-read lease for queries, ordinary admin for writes). Before
/// the body or function kind is known, neither an absent nor malformed carrier
/// may reach the bounded JSON peek or branch lookup.
#[tokio::test]
async fn sessions_deferred_system_routes_gate_carriers_before_body_and_kind() {
    let router = app(
        AppState::from_snapback(runner_fixture(), exposed_context("sekrit"))
            .with_policy_auth_mode(PolicyAuthMode::Sessions),
    );
    let oversized = format!(r#"{{"padding":"{}"}}"#, "x".repeat(2 * 1024 * 1024 + 1));
    for (label, uri, body) in [
        (
            "direct malformed",
            "/_snapback/api/functions/policy_mutation/run",
            "{".to_owned(),
        ),
        (
            "direct oversized",
            "/_snapback/api/functions/policy_mutation/run",
            oversized.clone(),
        ),
        (
            "direct unknown kind",
            "/_snapback/api/functions/not_a_registered_function/run",
            r#"{"args":{}}"#.to_owned(),
        ),
        ("host malformed", "/_snapback/api/host-ops", "{".to_owned()),
        (
            "host oversized",
            "/_snapback/api/host-ops",
            oversized.clone(),
        ),
        (
            "host branch selector",
            "/_snapback/api/host-ops",
            r#"{"operation":"function.run","function":"policy_query"}"#.to_owned(),
        ),
    ] {
        for (carrier_label, lease) in [("missing", None), ("invalid lease", Some("srl_wrong"))] {
            let mut request = Request::builder()
                .method("POST")
                .uri(uri)
                .header("content-type", "application/json");
            if let Some(lease) = lease {
                request = request.header("x-snapback-admin-secret-read", lease);
            }
            let response = router
                .clone()
                .oneshot(request.body(Body::from(body.clone())).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::UNAUTHORIZED, "{label}");
            assert_eq!(
                diagnostic_code(response).await,
                "SNAPBACK_ADMIN_TOKEN_REQUIRED",
                "{carrier_label} authority reached {label} body/kind selection"
            );
        }
    }
}

#[derive(Clone)]
struct SocketBodyProbe {
    frame: Value,
    forbidden_fields: Vec<Vec<&'static str>>,
}

fn session_socket_body_probes() -> BTreeMap<&'static str, SocketBodyProbe> {
    let request_fields = || {
        vec![
            vec!["request", "auth"],
            vec!["request", "principal"],
            vec!["request", "session_id"],
            vec!["request", "sessionId"],
            vec!["request", "user_id"],
            vec!["request", "userId"],
            vec!["request", "custom_key"],
            vec!["request", "customKey"],
        ]
    };
    BTreeMap::from([
        (
            "ephemeral_subscribe",
            SocketBodyProbe {
                frame: json!({
                    "type": "ephemeral_subscribe",
                    "requestId": "policy-ephemeral-subscribe",
                    "request": {
                        "collection": "missing_collection",
                        "scope": {},
                        "connection_id": "policy_ws"
                    }
                }),
                forbidden_fields: request_fields(),
            },
        ),
        (
            "ephemeral_publish",
            SocketBodyProbe {
                frame: json!({
                    "type": "ephemeral_publish",
                    "requestId": "policy-ephemeral-publish",
                    "request": {
                        "collection": "missing_collection",
                        "scope": {},
                        "connection_id": "policy_ws",
                        "value": [],
                        "ttl_ms": null
                    }
                }),
                forbidden_fields: request_fields(),
            },
        ),
        (
            "ephemeral_delete",
            SocketBodyProbe {
                frame: json!({
                    "type": "ephemeral_delete",
                    "requestId": "policy-ephemeral-delete",
                    "request": {
                        "collection": "missing_collection",
                        "scope": {},
                        "connection_id": "policy_ws"
                    }
                }),
                forbidden_fields: request_fields(),
            },
        ),
        (
            "ephemeral_unsubscribe",
            SocketBodyProbe {
                frame: json!({
                    "type": "ephemeral_unsubscribe",
                    "requestId": "policy-ephemeral-unsubscribe",
                    "request": {
                        "collection": "missing_collection",
                        "scope": {},
                        "connection_id": "policy_ws"
                    }
                }),
                forbidden_fields: request_fields(),
            },
        ),
        (
            "live_ping",
            SocketBodyProbe {
                frame: json!({
                    "type": "ping",
                    "requestId": "policy-live-ping"
                }),
                forbidden_fields: vec![
                    vec!["auth"],
                    vec!["principal"],
                    vec!["session_id"],
                    vec!["sessionId"],
                    vec!["user_id"],
                    vec!["userId"],
                    vec!["custom_key"],
                    vec!["customKey"],
                ],
            },
        ),
    ])
}

/// Socket messages are operation-registry members, not an escape hatch around
/// the HTTP gate. Exercise the real upgrade and frame dispatcher so every
/// auth-bearing variant rejects both values and explicit null before its typed
/// dev DTO or room handler can observe the payload.
#[tokio::test]
async fn sessions_runtime_rejects_body_auth_for_every_websocket_operation() {
    let state = AppState::detached(
        LocalSnapback::memory().expect("in-memory sessions socket policy instance"),
    )
    .with_policy_auth_mode(PolicyAuthMode::Sessions);
    let grant = state
        .connections
        .open(Some("policy_ws".to_owned()), None, true)
        .expect("known sessions socket grant");

    let operations = operation_registry()
        .into_iter()
        .filter(|operation| operation.transport == OperationTransport::LiveSocket)
        .collect::<Vec<_>>();
    let protected = operations
        .iter()
        .filter(|operation| {
            operation
                .effective_for(PolicyAuthMode::Sessions)
                .legacy_body_policy
                == LegacyBodyPolicy::Rejected
        })
        .map(|operation| operation.operation)
        .collect::<BTreeSet<_>>();
    let probes = session_socket_body_probes();
    assert_eq!(
        probes.keys().copied().collect::<BTreeSet<_>>(),
        protected,
        "socket body probes must exactly cover auth-bearing operation metadata"
    );
    let ping = operations
        .iter()
        .find(|operation| operation.operation == "live_ping")
        .expect("registered fieldless ping");
    assert_eq!(ping.legacy_body_policy, LegacyBodyPolicy::NotApplicable);
    assert_eq!(
        ping.effective_for(PolicyAuthMode::Sessions)
            .legacy_body_policy,
        LegacyBodyPolicy::Rejected,
        "fieldless ping must reject injected auth siblings in sessions"
    );

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind sessions socket policy server");
    let addr = listener.local_addr().expect("sessions socket address");
    let server = tokio::spawn(async move {
        axum::serve(listener, app(state))
            .await
            .expect("serve sessions socket policy app");
    });

    use tokio_tungstenite::tungstenite::client::IntoClientRequest as _;
    let mut request = format!("ws://{addr}/live/policy_ws/stream")
        .into_client_request()
        .expect("sessions socket upgrade request");
    request.headers_mut().insert(
        "x-snapback-connection-token",
        grant.connection_token.parse().expect("socket token header"),
    );
    let (mut socket, _) = tokio_tungstenite::connect_async(request)
        .await
        .expect("sessions socket upgrade");

    for (operation, probe) in probes {
        for path in probe.forbidden_fields {
            let label = path.join(".");
            let field = path.last().expect("socket forbidden field");
            for (value_label, value) in [
                ("populated", populated_legacy_field(field)),
                ("explicit-null", Value::Null),
            ] {
                let mut frame = probe.frame.clone();
                set_json_path(&mut frame, &path, value);
                socket
                    .send(tokio_tungstenite::tungstenite::Message::Text(
                        frame.to_string().into(),
                    ))
                    .await
                    .expect("send sessions socket policy frame");
                let reply = tokio::time::timeout(Duration::from_secs(2), socket.next())
                    .await
                    .unwrap_or_else(|_| {
                        panic!("timed out waiting for {operation} {label} ({value_label})")
                    })
                    .expect("sessions socket stayed open")
                    .expect("sessions socket reply");
                let reply: Value = serde_json::from_str(
                    &reply
                        .into_text()
                        .expect("sessions socket policy text reply"),
                )
                .expect("sessions socket policy JSON reply");
                assert_eq!(
                    reply["diagnostic"]["code"], "SNAPBACK_AUTH_BODY_AUTH_UNSUPPORTED",
                    "{operation} accepted {label} ({value_label}): {reply}"
                );
            }
        }
    }

    server.abort();
}

#[derive(Clone)]
struct ConnectionProbe {
    uri: &'static str,
    body: Option<Value>,
    websocket_upgrade: bool,
}

fn connection_request(method: &str, probe: &ConnectionProbe) -> Request<Body> {
    let mut request = request(method, probe.uri, probe.body.clone());
    if probe.websocket_upgrade {
        let headers = request.headers_mut();
        headers.insert(header::CONNECTION, "upgrade".parse().expect("connection"));
        headers.insert(header::UPGRADE, "websocket".parse().expect("upgrade"));
        headers.insert(
            header::SEC_WEBSOCKET_VERSION,
            "13".parse().expect("websocket version"),
        );
        headers.insert(
            header::SEC_WEBSOCKET_KEY,
            "dGhlIHNhbXBsZSBub25jZQ==".parse().expect("websocket key"),
        );
    }
    request
}

fn connection_probes() -> BTreeMap<(&'static str, &'static str), ConnectionProbe> {
    let anonymous = json!({
        "principal": null,
        "session_id": null,
        "user_id": null,
        "permissions": []
    });
    BTreeMap::from([
        (
            ("POST", "/live/{name}/subscribe"),
            ConnectionProbe {
                uri: "/live/missing_function/subscribe",
                body: Some(json!({
                    "connection_id": "policy_probe",
                    "input": { "args": {}, "auth": {} }
                })),
                websocket_upgrade: false,
            },
        ),
        (
            ("POST", "/live/{name}/resume"),
            ConnectionProbe {
                uri: "/live/missing_function/resume",
                body: Some(json!({
                    "subscription_id": "missing_subscription",
                    "connection_id": "policy_probe",
                    "auth": {},
                    "recorded_permission_epochs": {}
                })),
                websocket_upgrade: false,
            },
        ),
        (
            ("POST", "/live/{name}/unsubscribe"),
            ConnectionProbe {
                uri: "/live/missing_function/unsubscribe",
                body: Some(json!({
                    "subscription_id": "missing_subscription",
                    "connection_id": "policy_probe",
                    "auth": {}
                })),
                websocket_upgrade: false,
            },
        ),
        (
            ("GET", "/live/{connection_id}/stream"),
            ConnectionProbe {
                uri: "/live/policy_probe/stream",
                body: None,
                websocket_upgrade: true,
            },
        ),
        (
            ("GET", "/outbox/{connection_id}"),
            ConnectionProbe {
                uri: "/outbox/policy_probe",
                body: None,
                websocket_upgrade: false,
            },
        ),
        (
            ("POST", "/ephemeral/publish"),
            ConnectionProbe {
                uri: "/ephemeral/publish",
                body: Some(json!({
                    "collection": "missing_collection",
                    "scope": {},
                    "connection_id": "policy_probe",
                    "session_id": null,
                    "user_id": null,
                    "custom_key": null,
                    "value": [],
                    "ttl_ms": null,
                    "auth": anonymous.clone()
                })),
                websocket_upgrade: false,
            },
        ),
        (
            ("POST", "/ephemeral/subscribe"),
            ConnectionProbe {
                uri: "/ephemeral/subscribe",
                body: Some(json!({
                    "collection": "missing_collection",
                    "scope": {},
                    "connection_id": "policy_probe",
                    "auth": anonymous.clone()
                })),
                websocket_upgrade: false,
            },
        ),
        (
            ("POST", "/ephemeral/delete"),
            ConnectionProbe {
                uri: "/ephemeral/delete",
                body: Some(json!({
                    "collection": "missing_collection",
                    "scope": {},
                    "connection_id": "policy_probe",
                    "session_id": null,
                    "user_id": null,
                    "custom_key": null,
                    "auth": anonymous
                })),
                websocket_upgrade: false,
            },
        ),
    ])
}

/// LLP 0031#connection-capability-grants — every route whose registry policy
/// is `ConnectionAuth` has runtime teeth: missing bearer is 401 and a wrong
/// bearer is 403. Coverage is an exact equality against registry metadata, so
/// adding a connection route without an executable denial probe fails CI.
#[tokio::test]
async fn every_connection_auth_route_enforces_runtime_401_and_403() {
    let state =
        AppState::detached(LocalSnapback::memory().expect("in-memory connection-policy instance"));
    state
        .connections
        .open(Some("policy_probe".to_owned()), None, true)
        .expect("known connection grant");
    let router = app(state);

    let protected = route_registry()
        .into_iter()
        .filter(|route| route.policy == RoutePolicy::ConnectionAuth)
        .map(|route| (route.method, route.path))
        .collect::<BTreeSet<_>>();
    let probes = connection_probes();
    let covered = probes.keys().copied().collect::<BTreeSet<_>>();
    assert_eq!(
        covered, protected,
        "connection-policy runtime probes must exactly cover registry metadata"
    );

    for RouteSpec { method, path, .. } in route_registry()
        .into_iter()
        .filter(|route| route.policy == RoutePolicy::ConnectionAuth)
    {
        let probe = probes.get(&(method, path)).expect("covered probe");
        let missing = router
            .clone()
            .oneshot(connection_request(method, probe))
            .await
            .expect("missing-token probe");
        assert_eq!(
            missing.status(),
            StatusCode::UNAUTHORIZED,
            "missing bearer must be 401 for {method} {path}"
        );
        assert_eq!(
            missing
                .headers()
                .get(header::CACHE_CONTROL)
                .and_then(|value| value.to_str().ok()),
            Some("no-store, private"),
            "auth failure must not be cacheable for {method} {path}"
        );
        assert_eq!(
            diagnostic_code(missing).await,
            "SNAPBACK_CONNECTION_TOKEN_REQUIRED",
            "missing bearer diagnostic drifted for {method} {path}"
        );

        let mut wrong = connection_request(method, probe);
        wrong.headers_mut().insert(
            "x-snapback-connection-token",
            "sct_deliberately_wrong".parse().expect("header value"),
        );
        let wrong = router
            .clone()
            .oneshot(wrong)
            .await
            .expect("wrong-token probe");
        assert_eq!(
            wrong.status(),
            StatusCode::FORBIDDEN,
            "wrong bearer must be 403 for {method} {path}"
        );
        assert_eq!(
            wrong
                .headers()
                .get(header::CACHE_CONTROL)
                .and_then(|value| value.to_str().ok()),
            Some("no-store, private"),
            "auth failure must not be cacheable for {method} {path}"
        );
        assert_eq!(
            diagnostic_code(wrong).await,
            "SNAPBACK_CONNECTION_TOKEN_INVALID",
            "wrong bearer diagnostic drifted for {method} {path}"
        );
    }
}

/// LLP 0031#enforcement — a body-carried connection id cannot force JSON
/// parsing before its independently-carried bearer is authenticated. Sweep
/// every such registry row with malformed and over-limit bodies so a newly
/// added route cannot silently reintroduce the ordering bypass.
#[tokio::test]
async fn connection_carriers_are_authenticated_before_any_body_inspection() {
    let state = AppState::detached(LocalSnapback::memory().expect("connection body-order fixture"));
    let grant = state
        .connections
        .open(Some("policy_probe".to_owned()), None, true)
        .expect("known connection grant");
    let router = app(state);
    let body_routes = route_registry()
        .into_iter()
        .filter(|route| {
            route.path_policy == RoutePolicy::ConnectionAuth
                && !matches!(
                    route.path,
                    "/live/{connection_id}/stream" | "/outbox/{connection_id}"
                )
        })
        .collect::<Vec<_>>();
    assert!(!body_routes.is_empty());

    let malformed = br#"{"connection_id":"policy_probe","value":nope}"#.to_vec();
    let oversized = format!(
        r#"{{"connection_id":"policy_probe","padding":"{}"}}"#,
        "x".repeat(2 * 1024 * 1024 + 1)
    )
    .into_bytes();

    for route in body_routes {
        let uri = materialize_path(route.path);
        for (body_label, body) in [("malformed", &malformed), ("oversized", &oversized)] {
            for (carrier_label, carrier, status, code) in [
                (
                    "missing",
                    None,
                    StatusCode::UNAUTHORIZED,
                    "SNAPBACK_CONNECTION_TOKEN_REQUIRED",
                ),
                (
                    "wrong",
                    Some("sct_deliberately_wrong"),
                    StatusCode::FORBIDDEN,
                    "SNAPBACK_CONNECTION_TOKEN_INVALID",
                ),
            ] {
                let mut request = Request::builder()
                    .method(route.method)
                    .uri(&uri)
                    .header("content-type", "application/json");
                if let Some(carrier) = carrier {
                    request = request.header("x-snapback-connection-token", carrier);
                }
                let response = router
                    .clone()
                    .oneshot(request.body(Body::from(body.clone())).unwrap())
                    .await
                    .unwrap();
                assert_eq!(
                    response.status(),
                    status,
                    "{carrier_label} carrier lost to {body_label} body on {} {}",
                    route.method,
                    route.path
                );
                assert_eq!(
                    diagnostic_code(response).await,
                    code,
                    "{carrier_label} carrier diagnostic lost to {body_label} body on {} {}",
                    route.method,
                    route.path
                );
            }
        }

        let malformed_with_valid_carrier = Request::builder()
            .method(route.method)
            .uri(&uri)
            .header("content-type", "application/json")
            .header(
                "x-snapback-connection-token",
                grant.connection_token.as_str(),
            )
            .body(Body::from(malformed.clone()))
            .unwrap();
        let response = router
            .clone()
            .oneshot(malformed_with_valid_carrier)
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST, "{uri}");
        assert_eq!(
            diagnostic_code(response).await,
            "SNAPBACK_REQUEST_JSON_INVALID",
            "valid bearer should admit typed JSON rejection for {uri}"
        );

        let oversized_with_valid_carrier = Request::builder()
            .method(route.method)
            .uri(&uri)
            .header("content-type", "application/json")
            .header(
                "x-snapback-connection-token",
                grant.connection_token.as_str(),
            )
            .body(Body::from(oversized.clone()))
            .unwrap();
        let response = router
            .clone()
            .oneshot(oversized_with_valid_carrier)
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE, "{uri}");
        assert_eq!(
            diagnostic_code(response).await,
            "SNAPBACK_VALUE_TOO_LARGE",
            "valid bearer should admit the bounded body gate for {uri}"
        );
    }
}
