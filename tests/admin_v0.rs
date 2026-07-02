//! HTTP-level acceptance for the admin console and headless admin API.
//!
//! @ref LLP 0017#validation-requirements — a fresh local server serves the
//! console and `/_snapback/api/inspect` from the same process without Vite, the
//! data explorer reads through schema-aware storage, the function runner uses
//! the normal invocation path, and non-loopback binds gate admin.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use snapback::admin::{AppState, ServerContext};
use snapback::local::{LiveSubscribeInput, LocalSnapback};
use snapback::manifest::{
    AuthInput, FieldManifest, FieldType, FunctionDefinition, FunctionKind, FunctionManifest,
    FunctionRuntime, HandlerInput, HandlerPlan, IndexManifest, MutationPlan, MutationStep,
    OrderDirection, OrderExpr, QueryPlan, SchemaManifest, SeedData, TableManifest, ValueExpr,
};
use std::collections::BTreeMap;
use std::time::{Duration, Instant};
use tokio::net::TcpListener;
use tokio_tungstenite::connect_async;
use tower::ServiceExt;

#[tokio::test]
async fn root_path_serves_yaml_instance_status() {
    let app = loopback_app(seeded_snapback());

    let resp = app.oneshot(get("/")).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let ctype = resp
        .headers()
        .get("content-type")
        .unwrap()
        .to_str()
        .unwrap()
        .to_owned();
    assert!(ctype.starts_with("text/yaml"), "root served as YAML");

    let body = text(resp).await;
    assert!(body.starts_with("schemaVersion: \"snapback.v0\""));
    assert!(body.contains("statusKind: \"snapbackInstanceStatus\""));
    assert!(body.contains("name: \"Snapback local server\""));
    assert!(body.contains("target: \"local-dev-sqlite-ibex\""));
    assert!(body.contains("  mode: \"memory\""));
    assert!(body.contains("  loadedTables: 1"));
    assert!(body.contains("  loadedFunctions: 2"));
    assert!(body.contains("  adminConsole: \"/_snapback/admin\""));
    assert!(body.contains("  healthJson: \"/_snapback/api/health\""));
    assert!(body.contains("  inspectJson: \"/_snapback/api/inspect\""));
    assert!(body.contains("Open on loopback"));
}

#[tokio::test]
async fn p8_both_consoles_consume_the_one_embedded_admin_client() {
    let app = loopback_app(seeded_snapback());

    // The embedded console imports the shared client module…
    let html = text(app.clone().oneshot(get("/_snapback/admin")).await.unwrap()).await;
    assert!(
        html.contains(r#"import { AdminClient } from "/_snapback/admin/client.mjs""#),
        "embedded console imports the shared admin client"
    );

    // …and the server serves that exact module embedded, with no dist and no
    // build step (the LLP 0017 bootstrap property).
    let module = app
        .clone()
        .oneshot(get("/_snapback/admin/client.mjs"))
        .await
        .unwrap();
    assert_eq!(module.status(), StatusCode::OK);
    let ctype = module
        .headers()
        .get("content-type")
        .unwrap()
        .to_str()
        .unwrap()
        .to_owned();
    assert!(ctype.starts_with("text/javascript"), "served as a JS module");
    let source = text(module).await;
    assert!(
        source.contains("export class AdminClient"),
        "the served module is the @snapback/admin-client package file"
    );
    assert_eq!(
        source,
        include_str!("../packages/snapback-admin-client/index.mjs"),
        "byte-identical to the workspace package the Contract admin-ui imports"
    );
}

#[tokio::test]
async fn console_and_inspect_serve_from_one_server_without_vite() {
    let app = loopback_app(seeded_snapback());

    let html = app.clone().oneshot(get("/_snapback/admin")).await.unwrap();
    assert_eq!(html.status(), StatusCode::OK);
    let ctype = html
        .headers()
        .get("content-type")
        .unwrap()
        .to_str()
        .unwrap()
        .to_owned();
    assert!(ctype.starts_with("text/html"), "console served as HTML");
    let body = text(html).await;
    assert!(
        body.contains("Snapback Admin Console"),
        "console bundle is embedded"
    );

    let inspect = json(app.oneshot(get("/_snapback/api/inspect")).await.unwrap()).await;
    // The admin inspect extends the existing inspect state in place.
    assert_eq!(inspect["target"], "local-dev-sqlite-ibex");
    assert!(inspect["capabilityGaps"].is_array());
    // ...plus the new server and admin blocks.
    assert_eq!(inspect["server"]["loopback"], true);
    assert_eq!(inspect["server"]["storageMode"], "memory");
    assert_eq!(inspect["admin"]["functionRunner"], true);
    assert_eq!(inspect["admin"]["cronControls"], true);
    assert_eq!(inspect["admin"]["directDataEdit"], false);
    assert_eq!(inspect["admin"]["rawSql"], false);
    assert_eq!(inspect["cron"]["artifactKind"], "cronRuntimeState");
    assert!(inspect["cron"]["jobs"].is_array());
}

#[tokio::test]
async fn data_explorer_reads_rows_through_schema_aware_storage() {
    let app = loopback_app(seeded_snapback());

    let scan = json(
        app.oneshot(get("/_snapback/api/data/todos?limit=10&offset=0"))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(scan["table"], "todos");
    assert_eq!(scan["total"], 2);
    let columns: Vec<String> = serde_json::from_value(scan["columns"].clone()).unwrap();
    assert_eq!(columns.first().unwrap(), "_id");
    assert!(columns.contains(&"title".to_owned()));
    assert!(columns.contains(&"_createdAt".to_owned()));
    assert_eq!(scan["rows"].as_array().unwrap().len(), 2);
    assert_eq!(scan["rows"][0]["completed"], false);
}

#[tokio::test]
async fn unknown_table_is_a_not_found_diagnostic() {
    let app = loopback_app(seeded_snapback());
    let resp = app.oneshot(get("/_snapback/api/data/nope")).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    let body = json(resp).await;
    assert_eq!(body["diagnostic"]["code"], "SNAPBACK_UNKNOWN_TABLE");
}

#[tokio::test]
async fn function_runner_runs_query_and_mutation_with_read_write_sets() {
    let app = loopback_app(seeded_snapback());

    let query = json(
        app.clone()
            .oneshot(post(
                "/_snapback/api/functions/listTodos/run",
                json!({ "args": {}, "auth": { "user_id": "user_1" } }),
            ))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(query["ok"], true);
    assert_eq!(query["kind"], "LiveQuery");
    assert_eq!(query["reads"], json!(["todos"]));
    assert_eq!(query["writes"], json!([]));
    assert_eq!(query["rows"].as_array().unwrap().len(), 2);

    let mutation = json(
        app.oneshot(post(
            "/_snapback/api/functions/createTodo/run",
            json!({ "args": { "title": "From the runner" }, "auth": { "user_id": "user_1" } }),
        ))
        .await
        .unwrap(),
    )
    .await;
    assert_eq!(mutation["ok"], true);
    assert_eq!(mutation["kind"], "Mutation");
    assert_eq!(mutation["writes"], json!(["todos"]));
    assert_eq!(mutation["changed_count"], 1);
}

#[tokio::test]
async fn websocket_live_stream_pushes_existing_live_updates() {
    let state = AppState::detached(seeded_snapback());
    let shared = state.snapback.clone();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = snapback::server::app(state);
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let (mut stream, _) = connect_async(format!("ws://{addr}/live/client_ws/stream"))
        .await
        .unwrap();

    {
        let mut snapback = shared.lock().await;
        let subscription = snapback
            .subscribe_live(
                "listTodos",
                LiveSubscribeInput {
                    connection_id: "client_ws".to_owned(),
                    input: handler_input(json!({}), "user_1"),
                    supersedes: None,
                },
            )
            .expect("subscribe live query");
        assert_eq!(subscription.snapshot.rows.len(), 2);
        snapback
            .invoke_mutation(
                "createTodo",
                handler_input(json!({ "title": "Pushed over ws" }), "user_1"),
            )
            .expect("create todo");
    }

    let message = tokio::time::timeout(Duration::from_secs(2), stream.next())
        .await
        .expect("websocket update timeout")
        .expect("websocket closed")
        .expect("websocket message");
    let update: Value = serde_json::from_str(&message.into_text().unwrap()).unwrap();
    assert_eq!(update["kind"], "live_replace");
    assert_eq!(update["rows"].as_array().unwrap().len(), 3);
    assert!(
        update["rows"]
            .as_array()
            .unwrap()
            .iter()
            .any(|row| row["title"] == "Pushed over ws")
    );

    server.abort();
}

#[tokio::test]
async fn runner_surfaces_errors_as_inline_diagnostics_not_http_errors() {
    let app = loopback_app(seeded_snapback());
    // createTodo needs an auth user id; running without one fails *inside* the
    // runner so the console can show the diagnostic.
    let resp = app
        .oneshot(post(
            "/_snapback/api/functions/createTodo/run",
            json!({ "args": { "title": "no user" } }),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = json(resp).await;
    assert_eq!(body["ok"], false);
    assert_eq!(body["diagnostic"]["code"], "SNAPBACK_AUTH_USER_MISSING");
}

#[tokio::test]
async fn built_console_dist_is_served_when_configured() {
    // A built Contract bundle (index.html + assets) is served from the dist;
    // the Rust server serves the snapshot — no Vite at runtime.
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("index.html"), b"<!doctype html>DIST-INDEX").unwrap();
    std::fs::create_dir(dir.path().join("assets")).unwrap();
    std::fs::write(
        dir.path().join("assets").join("app.js"),
        b"export const x = 1;",
    )
    .unwrap();

    let app = app_with_context(seeded_snapback(), dist_context(dir.path().to_path_buf()));

    let index = app.clone().oneshot(get("/_snapback/admin")).await.unwrap();
    assert_eq!(index.status(), StatusCode::OK);
    assert!(text(index).await.contains("DIST-INDEX"));

    let asset = app
        .clone()
        .oneshot(get("/_snapback/admin/assets/app.js"))
        .await
        .unwrap();
    assert_eq!(asset.status(), StatusCode::OK);
    assert!(
        asset
            .headers()
            .get("content-type")
            .unwrap()
            .to_str()
            .unwrap()
            .starts_with("text/javascript")
    );

    let missing = app
        .oneshot(get("/_snapback/admin/assets/missing.js"))
        .await
        .unwrap();
    assert_eq!(missing.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn native_exact_request_without_dist_returns_capability_diagnostic() {
    let app = loopback_app(seeded_snapback());
    let resp = app
        .oneshot(get("/_snapback/admin/__exact/platform-manifest.json"))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let content_type = resp
        .headers()
        .get("content-type")
        .unwrap()
        .to_str()
        .unwrap()
        .to_owned();
    assert!(content_type.starts_with("application/json"));

    let body = json(resp).await;
    assert_eq!(
        body["diagnostic"]["code"],
        "SNAPBACK_CAPABILITY_EXACT_NATIVE_ARTIFACTS_UNAVAILABLE"
    );
    assert_eq!(
        body["diagnostic"]["details"]["target_surface"],
        "native Exact"
    );
}

#[tokio::test]
async fn native_exact_request_with_browser_only_dist_returns_capability_diagnostic() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("index.html"), b"<!doctype html>DIST-INDEX").unwrap();
    let app = app_with_context(seeded_snapback(), dist_context(dir.path().to_path_buf()));

    let resp = app
        .oneshot(get(
            "/_snapback/admin/__exact/native/mac-appkit-hermes/exact-native.json",
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body = json(resp).await;
    assert_eq!(
        body["diagnostic"]["code"],
        "SNAPBACK_CAPABILITY_EXACT_NATIVE_ARTIFACT_MISSING"
    );
    assert_eq!(body["diagnostic"]["details"]["admin_dist_configured"], true);
}

#[tokio::test]
async fn embedded_console_is_the_fallback_without_a_dist() {
    // With no dist configured, the embedded single-file console is served.
    let app = loopback_app(seeded_snapback());
    let resp = app.oneshot(get("/_snapback/admin")).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    // "auto-refresh" appears only in the embedded console, not a built bundle.
    assert!(text(resp).await.contains("auto-refresh"));
}

#[tokio::test]
async fn root_path_reports_non_loopback_admin_state() {
    let app = app_with_context(seeded_snapback(), exposed_context(None));

    let resp = app.oneshot(get("/")).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = text(resp).await;
    assert!(body.contains("Admin API disabled on this non-loopback bind"));
}

#[tokio::test]
async fn non_loopback_without_token_disables_admin() {
    let app = app_with_context(seeded_snapback(), exposed_context(None));
    let resp = app.oneshot(get("/_snapback/api/inspect")).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    let body = json(resp).await;
    assert_eq!(body["diagnostic"]["code"], "SNAPBACK_ADMIN_DISABLED");
}

#[tokio::test]
async fn non_loopback_with_token_allows_admin_reads() {
    let app = app_with_context(seeded_snapback(), exposed_context(Some("secret")));

    let denied = app
        .clone()
        .oneshot(get("/_snapback/api/inspect"))
        .await
        .unwrap();
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);

    let allowed = app
        .oneshot(
            Request::builder()
                .uri("/_snapback/api/inspect")
                .header("x-snapback-admin-token", "secret")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(allowed.status(), StatusCode::OK);
}

/// LLP 0032 S1 (LLP 0031 §Enforcement) — the ungated root aliases and the
/// routes that changed class are gone from the root: a request to any of them
/// is a 404, not a silently-served privileged operation.
#[tokio::test]
async fn s1_retired_root_operations_are_absent() {
    let app = app_with_context(seeded_snapback(), loopback_context(None));
    for uri in [
        "/admin/schema",
        "/admin/functions",
        "/admin/reset",
        "/admin/seed",
        "/ephemeral/collections",
        "/ephemeral/cleanup",
        "/connections/some-conn/disconnect",
    ] {
        let resp = app.clone().oneshot(post(uri, json!({}))).await.unwrap();
        assert_eq!(
            resp.status(),
            StatusCode::NOT_FOUND,
            "{uri} must be absent from the root after migration"
        );
    }
}

/// LLP 0032 S1 (was S0) — the migrated gated writes fail closed exactly like
/// their admin peers: token-gated when a token is configured, even on loopback.
#[tokio::test]
async fn s1_gated_writes_require_token_when_configured_even_on_loopback() {
    let app = app_with_context(seeded_snapback(), loopback_context(Some("sekrit")));

    let gated_posts = [
        (
            "/_snapback/api/schema/load",
            serde_json::to_value(todo_schema()).unwrap(),
        ),
        (
            "/_snapback/api/functions/load",
            serde_json::to_value(todo_functions()).unwrap(),
        ),
        ("/_snapback/api/app/reset", json!({})),
        (
            "/_snapback/api/connections/some-conn/disconnect",
            json!({}),
        ),
    ];
    for (uri, body) in gated_posts {
        let resp = app.clone().oneshot(post(uri, body)).await.unwrap();
        assert_eq!(
            resp.status(),
            StatusCode::UNAUTHORIZED,
            "{uri} must fail closed without the configured token"
        );
        let body = json(resp).await;
        assert_eq!(body["diagnostic"]["code"], "SNAPBACK_ADMIN_TOKEN_REQUIRED");
    }

    let allowed = app
        .oneshot(post_with_token("/_snapback/api/app/reset", json!({}), "sekrit"))
        .await
        .unwrap();
    assert_eq!(allowed.status(), StatusCode::OK);
}

/// LLP 0032 S1 (was S0) — on a non-loopback bind the gated writes are disabled
/// without a token and token-gated with one.
#[tokio::test]
async fn s1_gated_writes_fail_closed_on_non_loopback_binds() {
    let no_token = app_with_context(seeded_snapback(), exposed_context(None));
    let resp = no_token
        .oneshot(post("/_snapback/api/app/reset", json!({})))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    let body = json(resp).await;
    assert_eq!(body["diagnostic"]["code"], "SNAPBACK_ADMIN_DISABLED");

    let with_token = app_with_context(seeded_snapback(), exposed_context(Some("sekrit")));
    let denied = with_token
        .clone()
        .oneshot(post("/_snapback/api/app/reset", json!({})))
        .await
        .unwrap();
    assert_eq!(denied.status(), StatusCode::UNAUTHORIZED);

    let allowed = with_token
        .oneshot(post_with_token("/_snapback/api/app/reset", json!({}), "sekrit"))
        .await
        .unwrap();
    assert_eq!(allowed.status(), StatusCode::OK);
}

/// LLP 0032 S1 (was S0) — the open-loopback default is unchanged: no configured
/// token means local demos keep working without headers, now against the gated
/// routes.
#[tokio::test]
async fn s1_gated_writes_stay_open_on_loopback_without_token() {
    let app = app_with_context(seeded_snapback(), loopback_context(None));
    let resp = app
        .oneshot(post("/_snapback/api/app/reset", json!({})))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

/// LLP 0032 S1 (LLP 0031 D5) — `app.reset` folds seed in: an empty body resets,
/// `{ seed }` resets-then-seeds in one gated call.
#[tokio::test]
async fn s1_app_reset_seeds_when_given_a_seed_argument() {
    let app = app_with_context(seeded_snapback(), loopback_context(None));
    let seed = json!({ "seed": { "tables": { "todos": [
        { "_id": "seed_s1", "title": "Reset seeded", "completed": false, "userId": "user_1" }
    ] } } });
    let resp = app
        .clone()
        .oneshot(post("/_snapback/api/app/reset", seed))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let scan = json(
        app.oneshot(get("/_snapback/api/data/todos?limit=10&offset=0"))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(scan["total"], 1);
    assert_eq!(scan["rows"][0]["title"], "Reset seeded");
}

/// LLP 0032 S1 (LLP 0031 D3 §Enforcement) — the field-level trim the route
/// registry cannot see: public `/inspect` keeps the identity/compat facts and
/// drops the two sensitive ones (`subscriptions[].connection_id`,
/// `storage.sqlite_path`), while the gated twin retains them.
#[tokio::test]
async fn s1_public_inspect_is_trimmed_gated_inspect_is_full() {
    let app = app_with_context(seeded_snapback(), loopback_context(None));

    // A live subscription so the public payload has a subscription to trim.
    let sub = json!({
        "connection_id": "conn_secret",
        "input": { "args": {}, "auth": { "user_id": "user_1" } }
    });
    let subbed = app
        .clone()
        .oneshot(post("/live/listTodos/subscribe", sub))
        .await
        .unwrap();
    assert_eq!(subbed.status(), StatusCode::OK);

    // Public /inspect: identity facts present, sensitive facts absent.
    let public = json(app.clone().oneshot(get("/inspect")).await.unwrap()).await;
    assert_eq!(public["schemaVersion"], "snapback.v0");
    assert!(public["targetProfileId"].is_string());
    assert!(public["schema"].is_object());
    assert!(public["functions"].is_object());
    assert!(public["storage"]["version"].is_number());
    assert!(
        public["storage"].get("sqlitePath").is_none() && public["storage"].get("sqlite_path").is_none(),
        "public /inspect must not expose the on-disk DB path"
    );
    let subs = public["subscriptions"].as_array().expect("subscriptions");
    assert!(!subs.is_empty(), "expected the live subscription to appear");
    for entry in subs {
        assert!(entry["id"].is_string());
        assert!(entry["function"].is_string());
        assert!(
            entry.get("connectionId").is_none() && entry.get("connection_id").is_none(),
            "public /inspect must not expose subscription connection ids"
        );
    }

    // Gated /_snapback/api/inspect: the full payload retains the sensitive fact.
    let gated = json(app.oneshot(get("/_snapback/api/inspect")).await.unwrap()).await;
    let gated_subs = gated["subscriptions"].as_array().expect("gated subscriptions");
    assert!(
        gated_subs
            .iter()
            .any(|entry| entry["connectionId"] == "conn_secret"),
        "the gated inspect twin must retain connection ids"
    );
}

/* ---------- harness ---------- */

fn loopback_app(snapback: LocalSnapback) -> axum::Router {
    app_with_context(snapback, ServerContext::detached())
}

fn app_with_context(snapback: LocalSnapback, ctx: ServerContext) -> axum::Router {
    snapback::server::app(AppState::from_snapback(snapback, ctx))
}

fn loopback_context(token: Option<&str>) -> ServerContext {
    ServerContext {
        host: "127.0.0.1".to_owned(),
        port: 4287,
        loopback: true,
        pid: std::process::id(),
        started: Instant::now(),
        started_at_ms: 0,
        admin_token: token.map(ToOwned::to_owned),
        admin_dist: None,
    }
}

fn exposed_context(token: Option<&str>) -> ServerContext {
    ServerContext {
        host: "0.0.0.0".to_owned(),
        port: 4287,
        loopback: false,
        pid: std::process::id(),
        started: Instant::now(),
        started_at_ms: 0,
        admin_token: token.map(ToOwned::to_owned),
        admin_dist: None,
    }
}

fn dist_context(dist: std::path::PathBuf) -> ServerContext {
    ServerContext {
        host: "127.0.0.1".to_owned(),
        port: 4287,
        loopback: true,
        pid: std::process::id(),
        started: Instant::now(),
        started_at_ms: 0,
        admin_token: None,
        admin_dist: Some(dist),
    }
}

fn get(uri: &str) -> Request<Body> {
    Request::builder().uri(uri).body(Body::empty()).unwrap()
}

fn post(uri: &str, body: Value) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(uri)
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}

fn post_with_token(uri: &str, body: Value, token: &str) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(uri)
        .header("content-type", "application/json")
        .header("x-snapback-admin-token", token)
        .body(Body::from(body.to_string()))
        .unwrap()
}

fn handler_input(args: Value, user_id: &str) -> HandlerInput {
    HandlerInput {
        args,
        auth: AuthInput {
            principal: Some(user_id.to_owned()),
            session_id: None,
            user_id: Some(user_id.to_owned()),
        },
        read_set: Vec::new(),
        correlation: None,
    }
}

async fn text(resp: axum::response::Response) -> String {
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    String::from_utf8(bytes.to_vec()).unwrap()
}

async fn json(resp: axum::response::Response) -> Value {
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

fn seeded_snapback() -> LocalSnapback {
    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback.apply_schema(todo_schema()).expect("schema");
    snapback.load_functions(todo_functions());
    let mut a = serde_json::Map::new();
    a.insert("_id".into(), json!("seed_1"));
    a.insert("title".into(), json!("Buy milk"));
    a.insert("completed".into(), json!(false));
    a.insert("userId".into(), json!("user_1"));
    let mut b = serde_json::Map::new();
    b.insert("_id".into(), json!("seed_2"));
    b.insert("title".into(), json!("Walk dog"));
    b.insert("completed".into(), json!(false));
    b.insert("userId".into(), json!("user_1"));
    snapback
        .seed(SeedData {
            tables: BTreeMap::from([("todos".to_owned(), vec![a, b])]),
        })
        .expect("seed");
    snapback
}

fn todo_schema() -> SchemaManifest {
    SchemaManifest {
        schema_hash: Some("todo-v0".to_owned()),
        tables: vec![TableManifest {
            name: "todos".to_owned(),
            fields: vec![
                FieldManifest {
                    name: "title".to_owned(),
                    field_type: FieldType::String,
                    optional: false,
                },
                FieldManifest {
                    name: "completed".to_owned(),
                    field_type: FieldType::Boolean,
                    optional: false,
                },
                FieldManifest {
                    name: "userId".to_owned(),
                    field_type: FieldType::String,
                    optional: false,
                },
            ],
            indexes: vec![IndexManifest {
                name: "by_user".to_owned(),
                fields: vec!["userId".to_owned()],
            }],
            syncable: true,
        }],
        ..SchemaManifest::default()
    }
}

fn todo_functions() -> FunctionManifest {
    FunctionManifest {
        bundle_hash: Some("todo-functions-v0".to_owned()),
        functions: vec![
            FunctionDefinition::new(
                "listTodos",
                FunctionKind::LiveQuery,
                FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
                    table: "todos".to_owned(),
                    filters: vec![],
                    order: vec![OrderExpr {
                        field: "_createdAt".to_owned(),
                        direction: OrderDirection::Asc,
                    }],
                    limit: None,
                    indexed_by: None,
                })),
            ),
            FunctionDefinition::new(
                "createTodo",
                FunctionKind::Mutation,
                FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
                    steps: vec![MutationStep::Insert {
                        table: "todos".to_owned(),
                        values: BTreeMap::from([
                            ("title".to_owned(), ValueExpr::Arg("title".to_owned())),
                            (
                                "completed".to_owned(),
                                ValueExpr::Literal(Value::Bool(false)),
                            ),
                            ("userId".to_owned(), ValueExpr::AuthUserId),
                        ]),
                        bind_id_as: Some("todoId".to_owned()),
                    }],
                    return_value: None,
                })),
            ),
        ],
        ..FunctionManifest::default()
    }
}

/// LLP 0032 S3 — a WebSocket may only speak for its own connection: a frame
/// carrying another connection_id fails closed before reaching the ephemeral
/// store, and a frame matching the socket identity passes the gate.
#[tokio::test]
async fn s3_websocket_frames_bind_to_the_socket_connection() {
    let state = AppState::detached(seeded_snapback());
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = snapback::server::app(state);
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let (mut stream, _) = connect_async(format!("ws://{addr}/live/client_ws_a/stream"))
        .await
        .unwrap();

    let frame = |connection_id: &str| {
        json!({
            "type": "ephemeral_publish",
            "requestId": "req_s3",
            "request": {
                "collection": "cursors",
                "scope": { "roomId": "room_1" },
                "connection_id": connection_id,
                "session_id": null,
                "user_id": null,
                "custom_key": null,
                "value": [123],
                "ttl_ms": null,
                "auth": {
                    "principal": null,
                    "session_id": null,
                    "user_id": null,
                    "permissions": []
                }
            }
        })
        .to_string()
    };

    stream
        .send(tokio_tungstenite::tungstenite::Message::Text(
            frame("client_ws_victim").into(),
        ))
        .await
        .unwrap();
    let reply = tokio::time::timeout(Duration::from_secs(2), stream.next())
        .await
        .expect("spoofed frame reply timeout")
        .expect("websocket closed")
        .expect("websocket message");
    let reply: Value = serde_json::from_str(&reply.into_text().unwrap()).unwrap();
    assert_eq!(reply["kind"], "ephemeral_error");
    assert_eq!(
        reply["diagnostic"]["code"],
        "SNAPBACK_WEBSOCKET_SENDER_MISMATCH"
    );

    stream
        .send(tokio_tungstenite::tungstenite::Message::Text(
            frame("client_ws_a").into(),
        ))
        .await
        .unwrap();
    let reply = tokio::time::timeout(Duration::from_secs(2), stream.next())
        .await
        .expect("matching frame reply timeout")
        .expect("websocket closed")
        .expect("websocket message");
    let reply: Value = serde_json::from_str(&reply.into_text().unwrap()).unwrap();
    assert_ne!(
        reply["diagnostic"]["code"], "SNAPBACK_WEBSOCKET_SENDER_MISMATCH",
        "a frame matching the socket identity must pass the sender gate"
    );

    server.abort();
}
