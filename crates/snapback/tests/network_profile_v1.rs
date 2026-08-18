//! Rust-arm acceptance for LLP 0167 network-condition profiles.
//!
//! Timing synchronization is entirely response/frame-driven: the tests never
//! sleep to guess whether a deadline has elapsed.

fn test_app_state_from_snapback(
    snapback: snapback::local::LocalSnapback,
    context: snapback::admin::ServerContext,
) -> snapback::admin::AppState {
    snapback::admin::AppState::try_from_snapback(snapback, context).expect("test app state")
}

use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode, header};
use futures_util::StreamExt;
use serde_json::{Value, json};
use snapback::admin::{AppState, ServerContext, ServerProfile};
use snapback::local::{LiveSubscribeInput, LocalSnapback};
use snapback::manifest::{
    AuthInput, FieldManifest, FieldType, FunctionDefinition, FunctionKind, FunctionManifest,
    FunctionRuntime, HandlerInput, HandlerPlan, MutationPlan, MutationStep, OrderDirection,
    OrderExpr, QueryPlan, SchemaManifest, TableManifest, ValueExpr,
};
use snapback::network_profile::NETWORK_PROFILE_HEADER;
use snapback::server::{PolicyAuthMode, SnapbackApp};
use std::collections::BTreeMap;
use std::path::Path;
use std::process::Stdio;
use std::time::{Duration, Instant};
use tokio::io::AsyncReadExt;
use tokio::net::TcpListener;
use tokio::process::{Child, Command};
use tokio_tungstenite::tungstenite::client::IntoClientRequest as _;
use tower::ServiceExt;

const ADMIN_TOKEN: &str = "network-profile-acceptance";
const DELAY: Duration = Duration::from_millis(120);

#[derive(Debug)]
struct FixtureRun {
    ack_latency: Duration,
    actor_latency: Duration,
    observer_latency: Duration,
    marker: Option<String>,
    actor_frame_marker: Option<String>,
    observer_frame_marker: Option<String>,
    commit_projection: Value,
}

/// Equal mutation/live lanes use one commit-relative deadline over two real
/// socket connections, while the timestamp-free state facts remain identical
/// to the identity-profile run.
///
/// @ref LLP 0167#acceptance — actor ack and observer deltas move in wall time,
/// while versions and settlement facts do not.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn equal_lane_profile_delays_ack_and_socket_deltas_without_moving_commit_facts() {
    let normal = run_socket_fixture(false).await;
    let delayed = run_socket_fixture(true).await;

    assert!(delayed.ack_latency >= DELAY, "ack: {delayed:?}");
    assert!(delayed.actor_latency >= DELAY, "actor delta: {delayed:?}");
    assert!(
        delayed.observer_latency >= DELAY,
        "observer delta: {delayed:?}"
    );
    assert_eq!(delayed.commit_projection, normal.commit_projection);
    assert_eq!(delayed.marker.as_deref(), Some("equal-lane-acceptance"));
    assert_eq!(normal.marker, None);
    assert_eq!(
        delayed.actor_frame_marker.as_deref(),
        Some("equal-lane-acceptance")
    );
    assert_eq!(
        delayed.observer_frame_marker.as_deref(),
        Some("equal-lane-acceptance")
    );
    assert_eq!(normal.actor_frame_marker, None);
    assert_eq!(normal.observer_frame_marker, None);

    for delta_latency in [delayed.actor_latency, delayed.observer_latency] {
        assert!(
            delta_latency.abs_diff(delayed.ack_latency) < Duration::from_millis(80),
            "equal commit deadlines may differ only by scheduler noise: {delayed:?}"
        );
    }
}

/// Policy/body refusals are result-readiness responses even though they never
/// enter the function handler. Handler-origin responses retain their existing
/// release and therefore cannot pay the lane delay twice.
#[tokio::test]
async fn middleware_refusals_are_profiled_and_handler_responses_release_once() {
    let (_, normal) = test_app();
    let normal_refusal_started = Instant::now();
    let normal_refusal = normal
        .clone()
        .oneshot(raw_json("/query/listTodos", "{"))
        .await
        .expect("normal invalid query response");
    let normal_refusal_elapsed = normal_refusal_started.elapsed();
    assert_eq!(normal_refusal.status(), StatusCode::BAD_REQUEST);
    assert_eq!(profile_marker(&normal_refusal), None);

    let normal_handler_started = Instant::now();
    let normal_handled = normal
        .oneshot(post_json(
            "/mutation/createTodo",
            json!({ "args": { "title": "baseline" }, "auth": { "user_id": "user_1" } }),
        ))
        .await
        .expect("normal handler mutation response");
    let normal_handler_elapsed = normal_handler_started.elapsed();
    assert_eq!(normal_handled.status(), StatusCode::OK);

    let (state, app) = profiled_app().await;

    let invalid_started = Instant::now();
    let invalid = app
        .clone()
        .oneshot(raw_json("/query/listTodos", "{"))
        .await
        .expect("invalid query response");
    let invalid_elapsed = invalid_started.elapsed();
    assert_eq!(invalid.status(), StatusCode::BAD_REQUEST);
    assert!(
        invalid_elapsed >= DELAY,
        "invalid body: {invalid_elapsed:?}"
    );
    assert_eq!(profile_marker(&invalid), Some("middleware-acceptance"));

    // Flip the shared policy projection after activation. The missing session
    // bearer is refused by the route gate, before the query handler runs.
    let _ = state
        .clone()
        .with_policy_auth_posture(PolicyAuthMode::Sessions, PolicyAuthMode::Sessions);
    let unauthorized_started = Instant::now();
    let unauthorized = app
        .clone()
        .oneshot(post_json(
            "/query/listTodos",
            json!({ "args": {}, "auth": {} }),
        ))
        .await
        .expect("auth-gate refusal");
    let unauthorized_elapsed = unauthorized_started.elapsed();
    assert!(!unauthorized.status().is_success());
    assert!(
        unauthorized_elapsed >= DELAY,
        "auth refusal: {unauthorized_elapsed:?}"
    );
    assert_eq!(profile_marker(&unauthorized), Some("middleware-acceptance"));

    // Return to dev mode so a real handler response supplies the double-delay
    // witness. Compare its added cost with the measured unprofiled handler
    // and profiled refusal instead of imposing a machine-speed ceiling.
    let _ = state
        .clone()
        .with_policy_auth_posture(PolicyAuthMode::Dev, PolicyAuthMode::Dev);
    let handler_started = Instant::now();
    let handled = app
        .clone()
        .oneshot(post_json(
            "/mutation/createTodo",
            json!({ "args": { "title": "single release" }, "auth": { "user_id": "user_1" } }),
        ))
        .await
        .expect("handler mutation response");
    let handler_elapsed = handler_started.elapsed();
    assert_eq!(handled.status(), StatusCode::OK);
    assert!(
        handler_elapsed >= DELAY,
        "handler response: {handler_elapsed:?}"
    );
    let handler_profile_cost = handler_elapsed.saturating_sub(normal_handler_elapsed);
    let refusal_profile_cost = invalid_elapsed.saturating_sub(normal_refusal_elapsed);
    assert!(
        handler_profile_cost < refusal_profile_cost + DELAY / 2,
        "handler response appears double-delayed: handler={handler_elapsed:?} \
         normal_handler={normal_handler_elapsed:?} refusal={invalid_elapsed:?} \
         normal_refusal={normal_refusal_elapsed:?}"
    );
    assert_eq!(profile_marker(&handled), Some("middleware-acceptance"));

    // The action route shares the policy tower but has no successful-response
    // profile lane. Its pre-handler shape refusal uses queryResponseDelay.
    let action_started = Instant::now();
    let action = app
        .clone()
        .oneshot(raw_json("/action/noSuchAction", "{"))
        .await
        .expect("action body refusal");
    assert!(action_started.elapsed() >= DELAY);
    assert_eq!(profile_marker(&action), Some("middleware-acceptance"));

    assert!(
        normal_refusal_elapsed < invalid_elapsed,
        "profiled refusal must be slower than its measured normal baseline: \
         normal={normal_refusal_elapsed:?} profiled={invalid_elapsed:?}"
    );
}

/// The executable startup leg proves env provenance/announcement, activation
/// refusal before bind, and process-local runtime selection across restart.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn env_profile_is_announced_refused_over_ceiling_and_restored_after_restart() {
    let temp = tempfile::tempdir().expect("network-profile startup tempdir");
    let database = temp.path().join("app.sqlite3");
    let first_ready = temp.path().join("first-ready.json");
    let mut first = spawn_server(&database, &first_ready, "optimistic").await;
    let first_descriptor = wait_for_ready(&mut first, &first_ready).await;
    let first_url = first_descriptor["serverUrl"].as_str().unwrap().to_owned();
    let first_token = ready_admin_token(&first_descriptor);
    let first_profile = get_profile(&first_url, &first_token).await;
    assert_eq!(first_profile["profile"]["name"], "optimistic");
    assert_eq!(first_profile["provenance"]["source"], "env");

    let runtime_profile = put_profile(&first_url, &first_token, json!("demo-slow")).await;
    assert_eq!(runtime_profile["profile"]["name"], "demo-slow");
    assert_eq!(runtime_profile["provenance"]["source"], "api");
    let first_output = stop_server(first).await;
    assert!(
        first_output.contains("network profile: optimistic (startup env)"),
        "startup output:\n{first_output}"
    );

    let second_ready = temp.path().join("second-ready.json");
    let mut second = spawn_server(&database, &second_ready, "optimistic").await;
    let second_descriptor = wait_for_ready(&mut second, &second_ready).await;
    let second_url = second_descriptor["serverUrl"].as_str().unwrap().to_owned();
    let second_token = ready_admin_token(&second_descriptor);
    let restarted = get_profile(&second_url, &second_token).await;
    assert_eq!(restarted["profile"]["name"], "optimistic");
    assert_eq!(restarted["provenance"]["source"], "env");
    let second_output = stop_server(second).await;
    assert!(second_output.contains("network profile: optimistic (startup env)"));

    let ceiling_db = temp.path().join("ceiling.sqlite3");
    let ceiling_ready = temp.path().join("ceiling-ready.json");
    let output = Command::new(env!("CARGO_BIN_EXE_snapback"))
        .args([
            "start",
            "--port",
            "0",
            "--db",
            ceiling_db.to_str().unwrap(),
            "--ready-file",
            ceiling_ready.to_str().unwrap(),
        ])
        .env(
            "SNAPBACK_NETWORK_PROFILE",
            r#"{"name":"too-slow","mutationAckDelayMs":30001,"liveDeltaDelayMs":0,"queryResponseDelayMs":0,"jitterMs":0}"#,
        )
        .stdin(Stdio::null())
        .output()
        .await
        .expect("spawn ceiling-refusal server");
    assert!(!output.status.success());
    let combined = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        combined.contains("SNAPBACK_NETWORK_PROFILE_DELAY_CEILING"),
        "ceiling refusal output:\n{combined}"
    );
}

async fn run_socket_fixture(delayed: bool) -> FixtureRun {
    let (state, app) = tokio::task::spawn_blocking(|| {
        let _sanction = snapback::exec_guard::BlockingSanction::acquire();
        test_app()
    })
    .await
    .expect("build socket fixture off the async workers");
    if delayed {
        let activated = app
            .clone()
            .oneshot(put_profile_request(json!({
                "name": "equal-lane-acceptance",
                "mutationAckDelayMs": 120,
                "liveDeltaDelayMs": 120,
                "queryResponseDelayMs": 0,
                "jitterMs": 0
            })))
            .await
            .expect("activate equal-lane profile");
        assert_eq!(activated.status(), StatusCode::OK);
    }

    let actor_grant = state
        .connections
        .open(Some("profile-actor".to_owned()), None, true)
        .expect("actor grant");
    let observer_grant = state
        .connections
        .open(Some("profile-observer".to_owned()), None, true)
        .expect("observer grant");
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind socket fixture");
    let address = listener.local_addr().expect("fixture address");
    let server = {
        let served = app.clone();
        tokio::spawn(async move {
            served.bind(listener).unwrap().serve().await.unwrap();
        })
    };
    let mut actor = connect_live(address, "profile-actor", &actor_grant.connection_token).await;
    let mut observer = connect_live(
        address,
        "profile-observer",
        &observer_grant.connection_token,
    )
    .await;
    {
        let shared = state.snapback.clone();
        tokio::task::spawn_blocking(move || {
            let _sanction = snapback::exec_guard::BlockingSanction::acquire();
            let mut snapback = shared.blocking_lock();
            for connection_id in ["profile-actor", "profile-observer"] {
                snapback
                    .subscribe_live(
                        "listTodos",
                        LiveSubscribeInput {
                            connection_id: connection_id.to_owned(),
                            input: handler_input(json!({}), "user_1"),
                            authorization_namespace: None,
                            supersedes: None,
                            resume_from_token: None,
                        },
                    )
                    .expect("live subscription");
            }
        })
        .await
        .expect("subscribe socket fixture off the async workers");
    }

    let started = Instant::now();
    let mutation_app = app.clone();
    let mutation = async move {
        let response = mutation_app
            .oneshot(post_json(
                "/mutation/createTodo",
                json!({
                    "args": { "title": "profile fixture" },
                    "auth": { "user_id": "user_1" },
                    "clientMutationId": "cm_profile_fixture"
                }),
            ))
            .await;
        (response, Instant::now())
    };
    let observed = tokio::time::timeout(Duration::from_secs(3), async {
        tokio::join!(
            mutation,
            next_live_frame(&mut actor),
            next_live_frame(&mut observer)
        )
    })
    .await
    .expect("profile fixture response/frame timeout");
    let (response, ack_at) = (observed.0.0.expect("mutation response"), observed.0.1);
    let (actor_frame, actor_at) = observed.1;
    let (observer_frame, observer_at) = observed.2;
    assert_eq!(response.status(), StatusCode::OK);
    let marker = response
        .headers()
        .get(NETWORK_PROFILE_HEADER)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let body: Value = serde_json::from_slice(
        &to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("mutation response bytes"),
    )
    .expect("mutation response JSON");
    server.abort();
    let _ = server.await;

    let commit_projection = json!({
        "ackVersion": body["version"],
        "changedCount": body["changed_count"],
        "receipt": {
            "outcome": body["receipt"]["outcome"],
            "settlementLane": body["receipt"]["settlementLane"],
            "snapshotVersion": body["receipt"]["snapshotVersion"],
            "transport": body["receipt"]["transport"]
        },
        "actorVersion": actor_frame["version"],
        "observerVersion": observer_frame["version"]
    });
    FixtureRun {
        ack_latency: ack_at.duration_since(started),
        actor_latency: actor_at.duration_since(started),
        observer_latency: observer_at.duration_since(started),
        marker,
        actor_frame_marker: actor_frame["network_profile"].as_str().map(str::to_owned),
        observer_frame_marker: observer_frame["network_profile"]
            .as_str()
            .map(str::to_owned),
        commit_projection,
    }
}

async fn next_live_frame(
    socket: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
) -> (Value, Instant) {
    loop {
        let message = socket
            .next()
            .await
            .expect("live socket remains open")
            .expect("live socket frame");
        if !message.is_text() {
            continue;
        }
        let received_at = Instant::now();
        let value: Value = serde_json::from_str(&message.into_text().unwrap()).unwrap();
        if matches!(value["kind"].as_str(), Some("live_replace" | "live_delta")) {
            return (value, received_at);
        }
    }
}

async fn connect_live(
    address: std::net::SocketAddr,
    connection_id: &str,
    token: &str,
) -> tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>> {
    let mut request = format!("ws://{address}/live/{connection_id}/stream")
        .into_client_request()
        .expect("websocket request");
    request
        .headers_mut()
        .insert("sec-websocket-protocol", "snapback.v1".parse().unwrap());
    request.headers_mut().insert(
        "x-snapback-connection-token",
        token.parse().expect("connection token header"),
    );
    tokio_tungstenite::connect_async(request)
        .await
        .expect("connect live socket")
        .0
}

async fn profiled_app() -> (AppState, SnapbackApp) {
    let (state, app) = test_app();
    let activated = app
        .clone()
        .oneshot(put_profile_request(json!({
            "name": "middleware-acceptance",
            "mutationAckDelayMs": 120,
            "liveDeltaDelayMs": 120,
            "queryResponseDelayMs": 120,
            "jitterMs": 0
        })))
        .await
        .expect("activate middleware profile");
    assert_eq!(activated.status(), StatusCode::OK);
    (state, app)
}

fn test_app() -> (AppState, SnapbackApp) {
    let mut context = ServerContext::detached();
    context.profile = ServerProfile::Test;
    context.admin_token = Some(ADMIN_TOKEN.to_owned());
    let state = test_app_state_from_snapback(configured(), context);
    let app = snapback::server::app(state.clone());
    (state, app)
}

fn configured() -> LocalSnapback {
    let mut snapback = LocalSnapback::memory().expect("profile fixture memory server");
    snapback
        .apply_schema(SchemaManifest {
            schema_hash: Some("network-profile-v1".to_owned()),
            tables: vec![TableManifest {
                name: "todos".to_owned(),
                fields: vec![
                    FieldManifest {
                        name: "title".to_owned(),
                        field_type: FieldType::String,
                        optional: false,
                    },
                    FieldManifest {
                        name: "userId".to_owned(),
                        field_type: FieldType::String,
                        optional: false,
                    },
                ],
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
                visibility: None,
                history: None,
            }],
            ..SchemaManifest::default()
        })
        .expect("profile fixture schema");
    let diagnostics = snapback.load_functions(FunctionManifest {
        bundle_hash: Some("network-profile-functions-v1".to_owned()),
        functions: vec![
            FunctionDefinition::new(
                "listTodos",
                FunctionKind::LiveQuery,
                FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
                    table_visibility: None,
                    table: "todos".to_owned(),
                    filters: Vec::new(),
                    order: vec![OrderExpr {
                        field: "_createdAt".to_owned(),
                        direction: OrderDirection::Asc,
                        max_encoded_bytes: None,
                    }],
                    limit: None,
                    membership_filters: Vec::new(),
                    indexed_by: None,
                })),
            ),
            FunctionDefinition::new(
                "createTodo",
                FunctionKind::Mutation,
                FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
            owner_write_checks: Vec::new(),
                    steps: vec![MutationStep::Insert {
                        table: "todos".to_owned(),
                        values: BTreeMap::from([
                            ("title".to_owned(), ValueExpr::Arg("title".to_owned())),
                            ("userId".to_owned(), ValueExpr::AuthUserId),
                        ]),
                        bind_id_as: None,
                    }],
                    return_value: None,
                })),
            ),
        ],
        ..FunctionManifest::default()
    });
    assert!(
        diagnostics.iter().all(
            |diagnostic| diagnostic.severity != snapback::diagnostic::DiagnosticSeverity::Error
        ),
        "profile fixture functions: {diagnostics:?}"
    );
    snapback
}

fn handler_input(args: Value, user_id: &str) -> HandlerInput {
    HandlerInput {
        args,
        auth: AuthInput {
            user_id: Some(user_id.to_owned()),
            ..AuthInput::default()
        },
        ..HandlerInput::default()
    }
}

fn post_json(uri: &str, body: Value) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(uri)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}

fn raw_json(uri: &str, body: &str) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(uri)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_owned()))
        .unwrap()
}

fn put_profile_request(profile: Value) -> Request<Body> {
    Request::builder()
        .method("PUT")
        .uri("/_snapback/api/debug/network-profile")
        .header(header::CONTENT_TYPE, "application/json")
        .header("x-snapback-admin-token", ADMIN_TOKEN)
        .body(Body::from(profile.to_string()))
        .unwrap()
}

fn profile_marker(response: &axum::response::Response) -> Option<&str> {
    response
        .headers()
        .get(NETWORK_PROFILE_HEADER)
        .and_then(|value| value.to_str().ok())
}

async fn spawn_server(database: &Path, ready_file: &Path, profile: &str) -> Child {
    Command::new(env!("CARGO_BIN_EXE_snapback"))
        .args([
            "start",
            "--port",
            "0",
            "--db",
            database.to_str().unwrap(),
            "--ready-file",
            ready_file.to_str().unwrap(),
        ])
        .env("SNAPBACK_NETWORK_PROFILE", profile)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .expect("spawn snapback profile server")
}

async fn wait_for_ready(child: &mut Child, ready_file: &Path) -> Value {
    tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            if let Ok(bytes) = std::fs::read(ready_file)
                && let Ok(value) = serde_json::from_slice::<Value>(&bytes)
                && value["ready"] == true
            {
                return value;
            }
            if let Some(status) = child.try_wait().expect("poll profile server") {
                let mut stdout = String::new();
                if let Some(pipe) = child.stdout.as_mut() {
                    pipe.read_to_string(&mut stdout)
                        .await
                        .expect("read failed profile server stdout");
                }
                let mut stderr = String::new();
                if let Some(pipe) = child.stderr.as_mut() {
                    pipe.read_to_string(&mut stderr)
                        .await
                        .expect("read failed profile server stderr");
                }
                panic!(
                    "profile server exited before readiness: {status}\nstdout:\n{stdout}\nstderr:\n{stderr}"
                );
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("profile server readiness timeout")
}

fn ready_admin_token(descriptor: &Value) -> String {
    let token_file = descriptor["adminTokenFile"]
        .as_str()
        .expect("ready descriptor adminTokenFile");
    std::fs::read_to_string(token_file)
        .expect("read ready admin token")
        .trim()
        .to_owned()
}

async fn get_profile(server_url: &str, token: &str) -> Value {
    let url = format!(
        "{}/_snapback/api/debug/network-profile",
        server_url.trim_end_matches('/')
    );
    let token = token.to_owned();
    tokio::task::spawn_blocking(move || {
        ureq::get(&url)
            .set("x-snapback-admin-token", &token)
            .call()
            .expect("GET network profile")
            .into_json()
            .expect("GET network profile JSON")
    })
    .await
    .expect("join GET network profile")
}

async fn put_profile(server_url: &str, token: &str, profile: Value) -> Value {
    let url = format!(
        "{}/_snapback/api/debug/network-profile",
        server_url.trim_end_matches('/')
    );
    let token = token.to_owned();
    tokio::task::spawn_blocking(move || {
        ureq::put(&url)
            .set("x-snapback-admin-token", &token)
            .set("content-type", "application/json")
            .send_string(&profile.to_string())
            .expect("PUT network profile")
            .into_json()
            .expect("PUT network profile JSON")
    })
    .await
    .expect("join PUT network profile")
}

async fn stop_server(mut child: Child) -> String {
    child.start_kill().expect("stop profile server");
    let output = child
        .wait_with_output()
        .await
        .expect("join stopped profile server");
    format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    )
}
