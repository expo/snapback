//! HTTP-level acceptance for the admin console and headless admin API.
//!
//! @ref LLP 0017#validation-requirements — a fresh local server serves the
//! console and `/_snapback/api/inspect` from the same process without Vite, the
//! data explorer reads through schema-aware storage, the function runner uses
//! the normal invocation path, and non-loopback binds gate admin.

fn test_app_state_from_snapback(
    snapback: snapback::local::LocalSnapback,
    context: snapback::admin::ServerContext,
) -> snapback::admin::AppState {
    snapback::admin::AppState::try_from_snapback(snapback, context).expect("test app state")
}

fn test_detached_app_state(snapback: snapback::local::LocalSnapback) -> snapback::admin::AppState {
    snapback::admin::AppState::try_detached(snapback).expect("detached test app state")
}

use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use snapback::admin::{AppState, ServerContext};
use snapback::auth::keyring::AuthKeyringStore;
use snapback::auth::mode::{
    AUTH_MODE_FORMAT_VERSION, AppDataAvailability, AuthModeStateRecord, AuthModeStatus,
    AuthProgramReadiness, DeploymentIdentity, FUNCTION_V1_PREFIX, INPUTS_V1_PREFIX,
    PasswordProviderReadiness, SCHEMA_V1_PREFIX,
};
use snapback::auth::provider::{AuthProvider, AuthProviderProfile};
use snapback::ephemeral::{AuthContext, EphemeralCollection, KeyMode, Scope};
use snapback::local::{LiveSubscribeInput, LocalSnapback, MAX_LIVE_SUBSCRIPTIONS_PER_CONNECTION};
use snapback::manifest::{
    AppIdentity, AuthInput, AuthMode, FieldManifest, FieldType, FunctionDefinition, FunctionKind,
    FunctionManifest, FunctionRuntime, HandlerInput, HandlerPlan, IbexModule, IndexManifest,
    MutationPlan, MutationStep, OrderDirection, OrderExpr, QueryPlan, SchemaManifest, SeedData,
    TableManifest, TableVisibilityV1, ValueExpr,
};
use snapback::server::{ErrorResponse, MutationResponse, PolicyAuthMode};
use snapback_server::test_support::axum::body::Body;
use snapback_server::test_support::axum::extract::ConnectInfo;
use snapback_server::test_support::axum::http::{Request, StatusCode};
use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;
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
    assert!(body.contains("  guide: \"/_snapback/guide\""));
    assert!(body.contains("  flatGuide: \"/_snapback/guide/flat.md\""));
    assert!(body.contains("  llmsTxt: \"/llms.txt\""));
    assert!(body.contains("  appApiCurrent: \"/app-api/current\""));
    assert!(body.contains("  controlCatalog: \"/_snapback/api/control-catalog\""));
    assert!(body.contains("  healthJson: \"/_snapback/api/health\""));
    assert!(body.contains("  inspectJson: \"/_snapback/api/inspect\""));
    assert!(body.contains("Open on loopback"));
    assert!(body.contains("app:\n  id: \"local-app\""));
    // No identity declared, so no presentation fields are emitted.
    assert!(!body.contains("iconUrl"));
}

/// A browser `Accept` header gets the branded HTML homepage instead of YAML,
/// with the admin-console action below the identity and the key properties in
/// a four-column table (two key/value pairs per row).
#[tokio::test]
async fn root_negotiates_html_for_browsers() {
    let app = loopback_app(seeded_snapback());

    let resp = app
        .oneshot(get_accept(
            "/",
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let ctype = resp
        .headers()
        .get("content-type")
        .unwrap()
        .to_str()
        .unwrap()
        .to_owned();
    assert!(ctype.starts_with("text/html"), "browser gets HTML");

    let body = text(resp).await;
    assert!(body.contains("<svg"), "inline Snapback mark is embedded");
    assert!(body.contains("Snapback"), "wordmark is present");
    assert!(
        !body.contains("class=\"console\""),
        "the header must not carry a second admin-console link"
    );
    assert!(body.contains("Open admin console"));
    assert!(body.contains("href=\"/_snapback/admin\""));
    assert!(body.contains("Building on Snapback?"));
    assert!(body.contains("href=\"/_snapback/guide\""));
    assert!(body.contains("href=\"/_snapback/guide/flat.md\""));
    assert!(
        body.contains("aria-hidden=\"true\""),
        "button icon is embedded"
    );
    assert!(body.contains("/_snapback/api/health"));
    assert!(body.contains("/_snapback/api/inspect"));
    assert!(body.contains("<table>"), "instance facts render as a table");
    assert!(
        body.contains("<th scope=\"row\">Uptime</th><td>"),
        "facts rows carry paired key/value cells"
    );
    assert!(
        body.contains("</td><th scope=\"row\">Bind</th>"),
        "two key/value pairs share one table row"
    );
    assert!(
        body.contains("<td colspan=\"3\">"),
        "the sentence-length admin-access fact spans the full row"
    );
    assert!(body.contains("<details"), "expandable instance details");
    assert!(
        body.contains("<summary>More details</summary>"),
        "the expandable section is titled More details"
    );
    assert!(!body.contains("Instance details"));
    assert!(
        body.contains("schemaVersion: &quot;snapback.v0&quot;"),
        "details carry the full metadata object"
    );
}

#[tokio::test]
async fn root_negotiates_json_and_markdown() {
    let app = loopback_app(seeded_snapback());

    let resp = app
        .clone()
        .oneshot(get_accept("/", "application/json"))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let ctype = resp
        .headers()
        .get("content-type")
        .unwrap()
        .to_str()
        .unwrap()
        .to_owned();
    assert!(ctype.starts_with("application/json"));
    let body = json(resp).await;
    assert_eq!(body["statusKind"], "snapbackInstanceStatus");
    assert_eq!(body["counts"]["loadedTables"], 1);
    assert_eq!(body["links"]["adminConsole"], "/_snapback/admin");
    assert_eq!(body["links"]["guide"], "/_snapback/guide");
    assert_eq!(body["links"]["flatGuide"], "/_snapback/guide/flat.md");
    assert_eq!(body["links"]["llmsTxt"], "/llms.txt");
    assert_eq!(body["links"]["appApiCurrent"], "/app-api/current");
    assert_eq!(
        body["links"]["controlCatalog"],
        "/_snapback/api/control-catalog"
    );
    assert_eq!(body["app"]["id"], "local-app");
    assert!(
        body["app"].get("name").is_none(),
        "undeclared identity fields are omitted from JSON"
    );

    let resp = app.oneshot(get_accept("/", "text/markdown")).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let ctype = resp
        .headers()
        .get("content-type")
        .unwrap()
        .to_str()
        .unwrap()
        .to_owned();
    assert!(ctype.starts_with("text/markdown"));
    let body = text(resp).await;
    assert!(body.starts_with("# Snapback local server"));
    assert!(body.contains("- target: `local-dev-sqlite-ibex`"));
    assert!(body.contains("[Admin console](/_snapback/admin)"));
    assert!(body.contains("[Snapback Guide](/_snapback/guide)"));
    assert!(body.contains("[Flat Snapback Guide](/_snapback/guide/flat.md)"));
}

/// `?format=` beats the `Accept` header so the HTML page can link to the
/// machine renderings from a browser.
#[tokio::test]
async fn root_format_param_overrides_accept() {
    let app = loopback_app(seeded_snapback());

    let resp = app
        .clone()
        .oneshot(get_accept("/?format=json", "text/html"))
        .await
        .unwrap();
    let ctype = resp
        .headers()
        .get("content-type")
        .unwrap()
        .to_str()
        .unwrap()
        .to_owned();
    assert!(ctype.starts_with("application/json"));

    // And an unknown format falls back to header negotiation.
    let resp = app
        .oneshot(get_accept("/?format=xml", "text/html"))
        .await
        .unwrap();
    let ctype = resp
        .headers()
        .get("content-type")
        .unwrap()
        .to_str()
        .unwrap()
        .to_owned();
    assert!(ctype.starts_with("text/html"));
}

/// A declared app identity is rendered on the homepage — HTML-escaped, since
/// the manifest is app-authored input on the open root — and flows into the
/// machine formats.
#[tokio::test]
async fn root_renders_declared_app_identity_escaped() {
    let mut schema = todo_schema();
    schema.app = Some(AppIdentity {
        name: Some("Todo <Deluxe> & Friends".to_owned()),
        description: Some("The \"best\" list app".to_owned()),
        icon_url: Some("/assets/icon.png?v=1&theme=dark".to_owned()),
        wordmark_url: None,
    });
    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback.apply_schema(schema).expect("schema");
    let app = loopback_app(snapback);

    let html = text(
        app.clone()
            .oneshot(get_accept("/", "text/html"))
            .await
            .unwrap(),
    )
    .await;
    assert!(html.contains("Todo &lt;Deluxe&gt; &amp; Friends"));
    assert!(
        !html.contains("<Deluxe>"),
        "app-supplied markup must not reach the page unescaped"
    );
    assert!(html.contains("The &quot;best&quot; list app"));
    assert!(html.contains("src=\"/assets/icon.png?v=1&amp;theme=dark\""));

    let yaml = text(app.clone().oneshot(get("/")).await.unwrap()).await;
    assert!(yaml.contains("  name: \"Todo <Deluxe> & Friends\""));
    assert!(yaml.contains("  iconUrl: \"/assets/icon.png?v=1&theme=dark\""));

    let body = json(
        app.oneshot(get_accept("/", "application/json"))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(body["app"]["name"], "Todo <Deluxe> & Friends");
    assert_eq!(body["app"]["description"], "The \"best\" list app");
}

#[tokio::test]
async fn admin_client_module_is_served_from_the_shared_package() {
    let app = loopback_app(seeded_snapback());

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
    assert!(
        ctype.starts_with("text/javascript"),
        "served as a JS module"
    );
    let source = text(module).await;
    assert!(
        source.contains("export class AdminClient"),
        "the served module is the @expo/snapback-admin-client package file"
    );
    assert_eq!(
        source,
        include_str!("../../../packages/snapback-admin-client/index.mjs"),
        "byte-identical to the workspace package the Contract admin-ui imports"
    );
}

#[tokio::test]
async fn missing_console_dist_is_explicit_and_inspect_still_serves() {
    let app = missing_dist_app(seeded_snapback());

    let html = app.clone().oneshot(get("/_snapback/admin")).await.unwrap();
    assert_eq!(html.status(), StatusCode::SERVICE_UNAVAILABLE);
    let ctype = html
        .headers()
        .get("content-type")
        .unwrap()
        .to_str()
        .unwrap()
        .to_owned();
    assert!(ctype.starts_with("text/html"), "diagnostic served as HTML");
    let body = text(html).await;
    assert!(
        body.contains("SNAPBACK_CAPABILITY_EXACT_ADMIN_DIST_MISSING"),
        "missing dist reports a stable capability diagnostic"
    );
    assert!(
        body.contains("Published <code>@expo/snapback-cli</code> installs include")
            && body.contains("Contributor source-build recovery")
            && body.contains("bun run --cwd admin-ui build"),
        "diagnostic distinguishes packaged consumers from contributor recovery"
    );
    assert!(
        !body.contains("cd admin-ui"),
        "diagnostic must not give a source-checkout cd instruction to package consumers"
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
    assert!(inspect["actionWorkers"]["activeWorkers"].is_number());
    assert!(inspect["actionWorkers"]["admittedWorkers"].is_number());
    assert!(inspect["actionWorkers"]["workerLimit"].is_number());
    assert!(inspect["actionWorkers"]["rejectedAdmissions"].is_number());
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
async fn malformed_app_data_json_uses_snapback_diagnostic_envelope() {
    let app = loopback_app(seeded_snapback());

    let resp = app
        .oneshot(post_raw_json("/query/listTodos", "{not-json"))
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body = json(resp).await;
    assert_eq!(body["diagnostic"]["code"], "SNAPBACK_REQUEST_JSON_INVALID");
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
    let state = test_detached_app_state(seeded_snapback());
    let shared = state.snapback.clone();
    // ENG-23442: the stream upgrade demands the connection grant.
    let grant = state
        .connections
        .open(Some("client_ws".to_owned()), None, true)
        .expect("connection grant");
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = snapback::server::app(state);
    let server = tokio::spawn(async move {
        app.bind(listener).unwrap().serve().await.unwrap();
    });

    use tokio_tungstenite::tungstenite::client::IntoClientRequest as _;
    let mut request = format!("ws://{addr}/live/client_ws/stream")
        .into_client_request()
        .unwrap();
    request
        .headers_mut()
        .insert("sec-websocket-protocol", "snapback.v1".parse().unwrap());
    request.headers_mut().insert(
        "x-snapback-connection-token",
        grant.connection_token.parse().unwrap(),
    );
    let (mut stream, _) = connect_async(request).await.unwrap();

    {
        let mut snapback = shared.lock().await;
        let subscription = snapback
            .subscribe_live(
                "listTodos",
                LiveSubscribeInput {
                    connection_id: "client_ws".to_owned(),
                    input: handler_input(json!({}), "user_1"),
                    authorization_namespace: None,
                    supersedes: None,
                    resume_from_token: None,
                },
            )
            .expect("subscribe live query");
        assert_eq!(subscription.snapshot.as_ref().unwrap().rows.len(), 2);
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
    let app = missing_dist_app(seeded_snapback());
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
async fn root_homepage_is_embedded_html() {
    let app = loopback_app(seeded_snapback());

    let resp = app
        .clone()
        .oneshot(get_accept("/", "text/html"))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert!(text(resp).await.contains("<summary>More details</summary>"));

    let shell = app.clone().oneshot(get("/_snapback/home")).await.unwrap();
    assert_eq!(shell.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn root_path_reports_non_loopback_admin_state() {
    // This test exercises the homepage's admin-access projection, not the
    // production transport fence. Opt in to the explicit development-only
    // plaintext override so a non-loopback harness can reach that projection.
    let app = snapback::server::app(
        test_app_state_from_snapback(seeded_snapback(), exposed_context(None))
            .with_insecure_dev_auth_override(true),
    );

    let resp = app.oneshot(get("/")).await.unwrap();
    let status = resp.status();
    let body = text(resp).await;
    assert_eq!(status, StatusCode::OK, "{body}");
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
    assert_eq!(denied.status(), StatusCode::UNAUTHORIZED);
    let body = json(denied).await;
    assert_eq!(body["diagnostic"]["code"], "SNAPBACK_ADMIN_TOKEN_REQUIRED");
    assert_eq!(body["diagnostic"]["details"]["presented"], false);
    assert_eq!(
        body["diagnostic"]["details"]["header"],
        "x-snapback-admin-token"
    );
    assert_eq!(
        body["diagnostic"]["details"]["envVar"],
        "SNAPBACK_ADMIN_TOKEN"
    );
    assert_eq!(
        body["diagnostic"]["details"]["tokenFileConvention"],
        "<ready-file>.admin-token"
    );

    let wrong = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/_snapback/api/inspect")
                .header("x-snapback-admin-token", "wrong")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(wrong.status(), StatusCode::UNAUTHORIZED);
    let wrong = json(wrong).await;
    assert_eq!(wrong["diagnostic"]["details"]["presented"], true);
    assert!(
        wrong["diagnostic"]["message"]
            .as_str()
            .unwrap()
            .contains("did not match")
    );

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

#[tokio::test]
async fn console_credential_is_derived_sliding_and_no_store() {
    let app = app_with_context(seeded_snapback(), loopback_context(Some("master-secret")));
    let minted = app
        .clone()
        .oneshot(post_with_token(
            "/_snapback/api/console/credential",
            json!({}),
            "master-secret",
        ))
        .await
        .unwrap();
    assert_eq!(minted.status(), StatusCode::OK);
    assert_eq!(
        minted
            .headers()
            .get("cache-control")
            .and_then(|value| value.to_str().ok()),
        Some("no-store, private"),
        "credential responses must never be cacheable"
    );
    let body = json(minted).await;
    let credential = body["credential"].as_str().expect("derived credential");
    assert!(credential.starts_with("sbcc_"), "{body}");
    let expires_at_ms = body["expiresAtMs"].as_u64().expect("expiry");
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;
    assert!(expires_at_ms > now_ms, "{body}");
    assert!(expires_at_ms <= now_ms + 10 * 60 * 1_000, "{body}");

    let ordinary_write = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/_snapback/api/app/reset")
                .header("content-type", "application/json")
                .header("x-snapback-console-credential", credential)
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        ordinary_write.status(),
        StatusCode::OK,
        "derived credential should carry ordinary console authority"
    );

    let renewal = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/_snapback/api/console/credential")
                .header("x-snapback-console-credential", credential)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(renewal.status(), StatusCode::OK);
    assert_eq!(
        renewal
            .headers()
            .get("cache-control")
            .and_then(|value| value.to_str().ok()),
        Some("no-store, private")
    );
    let renewed = json(renewal).await;
    assert_eq!(
        renewed["credential"], credential,
        "renewal extends the active derived credential instead of exposing the master"
    );
    assert!(renewed["expiresAtMs"].as_u64().unwrap() >= expires_at_ms);

    let wrong_carrier = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/_snapback/api/app/reset")
                .header("content-type", "application/json")
                .header("x-snapback-admin-token", credential)
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        wrong_carrier.status(),
        StatusCode::UNAUTHORIZED,
        "derived token must not become interchangeable with the master"
    );

    let tokenless_embedded = app_with_context(seeded_snapback(), loopback_context(None))
        .oneshot(post("/_snapback/api/console/credential", json!({})))
        .await
        .unwrap();
    assert_eq!(
        tokenless_embedded.status(),
        StatusCode::UNAUTHORIZED,
        "a tokenless embedded router has no master capability to derive"
    );

    let non_loopback = app_with_context(seeded_snapback(), exposed_context(Some("master-secret")))
        .oneshot(post_with_token(
            "/_snapback/api/console/credential",
            json!({}),
            "master-secret",
        ))
        .await
        .unwrap();
    assert_eq!(non_loopback.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        json(non_loopback).await["diagnostic"]["code"],
        "SNAPBACK_ADMIN_CONSOLE_MINT_UNAVAILABLE"
    );

    let hosted = app_with_context(
        seeded_snapback(),
        loopback_context(Some("master-secret"))
            .with_auth_deployment(snapback::auth::deployment::AuthDeploymentTarget::Hosted),
    )
    .oneshot(post_with_token(
        "/_snapback/api/console/credential",
        json!({}),
        "master-secret",
    ))
    .await
    .unwrap();
    assert_eq!(hosted.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        json(hosted).await["diagnostic"]["code"],
        "SNAPBACK_ADMIN_CONSOLE_MINT_UNAVAILABLE"
    );
}

#[tokio::test]
async fn master_console_exchange_rate_counts_invalid_master_attempts() {
    let app = app_with_context(seeded_snapback(), loopback_context(Some("master-secret")));
    for attempt in 0..60 {
        let mut request = post_with_token(
            "/_snapback/api/console/credential",
            json!({}),
            "wrong-master",
        );
        if attempt % 2 == 1 {
            request.headers_mut().insert(
                "x-snapback-console-credential",
                "sbcc_bogus".parse().unwrap(),
            );
        }
        let response = app.clone().oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }
    let bounded = app
        .oneshot(post_with_token(
            "/_snapback/api/console/credential",
            json!({}),
            "master-secret",
        ))
        .await
        .unwrap();
    assert_eq!(bounded.status(), StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(
        json(bounded).await["diagnostic"]["code"],
        "SNAPBACK_ADMIN_CONSOLE_CREDENTIAL_RATE_LIMITED"
    );
}

#[tokio::test]
async fn console_credential_cannot_satisfy_sessions_secret_read() {
    let state =
        test_app_state_from_snapback(seeded_snapback(), loopback_context(Some("master-secret")))
            .with_policy_auth_mode(PolicyAuthMode::Sessions);
    let app = snapback::server::app(state);
    let body = json(
        app.clone()
            .oneshot(post_with_token(
                "/_snapback/api/console/credential",
                json!({}),
                "master-secret",
            ))
            .await
            .unwrap(),
    )
    .await;
    let credential = body["credential"].as_str().expect("derived credential");
    let secret_read = app
        .oneshot(
            Request::builder()
                .uri("/_snapback/api/inspect")
                .header("x-snapback-console-credential", credential)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(secret_read.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        json(secret_read).await["diagnostic"]["code"],
        "SNAPBACK_ADMIN_SECRET_READ_REQUIRED",
        "ordinary console capability must not satisfy AdminSecretRead"
    );
}

#[tokio::test]
async fn console_device_approval_is_terminal_authorized_and_single_use() {
    let app = app_with_context(seeded_snapback(), loopback_context(Some("master-secret")));
    let requested = app
        .clone()
        .oneshot(post("/_snapback/api/console/approval/request", json!({})))
        .await
        .unwrap();
    assert_eq!(requested.status(), StatusCode::OK);
    assert_eq!(requested.headers()["cache-control"], "no-store, private");
    let requested = json(requested).await;
    let device_code = requested["deviceCode"].as_str().unwrap();
    let user_code = requested["userCode"].as_str().unwrap();
    assert!(device_code.starts_with("sbcd_"));
    assert_eq!(user_code.len(), 9);

    let approved = app
        .clone()
        .oneshot(post_with_token(
            "/_snapback/api/console/approval/approve",
            json!({ "userCode": user_code }),
            "master-secret",
        ))
        .await
        .unwrap();
    assert_eq!(approved.status(), StatusCode::OK);
    let approved = json(approved).await;
    assert_eq!(approved["approved"], true);
    assert!(
        approved.get("credential").is_none(),
        "terminal approval must not receive the browser credential"
    );

    let replayed_approval = app
        .clone()
        .oneshot(post_with_token(
            "/_snapback/api/console/approval/approve",
            json!({ "userCode": user_code }),
            "master-secret",
        ))
        .await
        .unwrap();
    assert_eq!(replayed_approval.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        json(replayed_approval).await["diagnostic"]["code"],
        "SNAPBACK_ADMIN_APPROVAL_INVALID"
    );

    let polled = app
        .clone()
        .oneshot(post(
            "/_snapback/api/console/approval/poll",
            json!({ "deviceCode": device_code }),
        ))
        .await
        .unwrap();
    assert_eq!(polled.status(), StatusCode::OK);
    let polled = json(polled).await;
    assert_eq!(polled["status"], "approved");
    assert!(polled["credential"].as_str().unwrap().starts_with("sbcc_"));

    let replayed_poll = app
        .oneshot(post(
            "/_snapback/api/console/approval/poll",
            json!({ "deviceCode": device_code }),
        ))
        .await
        .unwrap();
    assert_eq!(replayed_poll.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        json(replayed_poll).await["diagnostic"]["code"],
        "SNAPBACK_ADMIN_APPROVAL_INVALID"
    );
}

#[tokio::test]
async fn console_claim_exchange_is_atomic_uniform_master_observable_and_revocable() {
    let context = loopback_context(Some("master-secret"));
    let shared_credentials = context.console_credentials.clone();
    let app = app_with_context(seeded_snapback(), context);
    let minted = app
        .clone()
        .oneshot(post_with_token(
            "/_snapback/api/console/claim",
            json!({}),
            "master-secret",
        ))
        .await
        .unwrap();
    assert_eq!(minted.status(), StatusCode::OK);
    assert_eq!(minted.headers()["cache-control"], "no-store, private");
    let minted = json(minted).await;
    let claim_code = minted["claimCode"].as_str().unwrap().to_owned();
    assert!(claim_code.starts_with("sbcl_"));
    assert_eq!(minted["expiresIn"], 30 * 60);

    let missing_peer = app
        .clone()
        .oneshot(post(
            "/_snapback/api/console/claim/exchange",
            json!({ "claimCode": &claim_code }),
        ))
        .await
        .unwrap();
    assert_eq!(missing_peer.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        json(missing_peer).await["diagnostic"]["code"],
        "SNAPBACK_ADMIN_CLAIM_UNAVAILABLE",
        "an exchange cannot publish a falsely labeled direct-peer record"
    );

    let (first, second) = tokio::join!(
        app.clone()
            .oneshot(claim_exchange_request(&claim_code, "127.0.0.1:5001")),
        app.clone()
            .oneshot(claim_exchange_request(&claim_code, "127.0.0.1:5002")),
    );
    let first = first.unwrap();
    let second = second.unwrap();
    let (winner, loser) = if first.status() == StatusCode::OK {
        (first, second)
    } else {
        (second, first)
    };
    assert_eq!(winner.status(), StatusCode::OK);
    assert_eq!(winner.headers()["cache-control"], "no-store, private");
    assert_eq!(loser.status(), StatusCode::UNAUTHORIZED);
    let loser_body = text(loser).await;
    let consumed = app
        .clone()
        .oneshot(claim_exchange_request(&claim_code, "127.0.0.1:5003"))
        .await
        .unwrap();
    assert_eq!(consumed.status(), StatusCode::UNAUTHORIZED);
    let consumed_body = text(consumed).await;
    let invalid = app
        .clone()
        .oneshot(claim_exchange_request(
            "sbcl_00000000000000000000000000000000",
            "127.0.0.1:5004",
        ))
        .await
        .unwrap();
    assert_eq!(invalid.status(), StatusCode::UNAUTHORIZED);
    let invalid_body = text(invalid).await;
    assert_eq!(loser_body, consumed_body);
    assert_eq!(consumed_body, invalid_body);
    assert_eq!(
        serde_json::from_str::<Value>(&invalid_body).unwrap()["diagnostic"]["code"],
        "SNAPBACK_ADMIN_CLAIM_INVALID"
    );

    let winner = json(winner).await;
    let credential = winner["credential"].as_str().unwrap();
    assert!(credential.starts_with("sbcc_"));
    assert_eq!(winner["provenance"], "operatorClaim");

    let ordinary_write = app
        .clone()
        .oneshot(post_with_console_credential(
            "/_snapback/api/app/reset",
            json!({}),
            credential,
        ))
        .await
        .unwrap();
    assert_eq!(ordinary_write.status(), StatusCode::OK);

    let mut sessions_context = loopback_context(Some("master-secret"));
    sessions_context.console_credentials = shared_credentials;
    let sessions_app = snapback::server::app(
        test_app_state_from_snapback(seeded_snapback(), sessions_context)
            .with_policy_auth_mode(PolicyAuthMode::Sessions),
    );
    let secret_read = sessions_app
        .oneshot(
            Request::builder()
                .uri("/_snapback/api/inspect")
                .header("x-snapback-console-credential", credential)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(secret_read.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        json(secret_read).await["diagnostic"]["code"],
        "SNAPBACK_ADMIN_SECRET_READ_REQUIRED"
    );

    let impersonation = app
        .clone()
        .oneshot(post_with_console_credential(
            "/_snapback/api/host-ops",
            json!({
                "operation": "function.run",
                "function": "listTodos",
                "userId": "chosen-user"
            }),
            credential,
        ))
        .await
        .unwrap();
    assert_ne!(
        impersonation.status(),
        StatusCode::OK,
        "ordinary claim authority cannot manufacture impersonation authority"
    );

    let browser_status = app
        .clone()
        .oneshot(post_with_console_credential(
            "/_snapback/api/console/claim/status",
            json!({ "claimCode": claim_code }),
            credential,
        ))
        .await
        .unwrap();
    assert_eq!(browser_status.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        json(browser_status).await["diagnostic"]["code"],
        "SNAPBACK_ADMIN_TOKEN_REQUIRED"
    );

    let status = app
        .clone()
        .oneshot(post_with_token(
            "/_snapback/api/console/claim/status",
            json!({ "claimCode": claim_code }),
            "master-secret",
        ))
        .await
        .unwrap();
    assert_eq!(status.status(), StatusCode::OK);
    let status = json(status).await;
    assert_eq!(status["status"], "redeemed");
    assert_eq!(status["transportPeerSource"], "directTransport");
    assert!(
        status["transportPeer"]
            .as_str()
            .unwrap()
            .starts_with("127.0.0.1:500")
    );
    assert_ne!(status["credentialDigestSha256"], credential);
    assert_eq!(status["credentialDigestSha256"].as_str().unwrap().len(), 64);

    let renewal = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/_snapback/api/console/credential")
                .header("x-snapback-console-credential", credential)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(renewal.status(), StatusCode::OK);
    let renewal = json(renewal).await;
    assert_eq!(renewal["credential"], credential);
    assert_eq!(renewal["provenance"], "operatorClaim");

    let revoked = app
        .clone()
        .oneshot(post_with_token(
            "/_snapback/api/console/claim/revoke",
            json!({ "claimCode": claim_code }),
            "master-secret",
        ))
        .await
        .unwrap();
    assert_eq!(revoked.status(), StatusCode::OK);
    assert_eq!(json(revoked).await["status"], "revoked");

    let after_revoke = app
        .oneshot(post_with_console_credential(
            "/_snapback/api/app/reset",
            json!({}),
            credential,
        ))
        .await
        .unwrap();
    assert_eq!(after_revoke.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn console_claim_mint_and_exchange_refuse_non_loopback_and_hosted_targets() {
    let contexts = [
        (
            exposed_context(Some("master-secret")),
            "SNAPBACK_ADMIN_DISABLED",
        ),
        (
            loopback_context(Some("master-secret"))
                .with_auth_deployment(snapback::auth::deployment::AuthDeploymentTarget::Hosted),
            "SNAPBACK_ADMIN_CLAIM_UNAVAILABLE",
        ),
    ];
    for (context, anonymous_exchange_code) in contexts {
        let app = app_with_context(seeded_snapback(), context);
        let mint = app
            .clone()
            .oneshot(post_with_token(
                "/_snapback/api/console/claim",
                json!({}),
                "master-secret",
            ))
            .await
            .unwrap();
        assert_eq!(mint.status(), StatusCode::FORBIDDEN);
        assert_eq!(
            json(mint).await["diagnostic"]["code"],
            "SNAPBACK_ADMIN_CLAIM_UNAVAILABLE"
        );
        let exchange = app
            .oneshot(claim_exchange_request(
                "sbcl_00000000000000000000000000000000",
                "127.0.0.1:5005",
            ))
            .await
            .unwrap();
        assert_eq!(exchange.status(), StatusCode::FORBIDDEN);
        assert_eq!(
            json(exchange).await["diagnostic"]["code"],
            anonymous_exchange_code
        );
    }
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

/// @ref LLP 0184#p2-controlled-mutations — named maintenance binds to one
/// startup and returns a structured preview instead of the legacy bare 204.
#[tokio::test]
async fn ephemeral_cleanup_requires_current_startup_and_returns_receipt() {
    let route = snapback::server::route_registry()
        .into_iter()
        .find(|route| route.path == "/_snapback/api/ephemeral/cleanup")
        .expect("ephemeral cleanup route is registered");
    assert_eq!(route.path_policy, snapback::server::RoutePolicy::AdminWrite);

    let state = test_app_state_from_snapback(seeded_snapback(), loopback_context(None))
        .with_server_startup_nonce("startup-cleanup-test")
        .unwrap();
    let app = snapback::server::app(state);

    let mismatch = app
        .clone()
        .oneshot(post(
            "/_snapback/api/ephemeral/cleanup",
            json!({
                "olderThanMs": 0,
                "dryRun": true,
                "maxEntries": 10,
                "startupNonce": "stale-startup",
            }),
        ))
        .await
        .unwrap();
    assert_eq!(mismatch.status(), StatusCode::CONFLICT);
    assert_eq!(
        json(mismatch).await["diagnostic"]["code"],
        "SNAPBACK_EPHEMERAL_CLEANUP_STARTUP_MISMATCH"
    );

    let preview = app
        .oneshot(post(
            "/_snapback/api/ephemeral/cleanup",
            json!({
                "cutoffTimestampMs": 0,
                "dryRun": true,
                "maxEntries": 10,
                "startupNonce": "startup-cleanup-test",
            }),
        ))
        .await
        .unwrap();
    assert_eq!(preview.status(), StatusCode::OK);
    let receipt = json(preview).await;
    assert_eq!(
        receipt["artifactKind"],
        "snapback.ephemeral-cleanup-receipt/v1"
    );
    assert_eq!(receipt["operation"], "ephemeral.cleanup");
    assert_eq!(receipt["dryRun"], true);
    assert_eq!(receipt["startupNonce"], "startup-cleanup-test");
    assert_eq!(receipt["bounds"]["maxEntries"], 10);
    assert_eq!(receipt["counts"]["deleted"], 0);
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
        ("/_snapback/api/connections/some-conn/disconnect", json!({})),
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
        .oneshot(post_with_token(
            "/_snapback/api/app/reset",
            json!({}),
            "sekrit",
        ))
        .await
        .unwrap();
    assert_eq!(allowed.status(), StatusCode::OK);
}

/// ENG-23443 — the serve path always resolves an admin token on loopback, so
/// the reflected localhost CORS can no longer be combined with a tokenless
/// instance: a write from an arbitrary localhost origin without the minted
/// token fails closed (even though the origin itself is reflected), and goes
/// through only with the minted token in hand. Full inspect is sensitive too:
/// it names the token file and carries raw operational facts, so a browser
/// page cannot read it merely because it runs on another loopback origin.
#[tokio::test]
async fn minted_token_blocks_writes_from_arbitrary_localhost_origins() {
    let dir = tempfile::tempdir().unwrap();
    let token_file = snapback::admin::admin_token_sibling(&dir.path().join("app.sqlite3"));
    let resolved =
        snapback::admin::resolve_serve_admin_token(None, Some(token_file.clone())).unwrap();
    let mut ctx = loopback_context(None);
    ctx.install_minted_token(&resolved);
    let app = app_with_context(seeded_snapback(), ctx);

    let evil_origin_write = Request::builder()
        .method("POST")
        .uri("/_snapback/api/app/reset")
        .header("content-type", "application/json")
        .header("origin", "http://localhost:5173")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let denied = app.clone().oneshot(evil_origin_write).await.unwrap();
    // The origin is reflected (local dev CORS)…
    assert_eq!(
        denied
            .headers()
            .get("access-control-allow-origin")
            .and_then(|value| value.to_str().ok()),
        Some("http://localhost:5173")
    );
    // …but the write fails closed without the minted token.
    assert_eq!(denied.status(), StatusCode::UNAUTHORIZED);
    let body = json(denied).await;
    assert_eq!(body["diagnostic"]["code"], "SNAPBACK_ADMIN_TOKEN_REQUIRED");

    let inspect_denied = app
        .clone()
        .oneshot(get("/_snapback/api/inspect"))
        .await
        .unwrap();
    assert_eq!(inspect_denied.status(), StatusCode::UNAUTHORIZED);

    let inspect = json(
        app.clone()
            .oneshot(
                Request::builder()
                    .uri("/_snapback/api/inspect")
                    .header("x-snapback-admin-token", &resolved.token)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(
        inspect["admin"]["tokenConfigured"], true,
        "a minted token must report as configured"
    );
    assert_eq!(
        inspect["admin"]["tokenFile"],
        json!(token_file.display().to_string()),
        "inspect must name the minted token file for same-user tooling"
    );

    let public_home = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/")
                .header("accept", "application/json")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let public_home = serde_json::to_string(&json(public_home).await).unwrap();
    assert!(
        !public_home.contains(&token_file.display().to_string()),
        "the public homepage must not expose an absolute capability path: {public_home}"
    );

    let allowed = app
        .oneshot(post_with_token(
            "/_snapback/api/app/reset",
            json!({}),
            &resolved.token,
        ))
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
        .oneshot(post_with_token(
            "/_snapback/api/app/reset",
            json!({}),
            "sekrit",
        ))
        .await
        .unwrap();
    assert_eq!(allowed.status(), StatusCode::OK);
}

/// ENG-22527 FIX 3 e2e — under the `prod` profile the provisioning writes are
/// refused by the centralized operation-profile policy even where the admin-token layer
/// would allow them (open loopback, no token configured): the profile gate is
/// its own layer, and it answers with SNAPBACK_PROFILE_FORBIDS, not an auth
/// diagnostic.
#[tokio::test]
async fn provisioning_writes_are_profile_forbidden_under_prod() {
    let mut ctx = loopback_context(None);
    ctx.profile = snapback::admin::ServerProfile::Prod;
    let app = app_with_context(seeded_snapback(), ctx);

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
    ];
    for (uri, body) in gated_posts {
        let resp = app.clone().oneshot(post(uri, body)).await.unwrap();
        assert_eq!(
            resp.status(),
            StatusCode::FORBIDDEN,
            "{uri} must be profile-forbidden under prod"
        );
        let body = json(resp).await;
        assert_eq!(body["diagnostic"]["code"], "SNAPBACK_PROFILE_FORBIDS");
    }

    for request in [
        json!({ "operation": "schema.load", "schema": todo_schema() }),
        json!({ "operation": "functions.load", "functions": todo_functions() }),
        json!({ "operation": "app.reset" }),
        json!({ "operation": "function.explain", "function": "createTodo", "kind": "mutationDryRun", "userId": "chosen-user" }),
    ] {
        let response = app
            .clone()
            .oneshot(post("/_snapback/api/host-ops", request.clone()))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = json(response).await;
        assert_eq!(body["ok"], false, "host-op bypassed prod: {request}");
        assert_eq!(body["diagnostics"][0]["code"], "SNAPBACK_PROFILE_FORBIDS");
        assert_eq!(body["target"]["targetProfile"], "local-prod-sqlite-ibex");
    }

    // ENG-24595 moved impersonated function.run into the selected-operation
    // gate. Prod now refuses its independent impersonation effect before the
    // host-op handler can build the legacy 200 result envelope.
    let impersonated_run = app
        .clone()
        .oneshot(post(
            "/_snapback/api/host-ops",
            json!({
                "operation": "function.run",
                "function": "listTodos",
                "userId": "chosen-user"
            }),
        ))
        .await
        .unwrap();
    assert_eq!(impersonated_run.status(), StatusCode::FORBIDDEN);
    let body = json(impersonated_run).await;
    assert_eq!(body["diagnostic"]["code"], "SNAPBACK_PROFILE_FORBIDS");

    let dedicated_dev_user = app
        .oneshot(post(
            "/_snapback/api/functions/listTodos/run",
            json!({ "auth": { "user_id": "chosen-user" } }),
        ))
        .await
        .unwrap();
    assert_eq!(dedicated_dev_user.status(), StatusCode::FORBIDDEN);
    let body = json(dedicated_dev_user).await;
    assert_eq!(body["diagnostic"]["code"], "SNAPBACK_PROFILE_FORBIDS");
}

/// ENG-24561 / ENG-24594 — the multiplexed host-ops transport and its
/// dedicated aliases resolve the same per-operation AdminRead/AdminWrite
/// requirement. Query/explain reads remain open on loopback; selecting a dev
/// identity for `function.run` is the impersonation effect that takes the
/// stronger gate (the legacy explain selector remains dev-only metadata).
#[tokio::test]
async fn host_ops_and_dedicated_aliases_have_authority_parity() {
    let app = app_with_context(seeded_snapback(), loopback_context(Some("sekrit")));

    for request in [
        json!({ "operation": "function.run", "function": "listTodos" }),
        json!({ "operation": "function.explain", "function": "createTodo", "kind": "mutationDryRun", "userId": "user_1" }),
    ] {
        let response = app
            .clone()
            .oneshot(post("/_snapback/api/host-ops", request.clone()))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK, "read denied: {request}");
        assert_eq!(json(response).await["ok"], true, "read failed: {request}");
    }
    let dedicated_query = app
        .clone()
        .oneshot(post(
            "/_snapback/api/functions/listTodos/run",
            json!({ "args": {}, "auth": { "user_id": "user_1" } }),
        ))
        .await
        .unwrap();
    assert_eq!(dedicated_query.status(), StatusCode::OK);

    for request in [
        json!({ "operation": "app.inspect" }),
        json!({ "operation": "app.reset" }),
        json!({ "operation": "schema.load", "schema": todo_schema() }),
        json!({ "operation": "functions.load", "functions": todo_functions() }),
        json!({ "operation": "function.run", "function": "listTodos", "userId": "user_1" }),
        json!({ "operation": "function.run", "function": "createTodo", "args": { "title": "blocked" }, "userId": "user_1" }),
    ] {
        let response = app
            .clone()
            .oneshot(post("/_snapback/api/host-ops", request.clone()))
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            StatusCode::UNAUTHORIZED,
            "write bypassed token gate: {request}"
        );
    }
    let dedicated_mutation = app
        .oneshot(post(
            "/_snapback/api/functions/createTodo/run",
            json!({ "args": { "title": "blocked" }, "auth": { "user_id": "user_1" } }),
        ))
        .await
        .unwrap();
    assert_eq!(dedicated_mutation.status(), StatusCode::UNAUTHORIZED);
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

#[tokio::test]
async fn app_reset_rejects_a_late_bad_seed_without_clearing_existing_data() {
    let app = app_with_context(seeded_snapback(), loopback_context(None));
    let seed = json!({ "seed": { "tables": { "todos": [
        { "_id": "would_have_landed", "title": "valid first row", "completed": false, "userId": "user_1" },
        { "_id": "invalid_second", "title": null, "completed": false, "userId": "user_1" }
    ] } } });
    let rejected = app
        .clone()
        .oneshot(post("/_snapback/api/app/reset", seed))
        .await
        .unwrap();
    assert_eq!(rejected.status(), StatusCode::BAD_REQUEST);

    let scan = json(
        app.oneshot(get("/_snapback/api/data/todos?limit=10&offset=0"))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(scan["total"], 2, "the pre-reset rows survive rollback");
    assert!(
        scan["rows"]
            .as_array()
            .unwrap()
            .iter()
            .all(|row| row["_id"] != "would_have_landed"),
        "no prefix of the seed may commit"
    );
}

#[tokio::test]
async fn optional_json_routes_reject_nonempty_untyped_or_invalid_bodies_without_side_effects() {
    let app = app_with_context(seeded_snapback(), loopback_context(None));
    let seed = json!({ "seed": { "tables": { "todos": [
        { "_id": "must_not_land", "title": "ignored", "completed": false, "userId": "user_1" }
    ] } } });
    let misspelled_seed = json!({ "sead": seed["seed"].clone() }).to_string();

    for (content_type, body) in [
        (None, seed.to_string()),
        (Some("text/plain"), seed.to_string()),
        (Some("application/json"), "{not-json".to_owned()),
        (Some("application/json"), "[]".to_owned()),
        (
            Some("application/json"),
            r#"{"seed":null,"seed":null}"#.to_owned(),
        ),
        (Some("application/json"), misspelled_seed),
    ] {
        let mut builder = Request::builder()
            .method("POST")
            .uri("/_snapback/api/app/reset");
        if let Some(content_type) = content_type {
            builder = builder.header("content-type", content_type);
        }
        let response = app
            .clone()
            .oneshot(builder.body(Body::from(body)).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert_eq!(
            json(response).await["diagnostic"]["code"],
            "SNAPBACK_REQUEST_JSON_INVALID"
        );

        let scan = json(
            app.clone()
                .oneshot(get("/_snapback/api/data/todos?limit=10&offset=0"))
                .await
                .unwrap(),
        )
        .await;
        assert_eq!(scan["total"], 2, "rejected reset must not clear data");
    }

    let oversized = Request::builder()
        .method("POST")
        .uri("/_snapback/api/app/reset")
        .header("content-type", "application/json")
        .body(Body::from(format!(
            r#"{{"padding":"{}"}}"#,
            "x".repeat(3_000_000)
        )))
        .unwrap();
    let response = app.clone().oneshot(oversized).await.unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        json(response).await["diagnostic"]["code"],
        "SNAPBACK_REQUEST_JSON_INVALID"
    );

    let empty_reset = Request::builder()
        .method("POST")
        .uri("/_snapback/api/app/reset")
        .body(Body::empty())
        .unwrap();
    assert_eq!(
        app.clone().oneshot(empty_reset).await.unwrap().status(),
        StatusCode::OK
    );

    let open_request = |body: Body, content_type: Option<&str>| {
        let mut request = Request::builder().method("POST").uri("/connection/open");
        if let Some(content_type) = content_type {
            request = request.header("content-type", content_type);
        }
        request.body(body).unwrap()
    };
    let mut invalid_utf8 = br#"{"connectionId":"open-invalid-utf8","padding":""#.to_vec();
    invalid_utf8.extend_from_slice(&[0xc3, 0x28, b'"', b'}']);
    let rejected_opens = vec![
        (
            "open-missing-content-type",
            open_request(
                Body::from(r#"{"connectionId":"open-missing-content-type"}"#),
                None,
            ),
        ),
        (
            "open-wrong-content-type",
            open_request(
                Body::from(r#"{"connectionId":"open-wrong-content-type"}"#),
                Some("text/plain"),
            ),
        ),
        (
            "open-malformed",
            open_request(
                Body::from(r#"{"connectionId":"open-malformed","extra":nope}"#),
                Some("application/json"),
            ),
        ),
        (
            "open-truncated",
            open_request(
                Body::from(r#"{"connectionId":"open-truncated""#),
                Some("application/json"),
            ),
        ),
        (
            "open-wrong-shape",
            open_request(
                Body::from(r#"["open-wrong-shape"]"#),
                Some("application/json"),
            ),
        ),
        (
            "open-duplicate-field",
            open_request(
                Body::from(
                    r#"{"connectionId":"open-duplicate-first","connectionId":"open-duplicate-field"}"#,
                ),
                Some("application/json"),
            ),
        ),
        (
            "open-invalid-utf8",
            open_request(Body::from(invalid_utf8), Some("application/json")),
        ),
        (
            "open-oversized",
            open_request(
                Body::from(format!(
                    r#"{{"connectionId":"open-oversized","padding":"{}"}}"#,
                    "x".repeat(3_000_000)
                )),
                Some("application/json"),
            ),
        ),
        (
            "open-unknown-field",
            open_request(
                Body::from(r#"{"connectionId":"open-unknown-field","logPreviousToken":true}"#),
                Some("application/json"),
            ),
        ),
    ];
    for (connection_id, request) in rejected_opens {
        let response = app.clone().oneshot(request).await.unwrap();
        let bounded_by_policy_gate = connection_id == "open-oversized";
        assert_eq!(
            response.status(),
            if bounded_by_policy_gate {
                StatusCode::PAYLOAD_TOO_LARGE
            } else {
                StatusCode::BAD_REQUEST
            },
            "{connection_id} body must be rejected"
        );
        assert_eq!(
            json(response).await["diagnostic"]["code"],
            if bounded_by_policy_gate {
                "SNAPBACK_VALUE_TOO_LARGE"
            } else {
                "SNAPBACK_REQUEST_JSON_INVALID"
            },
            "{connection_id} must use the stable bounded-body diagnostic"
        );

        // Rejection must happen before the grant operation. The intended id
        // remains unclaimed and is therefore adopted by the next valid open.
        let valid = json(
            app.clone()
                .oneshot(post(
                    "/connection/open",
                    json!({ "connectionId": connection_id }),
                ))
                .await
                .unwrap(),
        )
        .await;
        assert_eq!(
            valid["connectionId"], connection_id,
            "rejected {connection_id} request must not reserve its grant id"
        );
    }

    let empty_open = Request::builder()
        .method("POST")
        .uri("/connection/open")
        .body(Body::empty())
        .unwrap();
    assert_eq!(
        app.clone().oneshot(empty_open).await.unwrap().status(),
        StatusCode::OK
    );

    let typed_open = json(
        app.oneshot(post(
            "/connection/open",
            json!({ "connectionId": "open-valid-json" }),
        ))
        .await
        .unwrap(),
    )
    .await;
    assert_eq!(typed_open["connectionId"], "open-valid-json");
}

/// LLP 0032 S1 (LLP 0031 D3 §Enforcement) — the field-level trim the route
/// registry cannot see: public `/inspect` keeps the identity/compat facts and
/// drops the two sensitive ones (`subscriptions[].connection_id`,
/// `storage.sqlite_path`), while the gated twin retains them.
#[tokio::test]
async fn s1_public_inspect_is_trimmed_gated_inspect_is_full() {
    let app = app_with_context(seeded_snapback(), loopback_context(None));

    // A live subscription so the public payload has a subscription to trim.
    let token = open_connection(app.clone(), "conn_secret").await;
    let sub = json!({
        "connection_id": "conn_secret",
        "input": { "args": {}, "auth": { "user_id": "user_1" } }
    });
    let subbed = app
        .clone()
        .oneshot(post_with_connection_token(
            "/live/listTodos/subscribe",
            sub,
            &token,
        ))
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
    assert!(public["cron"]["jobCount"].is_number());
    assert!(
        public["cron"].get("jobs").is_none()
            && public["cron"].get("recentRuns").is_none()
            && public["cron"].get("diagnostics").is_none(),
        "anonymous cron state must contain aggregate posture only"
    );
    for diagnostic in public["recentDiagnostics"]
        .as_array()
        .expect("public diagnostics")
    {
        assert!(diagnostic.get("code").is_some());
        assert!(diagnostic.get("message").is_none());
        assert!(diagnostic.get("details").is_none());
    }
    assert!(
        public["storage"].get("sqlitePath").is_none()
            && public["storage"].get("sqlite_path").is_none(),
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
    let gated_subs = gated["subscriptions"]
        .as_array()
        .expect("gated subscriptions");
    assert!(
        gated_subs
            .iter()
            .any(|entry| entry["connectionId"] == "conn_secret"),
        "the gated inspect twin must retain connection ids"
    );
    assert!(gated["cron"]["jobs"].is_array());
}

/// ENG-23441 (LLP 0031 D3) — the public `/inspect` functions manifest is a
/// redacted projection: executable handler bodies (`IbexModule.source`,
/// `HandlerPlan` step bodies) never appear anywhere in the public payload,
/// while the gated twin keeps the full manifest. Sentinel strings planted in
/// both runtime shapes prove the redaction at the whole-payload level, which
/// the field assertions above cannot.
#[tokio::test]
async fn s1_public_inspect_redacts_handler_source() {
    const SOURCE_SENTINEL: &str = "SNAPBACK_ENG_23441_SOURCE_SENTINEL";
    const PLAN_SENTINEL: &str = "SNAPBACK_ENG_23441_PLAN_LITERAL";

    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback.apply_schema(todo_schema()).expect("schema");
    let mut manifest = todo_functions();
    manifest.functions.push(FunctionDefinition::new(
        "sentinelQuery",
        FunctionKind::Query,
        FunctionRuntime::IbexModule(IbexModule {
            source: format!(
                "export const sentinelQuery = async () => {{ /* {SOURCE_SENTINEL} */ return []; }};"
            ),
            export: "sentinelQuery".to_owned(),
        }),
    ));
    manifest.functions.push(FunctionDefinition::new(
        "sentinelMutation",
        FunctionKind::Mutation,
        FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
            owner_write_checks: Vec::new(),
            steps: vec![MutationStep::Insert {
                table: "todos".to_owned(),
                values: BTreeMap::from([(
                    "title".to_owned(),
                    ValueExpr::Literal(Value::String(PLAN_SENTINEL.to_owned())),
                )]),
                bind_id_as: None,
            }],
            return_value: None,
        })),
    ));
    snapback.load_functions(manifest);
    let app = app_with_context(snapback, loopback_context(None));

    // Public /inspect: no executable body anywhere in the payload…
    let public = json(app.clone().oneshot(get("/inspect")).await.unwrap()).await;
    let public_text = public.to_string();
    assert!(
        !public_text.contains(SOURCE_SENTINEL),
        "public /inspect must not expose Ibex handler source"
    );
    assert!(
        !public_text.contains(PLAN_SENTINEL),
        "public /inspect must not expose host-plan bodies"
    );
    // …while the identity/compat facts stay public.
    assert_eq!(public["functions"]["bundleHash"], "todo-functions-v0");
    let functions = public["functions"]["functions"]
        .as_array()
        .expect("functions");
    let module_fn = functions
        .iter()
        .find(|f| f["name"] == "sentinelQuery")
        .expect("sentinelQuery listed");
    assert_eq!(
        module_fn["runtime"]["IbexModule"]["export"],
        "sentinelQuery"
    );
    assert!(
        module_fn["runtime"]["IbexModule"].get("source").is_none(),
        "public runtime projection must not carry a source field"
    );
    let plan_fn = functions
        .iter()
        .find(|f| f["name"] == "sentinelMutation")
        .expect("sentinelMutation listed");
    assert_eq!(plan_fn["runtime"]["HostPlan"], "Mutation");

    // Gated /_snapback/api/inspect: the full manifest, bodies included.
    let gated = json(app.oneshot(get("/_snapback/api/inspect")).await.unwrap()).await;
    let gated_text = gated.to_string();
    assert!(
        gated_text.contains(SOURCE_SENTINEL),
        "gated inspect must retain handler source"
    );
    assert!(
        gated_text.contains(PLAN_SENTINEL),
        "gated inspect must retain host-plan bodies"
    );
}

/// ENG-23442 — the connection handshake: a dev-profile server adopts a
/// caller-suggested connection id (readable ids for demos/tests) but never
/// lets a second open displace a live grant, and a prod-profile server always
/// mints an unguessable id.
#[tokio::test]
async fn connection_open_adopts_suggestions_in_dev_and_mints_in_prod() {
    let app = app_with_context(seeded_snapback(), loopback_context(None));

    let unknown_field = app
        .clone()
        .oneshot(post(
            "/connection/open",
            json!({ "connectionId": "readable_conn", "logPreviousToken": true }),
        ))
        .await
        .unwrap();
    assert_eq!(unknown_field.status(), StatusCode::BAD_REQUEST);
    let unknown_field = json(unknown_field).await;
    assert_eq!(
        unknown_field["diagnostic"]["code"], "SNAPBACK_REQUEST_JSON_INVALID",
        "unknown connection-open fields use the stable strict-body diagnostic"
    );

    let first = json(
        app.clone()
            .oneshot(post(
                "/connection/open",
                json!({ "connectionId": "readable_conn" }),
            ))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(first["connectionId"], "readable_conn");
    let token = first["connectionToken"].as_str().expect("token");
    assert!(token.starts_with("sct_"), "server-minted token: {token}");

    // A colliding suggestion gets a minted id — the existing grant's bearer
    // is never rotated out from under the connection that holds it.
    let second = json(
        app.clone()
            .oneshot(post(
                "/connection/open",
                json!({ "connectionId": "readable_conn" }),
            ))
            .await
            .unwrap(),
    )
    .await;
    let second_id = second["connectionId"].as_str().expect("id");
    assert_ne!(second_id, "readable_conn");
    assert!(second_id.starts_with("conn_"), "minted id: {second_id}");

    // Prod never adopts caller-selected ids.
    let mut prod_context = loopback_context(None);
    prod_context.profile = snapback::admin::ServerProfile::Prod;
    let prod_state = test_app_state_from_snapback(seeded_snapback(), prod_context);
    // Production refuses ordinary app data while durable auth is still dev.
    // Install exact future item-5 readiness so this assertion continues to
    // isolate the profile's caller-selected-id behavior.
    let provider = Arc::new(
        AuthProvider::new(
            AuthProviderProfile::Prod,
            Arc::new(AuthKeyringStore::in_memory()),
        )
        .expect("production connection-open fixture provider"),
    );
    let prod = snapback::server::app(sessions_runtime(
        prod_state
            .try_with_auth_provider(provider)
            .expect("auth provider app state"),
    ));
    let minted = json(
        prod.oneshot(
            Request::builder()
                .method("POST")
                .uri("/connection/open")
                .header("content-type", "application/json")
                .header("x-snapback-auth-client-protocol", "1")
                .body(Body::from(
                    json!({ "connectionId": "attacker_chosen" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap(),
    )
    .await;
    let minted_id = minted["connectionId"].as_str().expect("id");
    assert_ne!(minted_id, "attacker_chosen");
    assert!(minted_id.starts_with("conn_"), "minted id: {minted_id}");
}

#[tokio::test]
async fn ephemeral_identity_ownership_is_enforced_through_http_and_reconnect() {
    let mut snapback = seeded_snapback();
    let mut presence = EphemeralCollection::local_cursor("userPresence", "roomId")
        .require_room_permission("presence");
    presence.key_mode = KeyMode::User;
    snapback.register_ephemeral_collection(presence).unwrap();
    let app = app_with_context(snapback, loopback_context(None));
    let token_a = open_connection(app.clone(), "conn-a").await;
    let token_b = open_connection(app.clone(), "conn-b").await;
    let scope = Scope::from_pairs([("roomId", "shared")]);
    let auth = |user: &str, permitted: bool| {
        let auth = AuthContext {
            user_id: Some(user.to_owned()),
            ..AuthContext::default()
        };
        if permitted {
            auth.with_room_permission("presence", &scope)
        } else {
            auth
        }
    };
    let publish = |connection: &str, claimed: &str, authenticated: &str| {
        json!({
            "collection": "userPresence",
            "scope": scope,
            "connection_id": connection,
            "session_id": null,
            "user_id": claimed,
            "custom_key": null,
            "value": [1],
            "ttl_ms": null,
            "auth": auth(authenticated, true),
        })
    };

    let created = app
        .clone()
        .oneshot(post_with_connection_token(
            "/ephemeral/publish",
            publish("conn-a", "user-a", "user-a"),
            &token_a,
        ))
        .await
        .unwrap();
    assert_eq!(created.status(), StatusCode::OK);

    for (uri, body) in [
        ("/ephemeral/publish", publish("conn-b", "user-a", "user-b")),
        (
            "/ephemeral/delete",
            json!({
                "collection": "userPresence",
                "scope": scope,
                "connection_id": "conn-b",
                "session_id": null,
                "user_id": "user-a",
                "custom_key": null,
                "auth": auth("user-b", true),
            }),
        ),
    ] {
        let denied = app
            .clone()
            .oneshot(post_with_connection_token(uri, body, &token_b))
            .await
            .unwrap();
        assert_eq!(denied.status(), StatusCode::BAD_REQUEST);
        assert_eq!(
            json(denied).await["diagnostic"]["code"],
            "SNAPBACK_EPHEMERAL_UNAUTHORIZED"
        );
    }

    // Ownership is mutation authority, not per-entry confidentiality: an
    // authorized room peer sees the presence snapshot but still cannot
    // address/modify user-a's key. A caller without room permission cannot
    // read the room at all.
    let peer_snapshot = json(
        app.clone()
            .oneshot(post_with_connection_token(
                "/ephemeral/subscribe",
                json!({
                    "collection": "userPresence",
                    "scope": scope,
                    "connection_id": "conn-b",
                    "auth": auth("user-b", true),
                }),
                &token_b,
            ))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(peer_snapshot["Snapshot"]["entries"][0]["key"], "user-a");
    assert_eq!(
        peer_snapshot["Snapshot"]["high_water_version"],
        peer_snapshot["Snapshot"]["entries"][0]["entry_version"],
        "the real HTTP snapshot transport must carry the authoritative room high-water"
    );

    let token_outsider = open_connection(app.clone(), "conn-outsider").await;
    let denied_read = app
        .clone()
        .oneshot(post_with_connection_token(
            "/ephemeral/subscribe",
            json!({
                "collection": "userPresence",
                "scope": scope,
                "connection_id": "conn-outsider",
                "auth": auth("user-outsider", false),
            }),
            &token_outsider,
        ))
        .await
        .unwrap();
    assert_eq!(
        json(denied_read).await["diagnostic"]["code"],
        "SNAPBACK_EPHEMERAL_UNAUTHORIZED"
    );

    let reopened = json(
        app.clone()
            .oneshot(post(
                "/connection/open",
                json!({ "connectionId": "conn-a", "previousToken": token_a }),
            ))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(reopened["connectionId"], "conn-a");
    assert_eq!(reopened["connectionToken"], token_a);
    let refreshed = app
        .oneshot(post_with_connection_token(
            "/ephemeral/publish",
            publish("conn-a", "user-a", "user-a"),
            &token_a,
        ))
        .await
        .unwrap();
    assert_eq!(refreshed.status(), StatusCode::OK);
}

#[tokio::test]
async fn ephemeral_session_identity_conflicts_fail_through_websocket_frames() {
    let mut snapback = seeded_snapback();
    let mut presence = EphemeralCollection::local_cursor("sessionPresence", "roomId");
    presence.key_mode = KeyMode::Session;
    snapback.register_ephemeral_collection(presence).unwrap();
    let state = test_detached_app_state(snapback);
    let grant = state
        .connections
        .open(Some("conn-b".to_owned()), None, true)
        .expect("connection grant");
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        snapback::server::app(state)
            .bind(listener)
            .unwrap()
            .serve()
            .await
            .unwrap();
    });

    use tokio_tungstenite::tungstenite::client::IntoClientRequest as _;
    let mut request = format!("ws://{addr}/live/conn-b/stream")
        .into_client_request()
        .unwrap();
    request
        .headers_mut()
        .insert("sec-websocket-protocol", "snapback.v1".parse().unwrap());
    request.headers_mut().insert(
        "x-snapback-connection-token",
        grant.connection_token.parse().unwrap(),
    );
    let (mut stream, _) = connect_async(request).await.unwrap();

    for (request_id, kind, extra) in [
        (
            "publish-conflict",
            "ephemeral_publish",
            json!({ "value": [1], "ttl_ms": null }),
        ),
        ("delete-conflict", "ephemeral_delete", json!({})),
    ] {
        let mut request = json!({
            "collection": "sessionPresence",
            "scope": { "roomId": "shared" },
            "connection_id": "conn-b",
            "session_id": "session-a",
            "user_id": null,
            "custom_key": null,
            "auth": {
                "principal": "user-b",
                "session_id": "session-b",
                "user_id": "user-b",
                "permissions": []
            }
        });
        request
            .as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        stream
            .send(tokio_tungstenite::tungstenite::Message::Text(
                json!({ "type": kind, "requestId": request_id, "request": request })
                    .to_string()
                    .into(),
            ))
            .await
            .unwrap();
        let reply = tokio::time::timeout(Duration::from_secs(2), stream.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        let reply: Value = serde_json::from_str(&reply.into_text().unwrap()).unwrap();
        assert_eq!(reply["kind"], "ephemeral_error");
        assert_eq!(
            reply["diagnostic"]["code"],
            "SNAPBACK_EPHEMERAL_UNAUTHORIZED"
        );
    }
    server.abort();
}

/// ENG-23442 — connection ids are no longer bearerless capabilities: an
/// outbox drain or live subscribe without the grant's token is refused, a
/// drain with ANOTHER connection's token is refused, and the refused attempts
/// do not consume the victim's queued update.
#[tokio::test]
async fn outbox_drain_and_live_subscribe_demand_the_connection_token() {
    let app = app_with_context(seeded_snapback(), loopback_context(None));

    let victim_token = open_connection(app.clone(), "victim_conn").await;
    let attacker_token = open_connection(app.clone(), "attacker_conn").await;

    // A caller-chosen id that was never opened is refused even with a token.
    let squatted = app
        .clone()
        .oneshot(post_with_connection_token(
            "/live/listTodos/subscribe",
            json!({
                "connection_id": "squatter_conn",
                "input": { "args": {}, "auth": { "user_id": "user_1" } }
            }),
            &attacker_token,
        ))
        .await
        .unwrap();
    assert_eq!(squatted.status(), StatusCode::FORBIDDEN);

    // The victim subscribes and a mutation queues a durable update.
    let subbed = app
        .clone()
        .oneshot(post_with_connection_token(
            "/live/listTodos/subscribe",
            json!({
                "connection_id": "victim_conn",
                "input": { "args": {}, "auth": { "user_id": "user_1" } }
            }),
            &victim_token,
        ))
        .await
        .unwrap();
    assert_eq!(subbed.status(), StatusCode::OK);
    let mutated = app
        .clone()
        .oneshot(post(
            "/mutation/createTodo",
            json!({ "args": { "title": "queued for victim" }, "auth": { "user_id": "user_1" } }),
        ))
        .await
        .unwrap();
    assert_eq!(mutated.status(), StatusCode::OK);
    let mutation_response: MutationResponse = serde_json::from_value(json(mutated).await)
        .expect("direct mutation response matches its Rust wire authority");
    assert_eq!(mutation_response.changed_count, 1);
    let rejected = app
        .clone()
        .oneshot(post(
            "/mutation/noSuchMutation",
            json!({ "args": {}, "auth": { "user_id": "user_1" } }),
        ))
        .await
        .unwrap();
    assert_eq!(rejected.status(), StatusCode::NOT_FOUND);
    let rejected_json = json(rejected).await;
    let rejected: ErrorResponse = serde_json::from_value(rejected_json)
        .expect("rejected mutation matches the typed error/receipt authority");
    assert!(
        rejected.receipt.is_none(),
        "unknown functions fail in the shared invocation gate before the provider receipt boundary"
    );

    // Bare drain: 401 (token required).
    let bare = app
        .clone()
        .oneshot(get("/outbox/victim_conn"))
        .await
        .unwrap();
    assert_eq!(bare.status(), StatusCode::UNAUTHORIZED);
    let bare_body = json(bare).await;
    assert_eq!(
        bare_body["diagnostic"]["code"],
        "SNAPBACK_CONNECTION_TOKEN_REQUIRED"
    );

    // Another connection's valid token: 403 (not an existence oracle either).
    let cross = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/outbox/victim_conn")
                .header("x-snapback-connection-token", &attacker_token)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(cross.status(), StatusCode::FORBIDDEN);
    let cross_body = json(cross).await;
    assert_eq!(
        cross_body["diagnostic"]["code"],
        "SNAPBACK_CONNECTION_TOKEN_INVALID"
    );

    // The rightful owner drains (query-param transport): the refused attempts
    // consumed nothing — the queued durable update is still there.
    let drained = json(
        app.clone()
            .oneshot(get(&format!(
                "/outbox/victim_conn?connection_token={victim_token}"
            )))
            .await
            .unwrap(),
    )
    .await;
    let envelopes = drained.as_array().expect("envelope array");
    assert!(
        envelopes
            .iter()
            .any(|envelope| envelope.get("Durable").is_some()),
        "the victim's queued live update must survive refused drains: {drained}"
    );
}

/// Local connection grants cannot retain an unbounded set of durable live
/// subscriptions. The public route returns the same typed 429 diagnostic as
/// the hosted coordinator, and an authenticated unsubscribe immediately
/// releases capacity for the same grant.
#[tokio::test]
async fn live_subscribe_route_enforces_and_releases_per_connection_capacity() {
    let app = app_with_context(seeded_snapback(), loopback_context(None));
    let token = open_connection(app.clone(), "bounded-live").await;
    let mut first_subscription_id = None;

    for index in 0..MAX_LIVE_SUBSCRIPTIONS_PER_CONNECTION {
        let response = app
            .clone()
            .oneshot(post_with_connection_token(
                "/live/listTodos/subscribe",
                json!({
                    "connection_id": "bounded-live",
                    "input": { "args": {}, "auth": { "user_id": "user_1" } }
                }),
                &token,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK, "subscription {index}");
        if index == 0 {
            let body = json(response).await;
            first_subscription_id = Some(
                body["subscription_id"]
                    .as_str()
                    .expect("subscription_id")
                    .to_owned(),
            );
        }
    }

    let refused = app
        .clone()
        .oneshot(post_with_connection_token(
            "/live/listTodos/subscribe",
            json!({
                "connection_id": "bounded-live",
                "input": { "args": {}, "auth": { "user_id": "user_1" } }
            }),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(refused.status(), StatusCode::TOO_MANY_REQUESTS);
    let refused: ErrorResponse = serde_json::from_value(json(refused).await)
        .expect("subscription limit response matches typed error envelope");
    assert_eq!(
        refused.diagnostic.code,
        "SNAPBACK_SUBSCRIPTION_CONNECTION_LIMIT"
    );
    assert_eq!(
        refused.diagnostic.details["limit"],
        MAX_LIVE_SUBSCRIPTIONS_PER_CONNECTION
    );

    let unsubscribed = app
        .clone()
        .oneshot(post_with_connection_token(
            "/live/listTodos/unsubscribe",
            json!({
                "subscription_id": first_subscription_id.expect("first subscription id"),
                "connection_id": "bounded-live",
                "auth": { "user_id": "user_1" }
            }),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(unsubscribed.status(), StatusCode::OK);

    let admitted = app
        .oneshot(post_with_connection_token(
            "/live/listTodos/subscribe",
            json!({
                "connection_id": "bounded-live",
                "input": { "args": {}, "auth": { "user_id": "user_1" } }
            }),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(admitted.status(), StatusCode::OK);
}

/// ENG-23442 — the live-stream upgrade is token-gated before the socket
/// exists, and the browser-compatible `snapback.connection-token.<token>`
/// subprotocol transport authenticates (with `snapback.v1` echoed).
#[tokio::test]
async fn stream_upgrade_requires_the_connection_token() {
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;

    let state = test_detached_app_state(seeded_snapback());
    let grant = state
        .connections
        .open(Some("gated_ws".to_owned()), None, true)
        .expect("connection grant");
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = snapback::server::app(state);
    let server = tokio::spawn(async move {
        app.bind(listener).unwrap().serve().await.unwrap();
    });

    let upgrade_status = |error: tokio_tungstenite::tungstenite::Error| match error {
        tokio_tungstenite::tungstenite::Error::Http(response) => response.status().as_u16(),
        other => panic!("expected an HTTP refusal, got {other:?}"),
    };

    // Bare upgrade: refused with 401 before any socket exists.
    let bare = connect_async(format!("ws://{addr}/live/gated_ws/stream")).await;
    assert_eq!(upgrade_status(bare.expect_err("must refuse")), 401);

    // Query-string credentials are never consumed, even when valid: they are
    // treated exactly like a missing grant so the value cannot become URL
    // metadata (ENG-24354).
    let wrong = connect_async(format!(
        "ws://{addr}/live/gated_ws/stream?connection_token=sct_not_the_token"
    ))
    .await;
    assert_eq!(upgrade_status(wrong.expect_err("must refuse")), 401);
    let leaked = connect_async(format!(
        "ws://{addr}/live/gated_ws/stream?connection_token={}",
        grant.connection_token
    ))
    .await;
    assert_eq!(upgrade_status(leaked.expect_err("must refuse")), 401);

    // Explicit header transport remains available to non-browser clients.
    let mut header_request = format!("ws://{addr}/live/gated_ws/stream")
        .into_client_request()
        .unwrap();
    header_request
        .headers_mut()
        .insert("sec-websocket-protocol", "snapback.v1".parse().unwrap());
    header_request.headers_mut().insert(
        "x-snapback-connection-token",
        grant.connection_token.parse().unwrap(),
    );
    let (_header_stream, _) = connect_async(header_request)
        .await
        .expect("header token upgrade");

    // Subprotocol transport (what a browser client uses): authenticates, and
    // the server echoes the negotiated `snapback.v1`.
    let mut request = format!("ws://{addr}/live/gated_ws/stream")
        .into_client_request()
        .unwrap();
    request.headers_mut().insert(
        "sec-websocket-protocol",
        format!(
            "snapback.v1, snapback.connection-token.{}",
            grant.connection_token
        )
        .parse()
        .unwrap(),
    );
    let (_stream, response) = connect_async(request).await.expect("token upgrade");
    assert_eq!(
        response
            .headers()
            .get("sec-websocket-protocol")
            .and_then(|value| value.to_str().ok()),
        Some("snapback.v1")
    );

    server.abort();
}

/* ---------- harness ---------- */

fn loopback_app(snapback: LocalSnapback) -> snapback::server::SnapbackApp {
    app_with_context(snapback, loopback_context(None))
}

fn missing_dist_app(snapback: LocalSnapback) -> snapback::server::SnapbackApp {
    let mut context = loopback_context(None);
    context.admin_dist = None;
    app_with_context(snapback, context)
}

fn app_with_context(snapback: LocalSnapback, ctx: ServerContext) -> snapback::server::SnapbackApp {
    snapback::server::app(test_app_state_from_snapback(snapback, ctx))
}

fn sessions_runtime(state: AppState) -> AppState {
    let digest = |prefix: &str, marker: char| format!("{prefix}{}", marker.to_string().repeat(64));
    let deployment = DeploymentIdentity {
        schema_version: "snapback.v1".to_owned(),
        auth_mode: AuthMode::Sessions,
        app_id: "admin-v0-sessions".to_owned(),
        schema_hash: digest(SCHEMA_V1_PREFIX, '1'),
        bundle_hash: digest(FUNCTION_V1_PREFIX, '2'),
        inputs_hash: digest(INPUTS_V1_PREFIX, '3'),
    };
    state
        .with_auth_runtime_facts(
            AuthModeStateRecord {
                format_version: AUTH_MODE_FORMAT_VERSION,
                transition_generation: 1,
                active: AuthMode::Sessions,
                desired: AuthMode::Sessions,
                mode_state: AuthModeStatus::Settled,
                app_data_availability: AppDataAvailability::Available,
                sessions_ever_activated: true,
                active_deployment: Some(deployment),
                requested_deployment: None,
                quarantine: None,
            },
            AuthProgramReadiness {
                route_registry_enforced: true,
                existing_surface_closure: true,
                admin_secret_read_enforced: true,
                secret_read_process_prerequisites: true,
                provider_core: true,
                shared_invocation_gate: true,
                staged_mode: true,
                connection_binding: true,
                two_phase_revocation: true,
                auth_coordinator: true,
                authorization_invalidation: false,
                authority_descriptor: false,
                authorized_lease: false,
                password_provider: PasswordProviderReadiness::requires_v4(None),
                session_activation_ready: true,
            },
        )
        .expect("install exact future sessions runtime facts")
}

fn loopback_context(token: Option<&str>) -> ServerContext {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let mut context = ServerContext::from_bound_listener(&listener).unwrap();
    context.profile = snapback::admin::ServerProfile::Dev;
    context.admin_token = token.map(ToOwned::to_owned);
    context
}

fn exposed_context(token: Option<&str>) -> ServerContext {
    let listener = std::net::TcpListener::bind("0.0.0.0:0").unwrap();
    let mut context = ServerContext::from_bound_listener(&listener).unwrap();
    context.profile = snapback::admin::ServerProfile::Dev;
    context.admin_token = token.map(ToOwned::to_owned);
    context
}

fn dist_context(dist: std::path::PathBuf) -> ServerContext {
    let mut context = ServerContext::new("127.0.0.1", 4287, true);
    context.profile = snapback::admin::ServerProfile::Dev;
    context.admin_dist = Some(dist);
    context
}

fn get(uri: &str) -> Request<Body> {
    Request::builder().uri(uri).body(Body::empty()).unwrap()
}

fn get_accept(uri: &str, accept: &str) -> Request<Body> {
    Request::builder()
        .uri(uri)
        .header("accept", accept)
        .body(Body::empty())
        .unwrap()
}

fn post(uri: &str, body: Value) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(uri)
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}

fn post_raw_json(uri: &str, body: &str) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(uri)
        .header("content-type", "application/json")
        .body(Body::from(body.to_owned()))
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

fn post_with_console_credential(uri: &str, body: Value, credential: &str) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(uri)
        .header("content-type", "application/json")
        .header("x-snapback-console-credential", credential)
        .body(Body::from(body.to_string()))
        .unwrap()
}

fn claim_exchange_request(claim_code: &str, peer: &str) -> Request<Body> {
    let mut request = post(
        "/_snapback/api/console/claim/exchange",
        json!({ "claimCode": claim_code }),
    );
    request
        .extensions_mut()
        .insert(ConnectInfo(peer.parse::<std::net::SocketAddr>().unwrap()));
    request
}

fn post_with_connection_token(uri: &str, body: Value, token: &str) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(uri)
        .header("content-type", "application/json")
        .header("x-snapback-connection-token", token)
        .body(Body::from(body.to_string()))
        .unwrap()
}

/// Open a connection grant over HTTP (ENG-23442) and return its token. In the
/// dev-profile test contexts the suggested id is adopted verbatim.
async fn open_connection(app: snapback::server::SnapbackApp, connection_id: &str) -> String {
    let resp = app
        .oneshot(post(
            "/connection/open",
            json!({ "connectionId": connection_id }),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let grant = json(resp).await;
    assert_eq!(grant["connectionId"], connection_id);
    grant["connectionToken"]
        .as_str()
        .expect("connectionToken")
        .to_owned()
}

fn handler_input(args: Value, user_id: &str) -> HandlerInput {
    HandlerInput {
        args,
        auth: AuthInput {
            principal: Some(user_id.to_owned()),
            session_id: None,
            user_id: Some(user_id.to_owned()),
            ..AuthInput::default()
        },
        read_set: Vec::new(),
        correlation: None,
        ctx_ledger: None,
    }
}

async fn text(resp: snapback_server::test_support::axum::response::Response) -> String {
    let bytes = snapback_server::test_support::axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    String::from_utf8(bytes.to_vec()).unwrap()
}

async fn json(resp: snapback_server::test_support::axum::response::Response) -> Value {
    let bytes = snapback_server::test_support::axum::body::to_bytes(resp.into_body(), usize::MAX)
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
                unique: false,
                where_applicable: false,
            }],
            syncable: true,
            permission_backing: false,
            permission_fields: None,
            search_indexes: Vec::new(),
            vector_indexes: Vec::new(),
            search_live_limits: None,
            membership: None,
            authority_profile: None,
            asset_sharing: None,
            // Admin-route tests need the historical non-owner table posture,
            // but omission is no longer authority. Declare it explicitly.
            visibility: Some(TableVisibilityV1::PublicRead),
            history: None,
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
                    table_visibility: None,
                    table: "todos".to_owned(),
                    filters: vec![],
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
    let state = test_detached_app_state(seeded_snapback());
    let grant = state
        .connections
        .open(Some("client_ws_a".to_owned()), None, true)
        .expect("connection grant");
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = snapback::server::app(state);
    let server = tokio::spawn(async move {
        app.bind(listener).unwrap().serve().await.unwrap();
    });

    use tokio_tungstenite::tungstenite::client::IntoClientRequest as _;
    let mut request = format!("ws://{addr}/live/client_ws_a/stream")
        .into_client_request()
        .unwrap();
    request
        .headers_mut()
        .insert("sec-websocket-protocol", "snapback.v1".parse().unwrap());
    request.headers_mut().insert(
        "x-snapback-connection-token",
        grant.connection_token.parse().unwrap(),
    );
    let (mut stream, _) = connect_async(request).await.unwrap();

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

/// ENG-22527 item 3 / SECURITY — ephemeral unsubscribe is an eviction
/// primitive, so it rides the shared live socket (not a public HTTP route):
/// the S3 sender gate binds it to the socket's connection. A participant
/// cannot evict another connection's room subscription by asserting its id,
/// and the connection's own idle-linger teardown still works end to end
/// (removed + disposal receipt).
#[tokio::test]
async fn ephemeral_unsubscribe_is_bound_to_the_socket_connection() {
    let mut snapback = seeded_snapback();
    snapback
        .register_ephemeral_collection(EphemeralCollection::local_cursor("cursors", "roomId"))
        .unwrap();
    let state = test_detached_app_state(snapback);
    let grant = state
        .connections
        .open(Some("owner_ws".to_owned()), None, true)
        .expect("connection grant");
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = snapback::server::app(state);
    let server = tokio::spawn(async move {
        app.bind(listener).unwrap().serve().await.unwrap();
    });

    use tokio_tungstenite::tungstenite::client::IntoClientRequest as _;
    let mut request = format!("ws://{addr}/live/owner_ws/stream")
        .into_client_request()
        .unwrap();
    request
        .headers_mut()
        .insert("sec-websocket-protocol", "snapback.v1".parse().unwrap());
    request.headers_mut().insert(
        "x-snapback-connection-token",
        grant.connection_token.parse().unwrap(),
    );
    let (mut stream, _) = connect_async(request).await.unwrap();

    let text =
        |frame: Value| tokio_tungstenite::tungstenite::Message::Text(frame.to_string().into());
    let unsubscribe_frame = |connection_id: &str| {
        json!({
            "type": "ephemeral_unsubscribe",
            "requestId": "req_unsub",
            "request": {
                "collection": "cursors",
                "scope": { "roomId": "room_1" },
                "connection_id": connection_id,
                "auth": { "principal": null, "session_id": null, "user_id": null, "permissions": [] }
            }
        })
    };

    // The owner subscribes its own connection.
    stream
        .send(text(json!({
            "type": "ephemeral_subscribe",
            "requestId": "req_sub",
            "request": {
                "collection": "cursors",
                "scope": { "roomId": "room_1" },
                "connection_id": "owner_ws",
                "auth": { "principal": null, "session_id": null, "user_id": null, "permissions": [] }
            }
        })))
        .await
        .unwrap();
    let sub_ack: Value = serde_json::from_str(
        &tokio::time::timeout(Duration::from_secs(2), stream.next())
            .await
            .expect("subscribe reply timeout")
            .expect("websocket closed")
            .expect("websocket message")
            .into_text()
            .unwrap(),
    )
    .unwrap();
    assert_eq!(
        sub_ack["kind"], "ephemeral_ack",
        "subscribe acked: {sub_ack}"
    );

    // An attacker who knows the owner's connection id (in Connection key mode
    // it is BROADCAST as the entry key) tries to evict it over ITS OWN socket:
    // rejected by the sender gate before touching the store.
    stream
        .send(text(unsubscribe_frame("victim_owner_ws")))
        .await
        .unwrap();
    let spoof: Value = serde_json::from_str(
        &tokio::time::timeout(Duration::from_secs(2), stream.next())
            .await
            .expect("spoof reply timeout")
            .expect("websocket closed")
            .expect("websocket message")
            .into_text()
            .unwrap(),
    )
    .unwrap();
    assert_eq!(spoof["kind"], "ephemeral_error");
    assert_eq!(
        spoof["diagnostic"]["code"], "SNAPBACK_WEBSOCKET_SENDER_MISMATCH",
        "a spoofed unsubscribe must be rejected: {spoof}"
    );

    // The owner's own unsubscribe still removes its registration — removed:true
    // here also proves the spoof above did NOT evict it — and carries the
    // disposal receipt the idle-linger teardown records.
    stream
        .send(text(unsubscribe_frame("owner_ws")))
        .await
        .unwrap();
    let ack: Value = serde_json::from_str(
        &tokio::time::timeout(Duration::from_secs(2), stream.next())
            .await
            .expect("self-unsubscribe reply timeout")
            .expect("websocket closed")
            .expect("websocket message")
            .into_text()
            .unwrap(),
    )
    .unwrap();
    assert_eq!(
        ack["kind"], "ephemeral_ack",
        "self-unsubscribe acked: {ack}"
    );
    assert_eq!(
        ack["removed"],
        json!(true),
        "the owner's registration survived the spoof and is now removed"
    );
    assert_eq!(ack["receipt"]["lane"], "ephemeral");
    assert_eq!(ack["receipt"]["event"], "disposed");
    assert_eq!(ack["receipt"]["reason"], "unsubscribed");
    assert_eq!(ack["receipt"]["removed"], json!(true));

    server.abort();
}
