//! ENG-25102 acceptance: the same in-memory server constructed by `--memory`
//! serves the build-embedded guide, including the complete flat projection and
//! the two cache/version identity headers.

fn test_detached_app_state(snapback: snapback::local::LocalSnapback) -> snapback::admin::AppState {
    snapback::admin::AppState::try_detached(snapback).expect("detached test app state")
}

use serde_json::Value;
use snapback::guide::{FLAT_PATH, GUIDE_CONTENT_SHA256, INDEX_PATH, SECTION_FLAT_PATHS};
use snapback::local::LocalSnapback;
use snapback::server::{
    GUIDE_BUILD_COMMIT_HEADER, GUIDE_CONTENT_HASH_HEADER, HTTP_ROUTES_PATH, ResponseSensitivity,
    RouteClass, RoutePolicy, app, route_registry,
};
use snapback_server::test_support::axum::body::{Body, to_bytes};
use snapback_server::test_support::axum::http::{Request, StatusCode, header};
use std::collections::BTreeSet;
use std::io::Read;
use std::process::Stdio;
use std::time::{Duration, Instant};
use tower::ServiceExt;

fn memory_server() -> snapback::server::SnapbackApp {
    app(test_detached_app_state(
        LocalSnapback::memory().expect("in-memory served-guide server"),
    ))
}

async fn get(path: &str) -> snapback_server::test_support::axum::response::Response {
    memory_server()
        .oneshot(
            Request::builder()
                .uri(path)
                .body(Body::empty())
                .expect("guide request"),
        )
        .await
        .expect("guide response")
}

fn header<'a>(
    response: &'a snapback_server::test_support::axum::response::Response,
    name: &str,
) -> &'a str {
    response
        .headers()
        .get(name)
        .unwrap_or_else(|| panic!("missing response header {name}"))
        .to_str()
        .expect("ASCII guide identity header")
}

/// The ticket's black-box witness: exercise the real CLI serve path with the
/// exact `--memory` flag, an OS-assigned port, and its readiness handshake.
#[tokio::test]
async fn cli_memory_server_serves_the_build_bound_flat_guide() {
    let temp = tempfile::tempdir().expect("served-guide CLI tempdir");
    let ready_file = temp.path().join("ready.json");
    let mut child = tokio::process::Command::new(env!("CARGO_BIN_EXE_snapback"))
        .args([
            "start",
            "--port",
            "0",
            "--memory",
            "--ready-file",
            ready_file.to_str().expect("UTF-8 temp path"),
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .expect("spawn snapback start --memory");

    let deadline = Instant::now() + Duration::from_secs(15);
    let server_url = loop {
        if let Ok(text) = std::fs::read_to_string(&ready_file)
            && let Ok(ready) = serde_json::from_str::<Value>(&text)
            && ready["ready"] == true
        {
            break ready["serverUrl"]
                .as_str()
                .expect("ready descriptor serverUrl")
                .to_owned();
        }
        if let Some(status) = child.try_wait().expect("poll snapback start --memory") {
            panic!("snapback start --memory exited before readiness: {status}");
        }
        assert!(
            Instant::now() < deadline,
            "snapback start --memory readiness timeout"
        );
        tokio::time::sleep(Duration::from_millis(25)).await;
    };

    let request_url = format!("{server_url}/_snapback/guide/flat.md");
    let served = tokio::task::spawn_blocking(move || {
        let response = ureq::get(&request_url)
            .call()
            .expect("GET served guide from snapback start --memory");
        let status = response.status();
        let content_hash = response
            .header(GUIDE_CONTENT_HASH_HEADER)
            .expect("guide hash header")
            .to_owned();
        let build_commit = response
            .header(GUIDE_BUILD_COMMIT_HEADER)
            .expect("guide build header")
            .to_owned();
        let mut body = Vec::new();
        response
            .into_reader()
            .read_to_end(&mut body)
            .expect("read served flat guide");
        (status, content_hash, build_commit, body)
    })
    .await
    .expect("join served-guide HTTP request");

    child.start_kill().expect("stop snapback start --memory");
    let _ = child.wait().await;

    assert_eq!(served.0, 200);
    assert_eq!(served.1, *GUIDE_CONTENT_SHA256);
    assert_eq!(
        served.2,
        option_env!("SNAPBACK_BUILD_GIT_COMMIT").unwrap_or("unknown")
    );
    assert_eq!(
        served.3,
        include_bytes!("../../../guide/guide-flat.generated.md")
    );
}

/// @ref LLP 0061#4-distribution-and-discovery — served-guide §4a:
/// The bulk route returns the manifest-ordered corpus and its build binding.
#[tokio::test]
async fn memory_server_serves_flat_projection_with_manifest_identity() {
    let response = get("/_snapback/guide/flat.md").await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers()[header::CONTENT_TYPE],
        "text/markdown; charset=utf-8"
    );
    assert_eq!(
        header(&response, GUIDE_CONTENT_HASH_HEADER),
        *GUIDE_CONTENT_SHA256
    );
    assert_eq!(
        header(&response, GUIDE_BUILD_COMMIT_HEADER),
        option_env!("SNAPBACK_BUILD_GIT_COMMIT").unwrap_or("unknown")
    );

    let bytes = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read embedded flat guide");
    assert_eq!(
        bytes.as_ref(),
        include_bytes!("../../../guide/guide-flat.generated.md")
    );
    let manifest: Value =
        serde_json::from_str(include_str!("../../../guide/guide-manifest.generated.json"))
            .expect("generated guide manifest JSON");
    // @ref LLP 0194#design — contentHash now binds both the flat Markdown and
    // non-Markdown registry bytes, so it intentionally is not the flat SHA.
    assert_eq!(manifest["contentHash"], *GUIDE_CONTENT_SHA256);
}

#[tokio::test]
async fn memory_server_serves_every_section_projection_with_manifest_identity() {
    assert!(!SECTION_FLAT_PATHS.is_empty());
    for path in SECTION_FLAT_PATHS.iter() {
        let response = get(&format!("/_snapback/guide/{path}")).await;
        assert_eq!(response.status(), StatusCode::OK, "section flat {path}");
        assert_eq!(
            header(&response, GUIDE_CONTENT_HASH_HEADER),
            *GUIDE_CONTENT_SHA256
        );
        assert_eq!(
            header(&response, GUIDE_BUILD_COMMIT_HEADER),
            option_env!("SNAPBACK_BUILD_GIT_COMMIT").unwrap_or("unknown")
        );
        let bytes = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("read embedded section flat");
        assert_eq!(bytes.as_ref(), snapback::guide::file(path).unwrap().bytes);
    }
}

#[tokio::test]
async fn memory_server_serves_root_llms_txt_with_guide_identity() {
    let response = get("/llms.txt").await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers()[header::CONTENT_TYPE],
        "text/markdown; charset=utf-8"
    );
    assert_eq!(
        header(&response, GUIDE_CONTENT_HASH_HEADER),
        *GUIDE_CONTENT_SHA256
    );
    assert_eq!(
        header(&response, GUIDE_BUILD_COMMIT_HEADER),
        option_env!("SNAPBACK_BUILD_GIT_COMMIT").unwrap_or("unknown")
    );

    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read llms.txt index");
    let body = std::str::from_utf8(&body).expect("UTF-8 llms.txt index");
    assert!(body.contains("/_snapback/guide/flat.md"));
    assert!(body.contains("/_snapback/guide/capabilities.md"));
    assert!(body.contains("/_snapback/guide/surface-map.md"));
    assert!(body.contains("/_snapback/guide/guide-flat.backend.generated.md"));
    assert!(body.contains("about 2.5 MiB"));
    // @ref LLP 0259#1-first-read-contract — the start-packet tier leads the
    // Read-first index; the capability index is a labeled lookup registry.
    assert!(body.contains("/_snapback/guide/start/mental-model.md"));
    assert!(body.contains("/_snapback/guide/start/index.md"));
    assert!(
        body.find("/_snapback/guide/start/mental-model.md").unwrap()
            < body.find("/_snapback/guide/capabilities.md").unwrap()
    );
    assert!(body.contains("do not linear-read"));
    assert!(
        body.find("/_snapback/guide/capabilities.md").unwrap()
            < body
                .find("/_snapback/guide/guide-flat.backend.generated.md")
                .unwrap()
    );
    assert!(
        body.find("/_snapback/guide/guide-flat.backend.generated.md")
            .unwrap()
            < body.find("/_snapback/guide/flat.md").unwrap()
    );
    assert!(body.contains("/_snapback/guide/reference/index.md"));
    assert!(body.contains("/_snapback/guide/reference/registry.json"));
    assert!(body.contains(HTTP_ROUTES_PATH));
    assert!(body.contains("/_snapback/guide/reference/diagnostics.md"));
    assert!(body.contains("/_snapback/guide/reference/diagnostics-registry.json"));
    assert!(body.contains("`snapback mcp`"));
    assert!(body.contains("`snapback mcp-control`"));
    assert!(body.contains("snapback agent setup --print <client> --server mcp-control"));
}

#[tokio::test]
async fn memory_server_serves_build_bound_http_route_schema_join() {
    let response = get(HTTP_ROUTES_PATH).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers()[header::CONTENT_TYPE],
        "application/json; charset=utf-8"
    );
    assert_eq!(
        header(&response, GUIDE_BUILD_COMMIT_HEADER),
        option_env!("SNAPBACK_BUILD_GIT_COMMIT").unwrap_or("unknown")
    );
    let bytes = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read HTTP route catalog");
    assert_eq!(
        bytes.as_ref(),
        include_bytes!("../../../schemas/http.routes.v1.json")
    );
    let value: Value = serde_json::from_slice(&bytes).expect("route catalog JSON");
    assert_eq!(value["formatVersion"], "snapback.http-routes.v1");
    let query = value["routes"]
        .as_array()
        .expect("route rows")
        .iter()
        .find(|route| route["method"] == "POST" && route["path"] == "/query/{name}")
        .expect("query route row");
    assert_eq!(query["class"], "AppData");
    assert_eq!(query["path_policy"], "AppAuth");
    assert_eq!(query["credential_resolution"], "LegacyBodyAuth");
    assert_eq!(query["inputSchema"]["$ref"], "query.input.schema.json");
    assert_eq!(query["outputSchema"]["$ref"], "query.output.schema.json");
}

#[tokio::test]
async fn index_and_individual_build_embedded_files_are_public_read_only() {
    let index = get("/_snapback/guide").await;
    assert_eq!(index.status(), StatusCode::OK);
    assert_eq!(
        header(&index, GUIDE_CONTENT_HASH_HEADER),
        *GUIDE_CONTENT_SHA256
    );
    assert_eq!(
        to_bytes(index.into_body(), usize::MAX)
            .await
            .unwrap()
            .as_ref(),
        include_bytes!("../../../guide/index.md")
    );

    let page = get("/_snapback/guide/getting-started/your-first-backend.md").await;
    assert_eq!(page.status(), StatusCode::OK);
    assert_eq!(
        page.headers()[header::CONTENT_TYPE],
        "text/markdown; charset=utf-8"
    );
    assert_eq!(
        header(&page, GUIDE_CONTENT_HASH_HEADER),
        *GUIDE_CONTENT_SHA256
    );

    // The recursive wildcard must serve nested authored pages, not only the
    // section index and generated projections.
    let authored_page = get("/_snapback/guide/auth/protecting-data.md").await;
    assert_eq!(authored_page.status(), StatusCode::OK);
    assert_eq!(
        to_bytes(authored_page.into_body(), usize::MAX)
            .await
            .unwrap()
            .as_ref(),
        include_bytes!("../../../guide/auth/protecting-data.md")
    );

    let manifest = get("/_snapback/guide/guide-manifest.generated.json").await;
    assert_eq!(manifest.status(), StatusCode::OK);
    assert_eq!(
        manifest.headers()[header::CONTENT_TYPE],
        "application/json; charset=utf-8"
    );
    let manifest_commit = header(&manifest, GUIDE_BUILD_COMMIT_HEADER).to_owned();
    let manifest_body: Value = serde_json::from_slice(
        &to_bytes(manifest.into_body(), usize::MAX)
            .await
            .expect("read embedded manifest"),
    )
    .expect("embedded manifest JSON");
    assert_eq!(manifest_body["buildIdentity"]["commit"], manifest_commit);

    // @ref LLP 0194#design — recursive embedding plus the closed wildcard
    // route serves both human Markdown and the canonical registry bytes.
    let reference_index = get("/_snapback/guide/reference/index.md").await;
    assert_eq!(reference_index.status(), StatusCode::OK);
    assert_eq!(
        to_bytes(reference_index.into_body(), usize::MAX)
            .await
            .unwrap()
            .as_ref(),
        include_bytes!("../../../guide/reference/index.md")
    );
    let registry = get("/_snapback/guide/reference/registry.json").await;
    assert_eq!(registry.status(), StatusCode::OK);
    assert_eq!(
        registry.headers()[header::CONTENT_TYPE],
        "application/json; charset=utf-8"
    );
    assert_eq!(
        to_bytes(registry.into_body(), usize::MAX)
            .await
            .unwrap()
            .as_ref(),
        include_bytes!("../../../guide/reference/registry.json")
    );
    let diagnostics = get("/_snapback/guide/reference/diagnostics.md").await;
    assert_eq!(diagnostics.status(), StatusCode::OK);
    assert_eq!(
        to_bytes(diagnostics.into_body(), usize::MAX)
            .await
            .unwrap()
            .as_ref(),
        include_bytes!("../../../guide/reference/diagnostics.md")
    );
    let diagnostics_registry = get("/_snapback/guide/reference/diagnostics-registry.json").await;
    assert_eq!(diagnostics_registry.status(), StatusCode::OK);
    assert_eq!(
        diagnostics_registry.headers()[header::CONTENT_TYPE],
        "application/json; charset=utf-8"
    );
    assert_eq!(
        to_bytes(diagnostics_registry.into_body(), usize::MAX)
            .await
            .unwrap()
            .as_ref(),
        include_bytes!("../../../guide/reference/diagnostics-registry.json")
    );

    assert_eq!(
        get("/_snapback/guide/eval-runs/2026-07-15/realtime.md")
            .await
            .status(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        get("/_snapback/guide/not-a-page.md").await.status(),
        StatusCode::NOT_FOUND
    );
}

#[test]
fn served_guide_routes_are_registered_system_static_public_projections() {
    let guide_routes = route_registry()
        .into_iter()
        .filter(|route| route.path.starts_with("/_snapback/guide") || route.path == "/llms.txt")
        .collect::<Vec<_>>();
    assert_eq!(
        guide_routes
            .iter()
            .map(|route| route.path)
            .collect::<BTreeSet<_>>(),
        BTreeSet::from([
            "/_snapback/guide",
            "/_snapback/guide/flat.md",
            "/_snapback/guide/http.routes.v1.json",
            "/_snapback/guide/{*path}",
            "/llms.txt",
        ])
    );
    for route in guide_routes {
        assert_eq!(route.method, "GET");
        assert_eq!(route.class, RouteClass::SystemStatic);
        assert_eq!(route.path_policy, RoutePolicy::Public);
        assert_eq!(
            route.response_sensitivity,
            ResponseSensitivity::PublicProjection
        );
    }

    assert_eq!(
        snapback::guide::file(INDEX_PATH).unwrap().bytes,
        include_bytes!("../../../guide/index.md")
    );
    assert_eq!(
        snapback::guide::file(FLAT_PATH).unwrap().bytes,
        include_bytes!("../../../guide/guide-flat.generated.md")
    );
    for path in SECTION_FLAT_PATHS.iter() {
        assert!(snapback::guide::file(path).is_some());
    }
    assert!(snapback::guide::file("capabilities.md").is_some());
    assert!(snapback::guide::file("reference/index.md").is_some());
    assert!(snapback::guide::file("reference/registry.json").is_some());
    assert!(snapback::guide::file("reference/diagnostics.md").is_some());
    assert!(snapback::guide::file("reference/diagnostics-registry.json").is_some());
}
