//! HTTP-level acceptance for the admin console and headless admin API.
//!
//! @ref LLP 0017#validation-requirements — a fresh local server serves the
//! console and `/_snapback/api/inspect` from the same process without Vite, the
//! data explorer reads through schema-aware storage, the function runner uses
//! the normal invocation path, and non-loopback binds gate admin.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use futures_util::StreamExt;
use serde_json::{Value, json};
use snapback::admin::{AppState, ServerContext};
use snapback::local::{LiveSubscribeInput, LocalSnapback};
use snapback::manifest::{
    AuthInput, FieldManifest, FieldType, FunctionDefinition, FunctionKind, FunctionManifest,
    FunctionRuntime, HandlerInput, HandlerPlan, IndexManifest, MutationPlan, MutationStep,
    OrderDirection, OrderExpr, QueryPlan, SchemaManifest, SeedData, TableManifest, ValueExpr,
};
use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::net::TcpListener;
use tokio::sync::Mutex;
use tokio_tungstenite::connect_async;
use tower::ServiceExt;

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
        body.contains("Snapback admin"),
        "console bundle is embedded"
    );

    let inspect = json(app.oneshot(get("/_snapback/api/inspect")).await.unwrap()).await;
    // The admin inspect extends the existing inspect state in place.
    assert_eq!(inspect["target"], "local-dev-sqlite-ibex");
    assert!(inspect["capability_gaps"].is_array());
    // ...plus the new server and admin blocks.
    assert_eq!(inspect["server"]["loopback"], true);
    assert_eq!(inspect["server"]["storage_mode"], "memory");
    assert_eq!(inspect["admin"]["function_runner"], true);
    assert_eq!(inspect["admin"]["direct_data_edit"], false);
    assert_eq!(inspect["admin"]["raw_sql"], false);
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
    let shared = Arc::new(Mutex::new(seeded_snapback()));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = snapback::server::app(AppState::detached(shared.clone()));
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

/* ---------- harness ---------- */

fn loopback_app(snapback: LocalSnapback) -> axum::Router {
    app_with_context(snapback, ServerContext::detached())
}

fn app_with_context(snapback: LocalSnapback, ctx: ServerContext) -> axum::Router {
    let state = AppState::new(Arc::new(Mutex::new(snapback)), ctx);
    snapback::server::app(state)
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

fn handler_input(args: Value, user_id: &str) -> HandlerInput {
    HandlerInput {
        args,
        auth: AuthInput {
            principal: Some(user_id.to_owned()),
            session_id: None,
            user_id: Some(user_id.to_owned()),
        },
        read_set: Vec::new(),
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
