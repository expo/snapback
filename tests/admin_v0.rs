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
use snapback::ephemeral::EphemeralCollection;
use snapback::local::{LiveSubscribeInput, LocalSnapback};
use snapback::manifest::{
    AppIdentity, AuthInput, FieldManifest, FieldType, FunctionDefinition, FunctionKind,
    FunctionManifest, FunctionRuntime, HandlerInput, HandlerPlan, IbexModule, IndexManifest,
    MutationPlan, MutationStep, OrderDirection, OrderExpr, QueryPlan, SchemaManifest, SeedData,
    TableManifest, ValueExpr,
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
        "the served module is the @snapback/admin-client package file"
    );
    assert_eq!(
        source,
        include_str!("../packages/snapback-admin-client/index.mjs"),
        "byte-identical to the workspace package the Contract admin-ui imports"
    );
}

#[tokio::test]
async fn missing_console_dist_is_explicit_and_inspect_still_serves() {
    let app = loopback_app(seeded_snapback());

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
        body.contains("admin-ui") && body.contains("./build.sh"),
        "diagnostic tells the developer how to build the Contract console"
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
    let state = AppState::detached(seeded_snapback());
    let shared = state.snapback.clone();
    // ENG-23442: the stream upgrade demands the connection grant.
    let grant = state
        .connections
        .open(Some("client_ws".to_owned()), None, true);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = snapback::server::app(state);
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    use tokio_tungstenite::tungstenite::client::IntoClientRequest as _;
    let mut request = format!("ws://{addr}/live/client_ws/stream")
        .into_client_request()
        .unwrap();
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
/// through only with the minted token in hand. The read-open inspect names
/// the token file so same-user tooling can pick up the capability — a browser
/// page cannot read files.
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

    let inspect = json(
        app.clone()
            .oneshot(get("/_snapback/api/inspect"))
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
/// refused by `require_non_prod_profile` even where the admin-token layer
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
async fn optional_json_routes_reject_nonempty_untyped_or_invalid_bodies_without_side_effects() {
    let app = app_with_context(seeded_snapback(), loopback_context(None));
    let seed = json!({ "seed": { "tables": { "todos": [
        { "_id": "must_not_land", "title": "ignored", "completed": false, "userId": "user_1" }
    ] } } });

    for (content_type, body) in [
        (None, seed.to_string()),
        (Some("text/plain"), seed.to_string()),
        (Some("application/json"), "{not-json".to_owned()),
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
        .body(Body::from(format!(r#"{{"padding":"{}"}}"#, "x".repeat(3_000_000))))
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

    let untyped_open = Request::builder()
        .method("POST")
        .uri("/connection/open")
        .body(Body::from(r#"{"connectionId":"must_not_adopt"}"#))
        .unwrap();
    let response = app.clone().oneshot(untyped_open).await.unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        json(response).await["diagnostic"]["code"],
        "SNAPBACK_REQUEST_JSON_INVALID"
    );

    let empty_open = Request::builder()
        .method("POST")
        .uri("/connection/open")
        .body(Body::empty())
        .unwrap();
    assert_eq!(
        app.oneshot(empty_open).await.unwrap().status(),
        StatusCode::OK
    );
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
    let prod = app_with_context(
        seeded_snapback(),
        ServerContext {
            profile: snapback::admin::ServerProfile::Prod,
            ..loopback_context(None)
        },
    );
    let minted = json(
        prod.oneshot(post(
            "/connection/open",
            json!({ "connectionId": "attacker_chosen" }),
        ))
        .await
        .unwrap(),
    )
    .await;
    let minted_id = minted["connectionId"].as_str().expect("id");
    assert_ne!(minted_id, "attacker_chosen");
    assert!(minted_id.starts_with("conn_"), "minted id: {minted_id}");
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

/// ENG-23442 — the live-stream upgrade is token-gated before the socket
/// exists, and the browser-compatible `snapback.connection-token.<token>`
/// subprotocol transport authenticates (with `snapback.v1` echoed).
#[tokio::test]
async fn stream_upgrade_requires_the_connection_token() {
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;

    let state = AppState::detached(seeded_snapback());
    let grant = state
        .connections
        .open(Some("gated_ws".to_owned()), None, true);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = snapback::server::app(state);
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
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

fn loopback_app(snapback: LocalSnapback) -> axum::Router {
    app_with_context(snapback, loopback_context(None))
}

fn app_with_context(snapback: LocalSnapback, ctx: ServerContext) -> axum::Router {
    snapback::server::app(AppState::from_snapback(snapback, ctx))
}

fn loopback_context(token: Option<&str>) -> ServerContext {
    ServerContext {
        profile: snapback::admin::ServerProfile::Dev,
        host: "127.0.0.1".to_owned(),
        port: 4287,
        loopback: true,
        pid: std::process::id(),
        started: Instant::now(),
        started_at_ms: 0,
        admin_token: token.map(ToOwned::to_owned),
        admin_token_minted: false,
        admin_token_file: None,
        admin_dist: None,
    }
}

fn exposed_context(token: Option<&str>) -> ServerContext {
    ServerContext {
        profile: snapback::admin::ServerProfile::Dev,
        host: "0.0.0.0".to_owned(),
        port: 4287,
        loopback: false,
        pid: std::process::id(),
        started: Instant::now(),
        started_at_ms: 0,
        admin_token: token.map(ToOwned::to_owned),
        admin_token_minted: false,
        admin_token_file: None,
        admin_dist: None,
    }
}

fn dist_context(dist: std::path::PathBuf) -> ServerContext {
    ServerContext {
        profile: snapback::admin::ServerProfile::Dev,
        host: "127.0.0.1".to_owned(),
        port: 4287,
        loopback: true,
        pid: std::process::id(),
        started: Instant::now(),
        started_at_ms: 0,
        admin_token: None,
        admin_token_minted: false,
        admin_token_file: None,
        admin_dist: Some(dist),
    }
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
async fn open_connection(app: axum::Router, connection_id: &str) -> String {
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
        },
        read_set: Vec::new(),
        correlation: None,
        ctx_ledger: None,    }
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
    let grant = state
        .connections
        .open(Some("client_ws_a".to_owned()), None, true);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = snapback::server::app(state);
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    use tokio_tungstenite::tungstenite::client::IntoClientRequest as _;
    let mut request = format!("ws://{addr}/live/client_ws_a/stream")
        .into_client_request()
        .unwrap();
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
    snapback.register_ephemeral_collection(EphemeralCollection::local_cursor("cursors", "roomId"));
    let state = AppState::detached(snapback);
    let grant = state
        .connections
        .open(Some("owner_ws".to_owned()), None, true);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = snapback::server::app(state);
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    use tokio_tungstenite::tungstenite::client::IntoClientRequest as _;
    let mut request = format!("ws://{addr}/live/owner_ws/stream")
        .into_client_request()
        .unwrap();
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
