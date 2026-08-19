//! ENG-24595: `/app/ensure` is a closed intent family whose provisioning
//! branch is authorized before hashes or effects.

fn test_app_state_from_snapback(
    snapback: snapback::local::LocalSnapback,
    context: snapback::admin::ServerContext,
) -> snapback::admin::AppState {
    snapback::admin::AppState::try_from_snapback(snapback, context).expect("test app state")
}

use serde_json::{Value, json};
use snapback::admin::{ServerContext, ServerProfile};
use snapback::auth::mode::{
    AuthModeStatus, FUNCTION_V1_PREFIX, INPUTS_V1_PREFIX, SCHEMA_V1_PREFIX,
};
use snapback::local::{EnsureAppInput, EnsureAppRequest, LocalSnapback};
use snapback::manifest::{AuthManifest, AuthMode, FunctionManifest, SchemaManifest};
use snapback::server::{
    CredentialResolution, InvocationAuthority, OperationTransport, PolicyAuthMode, RoutePolicy,
    app, operation_registry,
};
use snapback_server::test_support::axum::body::{Body, to_bytes};
use snapback_server::test_support::axum::http::{Request, StatusCode};
use tower::ServiceExt;

const ADMIN_TOKEN: &str = "ensure-admin-token";

fn context(profile: ServerProfile) -> ServerContext {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let mut context = ServerContext::from_bound_listener(&listener).unwrap();
    context.profile = profile;
    context.admin_token = Some(ADMIN_TOKEN.to_owned());
    context
}

fn manifests() -> (SchemaManifest, FunctionManifest) {
    let schema = SchemaManifest {
        app_id: "ensure-app".to_owned(),
        schema_hash: Some("sha256:ensure-schema".to_owned()),
        inputs_hash: Some("sha256:ensure-inputs".to_owned()),
        ..SchemaManifest::default()
    };
    let functions = FunctionManifest {
        app_id: "ensure-app".to_owned(),
        bundle_hash: Some("sha256:ensure-functions".to_owned()),
        inputs_hash: Some("sha256:ensure-inputs".to_owned()),
        ..FunctionManifest::default()
    };
    (schema, functions)
}

fn provision_body() -> Value {
    let (schema, functions) = manifests();
    json!({
        "intent": "provision",
        "requestedMode": "dev",
        "schema": schema,
        "functions": functions,
    })
}

fn sessions_provision_body() -> Value {
    let schema_hash = format!("{SCHEMA_V1_PREFIX}{}", "4".repeat(64));
    let bundle_hash = format!("{FUNCTION_V1_PREFIX}{}", "5".repeat(64));
    let inputs_hash = format!("{INPUTS_V1_PREFIX}{}", "6".repeat(64));
    let schema = SchemaManifest {
        schema_version: "snapback.v1".to_owned(),
        app_id: "ensure-app".to_owned(),
        auth: Some(AuthManifest {
            mode: AuthMode::Sessions,
            agents: None,
            password_identifier_mode: None,
            password_minimum_length: None,
        }),
        required_capabilities: vec!["auth.sessions.v1".to_owned()],
        schema_hash: Some(schema_hash),
        inputs_hash: Some(inputs_hash.clone()),
        ..SchemaManifest::default()
    };
    let functions = FunctionManifest {
        schema_version: "snapback.v1".to_owned(),
        app_id: "ensure-app".to_owned(),
        bundle_hash: Some(bundle_hash),
        inputs_hash: Some(inputs_hash),
        ..FunctionManifest::default()
    };
    json!({
        "intent": "provision",
        "requestedMode": "sessions",
        "schema": schema,
        "functions": functions,
    })
}

fn attest_pair(version: &str, schema_hash: &str, bundle_hash: &str) -> Value {
    json!({
        "schema": {
            "artifactKind": "schemaManifest",
            "schemaVersion": version,
            "appId": "ensure-app",
            "schemaHash": schema_hash,
            "inputsHash": "sha256:ensure-inputs",
        },
        "functions": {
            "artifactKind": "functionManifest",
            "schemaVersion": version,
            "appId": "ensure-app",
            "bundleHash": bundle_hash,
            "inputsHash": "sha256:ensure-inputs",
        }
    })
}

fn valid_sessions_attest_pair() -> Value {
    json!({
        "schema": {
            "artifactKind": "schemaManifest",
            "schemaVersion": "snapback.v1",
            "appId": "ensure-app",
            "schemaHash": format!("{SCHEMA_V1_PREFIX}{}", "1".repeat(64)),
            "inputsHash": format!("{INPUTS_V1_PREFIX}{}", "2".repeat(64)),
        },
        "functions": {
            "artifactKind": "functionManifest",
            "schemaVersion": "snapback.v1",
            "appId": "ensure-app",
            "bundleHash": format!("{FUNCTION_V1_PREFIX}{}", "3".repeat(64)),
            "inputsHash": format!("{INPUTS_V1_PREFIX}{}", "2".repeat(64)),
        }
    })
}

fn post(body: Value, token: Option<&str>) -> Request<Body> {
    let mut builder = Request::builder()
        .method("POST")
        .uri("/app/ensure")
        .header("content-type", "application/json");
    if let Some(token) = token {
        builder = builder.header("x-snapback-admin-token", token);
    }
    builder
        .body(Body::from(
            serde_json::to_vec(&body).expect("serialize ensure request"),
        ))
        .expect("build ensure request")
}

async fn response_json(response: snapback_server::test_support::axum::response::Response) -> Value {
    let bytes = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read ensure response");
    serde_json::from_slice(&bytes).expect("ensure response JSON")
}

async fn fingerprint(state: &snapback::server::SharedSnapback) -> Value {
    let mut snapback = state.lock().await;
    let inspect = snapback.inspect().expect("inspect ensure state");
    json!({
        "schemaVersion": inspect.schema.schema_version,
        "schemaHash": inspect.schema.schema_hash,
        "bundleHash": inspect.functions.bundle_hash,
        "inputsHash": inspect.functions.inputs_hash,
        "storageVersion": inspect.storage.version,
        "tables": inspect.schema.tables,
        "functionCount": inspect.functions.functions.len(),
    })
}

#[test]
fn ensure_request_union_is_closed_and_cross_variant_fields_do_not_fall_back() {
    let (schema, functions) = manifests();
    let legacy = json!({ "schema": schema, "functions": functions });
    assert!(serde_json::from_value::<EnsureAppRequest>(legacy).is_ok());

    for invalid in [
        json!({ "schema": manifests().0, "requestedMode": "sessions" }),
        json!({
            "intent": "attest",
            "requestedMode": "sessions",
            "pair": attest_pair("snapback.v1", "schema", "bundle"),
            "schema": manifests().0,
        }),
        json!({
            "intent": "provision",
            "requestedMode": "dev",
            "schema": manifests().0,
            "pair": attest_pair("snapback.v0", "schema", "bundle"),
        }),
        json!({ "intent": "unknown", "requestedMode": "dev" }),
        json!({ "intent": 7, "requestedMode": "dev" }),
    ] {
        assert!(
            serde_json::from_value::<EnsureAppRequest>(invalid.clone()).is_err(),
            "cross-variant request unexpectedly parsed: {invalid}"
        );
    }

    let explicit_dev_attest = serde_json::from_value::<EnsureAppRequest>(json!({
        "intent": "attest",
        "requestedMode": "dev",
        "pair": attest_pair("snapback.v0", "schema", "bundle"),
    }))
    .expect("closed shape parses before semantic validation");
    let EnsureAppRequest::Explicit(explicit_dev_attest) = explicit_dev_attest else {
        panic!("intent-bearing request fell back to legacy");
    };
    assert!(
        explicit_dev_attest.validate().is_err(),
        "LLP 0012 defines explicit attestation only for v1 sessions"
    );

    let empty_provision = serde_json::from_value::<EnsureAppRequest>(json!({
        "intent": "provision",
        "requestedMode": "dev",
    }))
    .expect("empty provision parses before effect-set validation");
    let EnsureAppRequest::Explicit(empty_provision) = empty_provision else {
        panic!("explicit provision fell back to legacy");
    };
    assert!(empty_provision.validate().is_err());
}

#[test]
fn explicit_provision_metadata_is_admin_write_in_both_modes() {
    let provision = operation_registry()
        .into_iter()
        .find(|operation| operation.operation == "app.ensure.provision")
        .expect("registered provision branch");
    assert_eq!(provision.transport, OperationTransport::EnsureApp);
    for mode in [PolicyAuthMode::Dev, PolicyAuthMode::Sessions] {
        let policy = provision.effective_for(mode);
        assert_eq!(policy.path_policy, RoutePolicy::AdminWrite);
        assert_eq!(
            policy.credential_resolution,
            CredentialResolution::AdminCredential
        );
        assert_eq!(policy.invocation_authority, InvocationAuthority::Operator);
    }
}

#[tokio::test]
async fn explicit_provision_requires_admin_before_equal_hashes_or_effects() {
    let state = test_app_state_from_snapback(
        LocalSnapback::memory().expect("ensure instance"),
        context(ServerProfile::Dev),
    );
    let controller = state.auth_admission_controller();
    let root = controller.admit().expect("unrelated same-mode root");
    let before_admission = controller.snapshot();
    let shared = state.snapback.clone();
    let router = app(state);

    let provisioned = router
        .clone()
        .oneshot(post(provision_body(), Some(ADMIN_TOKEN)))
        .await
        .expect("authorized provision");
    assert_eq!(provisioned.status(), StatusCode::OK);
    assert_eq!(response_json(provisioned).await["intent"], "provision");
    let after_admission = controller.snapshot();
    assert_eq!(
        after_admission.admission_epoch,
        before_admission.admission_epoch
    );
    assert!(after_admission.accepting);
    assert!(!root.is_cancelled());
    let before = fingerprint(&shared).await;

    // The candidate now has exactly the loaded hashes. Authorization must win
    // before the old equality shortcut can report `matched`.
    let denied = router
        .oneshot(post(provision_body(), None))
        .await
        .expect("denied equal-hash provision");
    assert_eq!(denied.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        response_json(denied).await["diagnostic"]["code"],
        "SNAPBACK_ADMIN_TOKEN_REQUIRED"
    );
    assert_eq!(fingerprint(&shared).await, before);
}

#[tokio::test]
async fn cross_mode_provision_commits_pending_state_and_closes_admission_before_success() {
    let state = test_app_state_from_snapback(
        LocalSnapback::memory().expect("cross-mode ensure instance"),
        context(ServerProfile::Dev),
    );
    let controller = state.auth_admission_controller();
    let initial = controller.snapshot();
    let runtime = state.clone();
    let router = app(state);
    let provisioned = router
        .clone()
        .oneshot(post(sessions_provision_body(), Some(ADMIN_TOKEN)))
        .await
        .expect("stage sessions provision");
    assert_eq!(provisioned.status(), StatusCode::OK);
    assert_eq!(response_json(provisioned).await["intent"], "provision");

    let published = controller.snapshot();
    assert_ne!(published.admission_epoch, initial.admission_epoch);
    assert_eq!(published.transition_generation, 1);
    assert!(!published.accepting);
    assert_eq!(
        controller.admit().unwrap_err().diagnostic.code,
        "SNAPBACK_AUTH_MODE_PENDING"
    );
    let published_mode = runtime.auth_mode_state();
    assert_eq!(published_mode.active, AuthMode::Dev);
    assert_eq!(published_mode.desired, AuthMode::Sessions);
    assert_eq!(published_mode.mode_state, AuthModeStatus::PendingRestart);

    let refused = router
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
        "SNAPBACK_AUTH_MODE_PENDING"
    );
}

#[tokio::test]
async fn requested_active_desired_posture_blocks_public_branches_but_keeps_recovery() {
    let state = test_app_state_from_snapback(
        LocalSnapback::memory().expect("pending ensure instance"),
        context(ServerProfile::Dev),
    )
    .with_policy_auth_posture(PolicyAuthMode::Dev, PolicyAuthMode::Sessions);
    let shared = state.snapback.clone();
    let router = app(state);
    let before = fingerprint(&shared).await;

    let legacy = router
        .clone()
        .oneshot(post(json!({ "schema": manifests().0 }), None))
        .await
        .expect("pending legacy ensure");
    assert_eq!(legacy.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        response_json(legacy).await["diagnostic"]["code"],
        "SNAPBACK_AUTH_MODE_PENDING"
    );

    let attest = router
        .clone()
        .oneshot(post(
            json!({
                "intent": "attest",
                "requestedMode": "sessions",
                "pair": attest_pair("snapback.v1", "schema", "bundle"),
            }),
            None,
        ))
        .await
        .expect("pending attest ensure");
    assert_eq!(attest.status(), StatusCode::SERVICE_UNAVAILABLE);

    let denied_recovery = router
        .clone()
        .oneshot(post(provision_body(), None))
        .await
        .expect("pending provision without AdminWrite");
    assert_eq!(denied_recovery.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(fingerprint(&shared).await, before);

    let recovered = router
        .oneshot(post(provision_body(), Some(ADMIN_TOKEN)))
        .await
        .expect("authorized pending recovery");
    assert_eq!(recovered.status(), StatusCode::OK);
    assert_ne!(fingerprint(&shared).await, before);
}

#[tokio::test]
async fn public_sessions_attest_requires_exact_durable_sessions_posture_and_rejects_smuggled_effects()
 {
    let mut snapback = LocalSnapback::memory().expect("attest ensure instance");
    let (schema, functions) = manifests();
    snapback
        .ensure_app(
            EnsureAppInput {
                routes: None,
                schema: Some(schema),
                functions: Some(functions),
                seed: None,
            },
            true,
            "dev",
        )
        .expect("prepare loaded v0 pair");
    let state = test_app_state_from_snapback(snapback, context(ServerProfile::Dev))
        .with_policy_auth_mode(PolicyAuthMode::Sessions);
    let shared = state.snapback.clone();
    let router = app(state);
    let before = fingerprint(&shared).await;

    let compared = router
        .clone()
        .oneshot(post(
            json!({
                "intent": "attest",
                "requestedMode": "sessions",
                "pair": valid_sessions_attest_pair(),
            }),
            None,
        ))
        .await
        .expect("public sessions attest");
    assert_eq!(compared.status(), StatusCode::SERVICE_UNAVAILABLE);
    let compared = response_json(compared).await;
    assert_eq!(
        compared["diagnostic"]["code"],
        "SNAPBACK_AUTH_POLICY_UNAVAILABLE"
    );
    assert_eq!(fingerprint(&shared).await, before);

    let smuggled = router
        .oneshot(post(
            json!({
                "intent": "attest",
                "requestedMode": "sessions",
                "pair": attest_pair("snapback.v1", "v1-schema", "v1-bundle"),
                "schema": manifests().0,
            }),
            None,
        ))
        .await
        .expect("smuggled attest effect");
    assert_eq!(smuggled.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_json(smuggled).await["diagnostic"]["code"],
        "SNAPBACK_REQUEST_JSON_INVALID"
    );
    assert_eq!(fingerprint(&shared).await, before);
}

#[tokio::test]
async fn unknown_or_non_string_intent_takes_strongest_gate_before_shape_error() {
    let router = app(test_app_state_from_snapback(
        LocalSnapback::memory().expect("unknown-intent ensure instance"),
        context(ServerProfile::Dev),
    ));
    for intent in [json!("unknown"), json!(7)] {
        let denied = router
            .clone()
            .oneshot(post(json!({ "intent": intent }), None))
            .await
            .expect("unknown intent without token");
        assert_eq!(denied.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(
            response_json(denied).await["diagnostic"]["code"],
            "SNAPBACK_ADMIN_TOKEN_REQUIRED"
        );

        let typed = router
            .clone()
            .oneshot(post(json!({ "intent": intent }), Some(ADMIN_TOKEN)))
            .await
            .expect("unknown intent with strongest credential");
        assert_eq!(typed.status(), StatusCode::BAD_REQUEST);
        assert_eq!(
            response_json(typed).await["diagnostic"]["code"],
            "SNAPBACK_REQUEST_JSON_INVALID"
        );
    }
}

#[tokio::test]
async fn explicit_provision_profile_gate_runs_before_core_effects() {
    let state = test_app_state_from_snapback(
        LocalSnapback::memory().expect("prod ensure instance"),
        context(ServerProfile::Prod),
    );
    let shared = state.snapback.clone();
    let before = fingerprint(&shared).await;
    let response = app(state)
        .oneshot(post(provision_body(), Some(ADMIN_TOKEN)))
        .await
        .expect("prod provision response");
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        response_json(response).await["diagnostic"]["code"],
        "SNAPBACK_PROFILE_FORBIDS"
    );
    assert_eq!(fingerprint(&shared).await, before);
}

#[test]
fn equal_hash_invalid_artifact_version_is_rejected_before_match_or_partial_apply() {
    let mut snapback = LocalSnapback::memory().expect("artifact preflight instance");
    let (schema, functions) = manifests();
    snapback
        .ensure_app(
            EnsureAppInput {
                routes: None,
                schema: Some(schema.clone()),
                functions: Some(functions),
                seed: None,
            },
            true,
            "dev",
        )
        .expect("prepare matching artifacts");

    let mut invalid_equal_hash = schema.clone();
    invalid_equal_hash.schema_version = "snapback.v999".to_owned();
    let before = snapback.inspect().expect("before invalid equal hash");
    let error = snapback
        .ensure_app(
            EnsureAppInput {
                routes: None,
                schema: Some(invalid_equal_hash),
                functions: None,
                seed: None,
            },
            true,
            "dev",
        )
        .expect_err("equal hash must not bypass artifact version validation");
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_STALE_SCHEMA_ARTIFACT_VERSION"
    );
    let after = snapback.inspect().expect("after invalid equal hash");
    assert_eq!(after.schema, before.schema);
    assert_eq!(after.functions, before.functions);
    assert_eq!(after.storage.version, before.storage.version);

    let mut fresh = LocalSnapback::memory().expect("two-half preflight instance");
    let mut invalid_functions = manifests().1;
    invalid_functions.schema_version = "snapback.v999".to_owned();
    let error = fresh
        .ensure_app(
            EnsureAppInput {
                routes: None,
                schema: Some(schema),
                functions: Some(invalid_functions),
                seed: None,
            },
            true,
            "dev",
        )
        .expect_err("invalid second half must reject before schema apply");
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_STALE_FUNCTION_ARTIFACT_VERSION"
    );
    assert_eq!(fresh.loaded_schema_hash(), None);
}
