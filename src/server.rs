use crate::admin::{AppState, ServerContext};
use crate::diagnostic::{Diagnostic, SnapbackError};
use crate::ephemeral::{
    DeleteRequest, EphemeralCollection, PublishRequest, Scope, SubscribeRequest,
};
use crate::local::{
    EphemeralApi, InspectState, LiveResumeInput, LiveSubscribeInput, LiveUnsubscribeInput,
    LocalSnapback,
};
use crate::manifest::{FunctionManifest, HandlerInput, SchemaManifest, SeedData};
use crate::runtime::CapabilityState;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, HeaderValue, Method, Request, StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router, body::Body};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tokio::time::{Duration, interval};

pub type SharedSnapback = Arc<Mutex<LocalSnapback>>;

/// Run write-lane work against the instance without blocking a tokio worker.
///
/// Waiting for the global mutex stays async (`lock_owned` — queued callers
/// burn no thread); only actual execution occupies a blocking-pool thread,
/// with the owned guard moved into the closure. Every server path that can
/// reach Hermes eval or rusqlite goes through here (or the read lane), which
/// is what keeps the exec-guard assertion true. Ephemeral operations and
/// outbox drains no longer take this mutex at all (LLP 0032 L9 — they go to
/// the internally synchronized `EphemeralApi`); disconnect still locks
/// inline because it tears down durable subscriptions, which is memory-only.
///
/// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L7.
pub(crate) async fn with_snapback<T, F>(state: &SharedSnapback, work: F) -> T
where
    F: FnOnce(&mut LocalSnapback) -> T + Send + 'static,
    T: Send + 'static,
{
    let mut guard = state.clone().lock_owned().await;
    tokio::task::spawn_blocking(move || {
        let _sanction = crate::exec_guard::BlockingSanction::acquire();
        work(&mut guard)
    })
    .await
    .expect("snapback blocking task panicked")
}

/// Run read-lane work (no global mutex) on a blocking-pool thread: the lane
/// still evals Hermes and reads SQLite, so it must not occupy a tokio worker.
///
/// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L6+L7.
pub(crate) async fn with_read_lane<T, F>(read: &crate::local::ReadLane, work: F) -> T
where
    F: FnOnce(&crate::local::ReadLane) -> T + Send + 'static,
    T: Send + 'static,
{
    let read = read.clone();
    tokio::task::spawn_blocking(move || {
        let _sanction = crate::exec_guard::BlockingSanction::acquire();
        work(&read)
    })
    .await
    .expect("read-lane blocking task panicked")
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct HealthResponse {
    pub ok: bool,
    pub target: String,
    pub sqlite_version: u64,
    pub ibex_available: bool,
    /// Server-binary identity (ENG-22798): build/git provenance + a per-process
    /// startup nonce, so an externally started — possibly unprovisioned or
    /// schema-only — server is provenance-verifiable before any app bundle loads.
    ///
    /// @ref LLP 0031#server-binary-identity-on-health — build identity rides the
    /// ungated public /health; the reuse-provenance verdict falls back to it when
    /// bundle identity (`/inspect` appId/bundleHash) is unavailable.
    pub binary: crate::identity::BinaryIdentity,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct DiagnosticsResponse {
    pub diagnostics: Vec<Diagnostic>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct ErrorResponse {
    pub diagnostic: Diagnostic,
}

/// The app-data routes: the operations an ordinary app client calls. Every one
/// lives at the server root, carries app-supplied `ctx.auth` or is explicitly
/// public, and never performs instance-level control.
///
/// @ref LLP 0003#agent-and-test-surface — the local core exposes inspect, query, mutation, live, and ephemeral endpoints.
/// @ref LLP 0031#the-invariant — app-data routes live at the root; system routes live under `/_snapback/*`. The classification is declared once in `route_registry`.
fn core_routes() -> Router<AppState> {
    Router::new()
        .route("/", get(instance_home))
        .route("/health", get(health))
        .route("/inspect", get(inspect))
        .route("/query/{name}", post(invoke_query))
        .route("/mutation/{name}", post(invoke_mutation))
        .route("/action/{name}", post(invoke_action))
        .route("/app/ensure", post(ensure_app))
        .route("/live/{name}/subscribe", post(subscribe_live))
        .route("/live/{name}/resume", post(resume_live))
        .route("/live/{name}/unsubscribe", post(unsubscribe_live))
        .route("/live/{connection_id}/stream", get(stream_live))
        .route("/outbox/{connection_id}", get(drain_outbox))
        .route(
            "/ephemeral/collections/ensure",
            post(ensure_ephemeral_collections),
        )
        .route("/ephemeral/publish", post(publish_ephemeral))
        .route("/ephemeral/subscribe", post(subscribe_ephemeral))
        .route("/ephemeral/delete", post(delete_ephemeral))
}

/// The migrated system routes that used to hide at the root as ungated
/// `/admin/*` aliases (schema/functions/reset load, connection teardown). They
/// now live under `/_snapback/api/*` behind the admin write policy, projecting
/// the LLP 0024 host-ops nouns (`schema.load`, `functions.load`, `app.reset`).
///
/// @ref LLP 0031#migration-plan — D5 flat `subsystem/verb` writes and the D2 disconnect move.
fn system_routes() -> Router<AppState> {
    Router::new()
        .route("/_snapback/api/schema/load", post(apply_schema))
        .route("/_snapback/api/functions/load", post(load_functions))
        .route("/_snapback/api/app/reset", post(app_reset))
        // @ref LLP 0024#result-envelope — the host-ops first slice (LLP 0032
        // P6): one operation endpoint, one hostOpsResult envelope per call;
        // the legacy per-noun routes above stay as documented aliases.
        .route("/_snapback/api/host-ops", post(host_ops_handler))
        .route(
            "/_snapback/api/connections/{connection_id}/disconnect",
            post(disconnect),
        )
        // @ref LLP 0036#operations-and-projections-llp-0024 — the config ops:
        // status/plan read-gated, set/unset/verify write-gated; the wizard is
        // a projection of these, not a second implementation.
        .route("/_snapback/api/config/status", get(config_status))
        .route("/_snapback/api/config/plan", get(config_plan))
        .route("/_snapback/api/config/set", post(config_set))
        .route("/_snapback/api/config/unset", post(config_unset))
        .route("/_snapback/api/config/verify", post(config_verify))
}

/// The full Snapback HTTP surface: app-data root routes, the migrated
/// `/_snapback/api/*` system writes, and the admin console/API — one server,
/// one declared boundary (`route_registry`).
///
/// @ref LLP 0031#the-invariant — no system operation lives at the root; the enforcement test guards it.
pub fn app(state: AppState) -> Router {
    core_routes()
        .merge(system_routes())
        .merge(crate::admin::admin_routes())
        .with_state(state)
        .layer(middleware::from_fn(local_dev_cors))
}

/// The path class of a route or a multiplexed operation.
///
/// @ref LLP 0031#route-classification — every operation is app-data or system.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RouteClass {
    /// An operation an app client may call; lives at the server root.
    AppData,
    /// Static console shell/assets under `/_snapback/admin*`; public presentation only.
    SystemStatic,
    /// A system API operation under `/_snapback/api/*`; admin-gated.
    SystemApi,
}

/// The authorization policy a route carries. `AppAuth` means the handler may
/// enforce the app-supplied `ctx.auth` — not that the transport authenticates
/// the caller (in local v0 it does not; see LLP 0031 §The invariant).
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RoutePolicy {
    Public,
    AppAuth,
    AdminRead,
    AdminWrite,
}

/// A declared route in the registry.
#[derive(Clone, Copy, Debug)]
pub struct RouteSpec {
    pub method: &'static str,
    pub path: &'static str,
    pub class: RouteClass,
    pub policy: RoutePolicy,
}

/// The declared route registry — the single source of truth for the
/// app-data/system boundary. `app()` builds the router from these exact paths;
/// because axum's `Router` cannot be introspected at runtime, this declaration
/// is the mechanical guarantee a proxy relies on, and the enforcement test
/// (`route_registry_matches_the_invariant`) asserts the invariant over it. Keep
/// this list in lockstep with `core_routes`/`system_routes`/`admin_routes`.
///
/// @ref LLP 0031#enforcement — registry-driven enforcement; the classified unit is the operation.
pub fn route_registry() -> Vec<RouteSpec> {
    use RouteClass::{AppData, SystemApi, SystemStatic};
    use RoutePolicy::{AdminRead, AdminWrite, AppAuth, Public};
    let spec = |method, path, class, policy| RouteSpec {
        method,
        path,
        class,
        policy,
    };
    vec![
        // App-data — root.
        spec("GET", "/", AppData, Public),
        spec("GET", "/health", AppData, Public),
        spec("GET", "/inspect", AppData, Public),
        spec("POST", "/query/{name}", AppData, AppAuth),
        spec("POST", "/mutation/{name}", AppData, AppAuth),
        spec("POST", "/action/{name}", AppData, AppAuth),
        spec("POST", "/app/ensure", AppData, Public),
        spec("POST", "/live/{name}/subscribe", AppData, AppAuth),
        spec("POST", "/live/{name}/resume", AppData, AppAuth),
        spec("POST", "/live/{name}/unsubscribe", AppData, AppAuth),
        spec("GET", "/live/{connection_id}/stream", AppData, AppAuth),
        spec("GET", "/outbox/{connection_id}", AppData, Public),
        spec("POST", "/ephemeral/collections/ensure", AppData, Public),
        spec("POST", "/ephemeral/publish", AppData, Public),
        spec("POST", "/ephemeral/subscribe", AppData, Public),
        spec("POST", "/ephemeral/delete", AppData, Public),
        // System API — migrated gated writes (LLP 0031 D5/D2).
        spec("POST", "/_snapback/api/schema/load", SystemApi, AdminWrite),
        spec(
            "POST",
            "/_snapback/api/functions/load",
            SystemApi,
            AdminWrite,
        ),
        spec("POST", "/_snapback/api/app/reset", SystemApi, AdminWrite),
        spec("POST", "/_snapback/api/host-ops", SystemApi, AdminWrite),
        spec(
            "POST",
            "/_snapback/api/connections/{connection_id}/disconnect",
            SystemApi,
            AdminWrite,
        ),
        // System API — existing admin surface.
        spec("GET", "/_snapback/api/health", SystemApi, AdminRead),
        spec("GET", "/_snapback/api/inspect", SystemApi, AdminRead),
        spec("GET", "/_snapback/api/receipts", SystemApi, AdminRead),
        spec("GET", "/_snapback/api/data/{table}", SystemApi, AdminRead),
        // Function runner gates dynamically (read for queries, write for
        // mutations); declared as the stronger write policy.
        spec(
            "POST",
            "/_snapback/api/functions/{name}/run",
            SystemApi,
            AdminWrite,
        ),
        spec("POST", "/_snapback/api/cron/tick", SystemApi, AdminWrite),
        spec(
            "POST",
            "/_snapback/api/cron/{name}/run",
            SystemApi,
            AdminWrite,
        ),
        spec(
            "POST",
            "/_snapback/api/ephemeral/cleanup",
            SystemApi,
            AdminWrite,
        ),
        // System API — app config ops (LLP 0036 §Route placement).
        spec("GET", "/_snapback/api/config/status", SystemApi, AdminRead),
        spec("GET", "/_snapback/api/config/plan", SystemApi, AdminRead),
        spec("POST", "/_snapback/api/config/set", SystemApi, AdminWrite),
        spec("POST", "/_snapback/api/config/unset", SystemApi, AdminWrite),
        spec(
            "POST",
            "/_snapback/api/config/verify",
            SystemApi,
            AdminWrite,
        ),
        // System static — console shell/assets (public presentation only).
        spec("GET", "/_snapback/admin", SystemStatic, Public),
        spec("GET", "/_snapback/admin/", SystemStatic, Public),
        spec("GET", "/_snapback/admin/setup", SystemStatic, Public),
        spec("GET", "/_snapback/admin/{*path}", SystemStatic, Public),
    ]
}

/// The operations multiplexed over the `/live/{id}/stream` socket. Per LLP 0031
/// the classified unit is the *operation*, so these are classified in their own
/// right — all app-data today — so an app-data route cannot smuggle a system
/// operation. Kept in lockstep with `LiveSocketClientMessage` by the exhaustive
/// match in `live_socket_operation_name` (test build); the enforcement test
/// asserts every one is app-data.
///
/// @ref LLP 0031#enforcement — WebSocket message kinds are asserted against the registry directly.
pub fn live_socket_operations() -> Vec<(&'static str, RouteClass)> {
    vec![
        ("ephemeral_subscribe", RouteClass::AppData),
        ("ephemeral_publish", RouteClass::AppData),
        ("ephemeral_delete", RouteClass::AppData),
        ("ephemeral_unsubscribe", RouteClass::AppData),
        ("live_ping", RouteClass::AppData),
    ]
}

/// Browser-friendly default route for a running Snapback instance.
///
/// One public metadata object ([`InstanceStatus`]), four renderings, chosen by
/// content negotiation: HTML for browsers, and JSON, Markdown, or YAML for
/// clients that ask for them. YAML stays the default so `curl /` keeps reading
/// the way it always has; `?format=` overrides the header for direct machine
/// rendering requests.
///
/// @ref LLP 0017#serving-model — system surfaces live under the reserved
/// `/_snapback/*` namespace; the default route can point humans at them without
/// becoming another privileged API.
/// @ref LLP 0024#http-projection — agent operations remain admin API/MCP
/// projections, not the root browser URL.
async fn instance_home(
    State(state): State<SharedSnapback>,
    State(ctx): State<Arc<ServerContext>>,
    Query(query): Query<HomeQuery>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    // inspect() reads SQLite (storage version), so this goes through the
    // offload like every other rusqlite-touching handler (L7). The review of
    // this arc caught the original inline lock here: it panicked the exec
    // guard on every debug-build GET / while current-thread tests stayed green.
    let inspect = with_snapback(&state, |snapback| snapback.inspect()).await?;
    let status = instance_status(&inspect, &ctx);
    let accept = headers
        .get(header::ACCEPT)
        .and_then(|value| value.to_str().ok());
    Ok(
        match negotiate_home_format(query.format.as_deref(), accept) {
            HomeFormat::Html => (
                [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
                instance_home_html(&status),
            )
                .into_response(),
            HomeFormat::Json => Json(&status).into_response(),
            HomeFormat::Markdown => (
                [(header::CONTENT_TYPE, "text/markdown; charset=utf-8")],
                instance_home_markdown(&status),
            )
                .into_response(),
            HomeFormat::Yaml => (
                [(header::CONTENT_TYPE, "text/yaml; charset=utf-8")],
                instance_home_yaml(&status),
            )
                .into_response(),
        },
    )
}

#[derive(Debug, Deserialize)]
struct HomeQuery {
    format: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum HomeFormat {
    Yaml,
    Json,
    Markdown,
    Html,
}

/// `?format=` wins, then the earliest recognized media type in `Accept`, then
/// YAML — the shape `/` has always served to non-browser clients, so agents
/// and `curl` (which sends `*/*`) see no change.
fn negotiate_home_format(format_param: Option<&str>, accept: Option<&str>) -> HomeFormat {
    match format_param.map(str::to_ascii_lowercase).as_deref() {
        Some("html") => return HomeFormat::Html,
        Some("json") => return HomeFormat::Json,
        Some("md") | Some("markdown") => return HomeFormat::Markdown,
        Some("yaml") | Some("yml") => return HomeFormat::Yaml,
        _ => {}
    }
    for entry in accept.unwrap_or_default().split(',') {
        let media = entry
            .split(';')
            .next()
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        match media.as_str() {
            "text/html" | "application/xhtml+xml" => return HomeFormat::Html,
            "application/json" | "text/json" => return HomeFormat::Json,
            "text/markdown" | "text/x-markdown" => return HomeFormat::Markdown,
            "text/yaml" | "text/x-yaml" | "application/yaml" | "application/x-yaml"
            | "text/plain" => return HomeFormat::Yaml,
            _ => {}
        }
    }
    HomeFormat::Yaml
}

/// The public instance-status metadata object behind every `/` rendering.
/// Everything here must be safe on the open, unauthenticated root.
///
/// @ref LLP 0031#resolved-decisions — D3: the public `/` must not reveal the
/// absolute on-disk DB path; report the mode, not the location.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstanceStatus {
    schema_version: String,
    status_kind: String,
    name: String,
    target: String,
    runtime_engine: String,
    app: AppStatus,
    storage: StorageStatus,
    server: ServerStatus,
    admin: AdminStatus,
    artifacts: ArtifactsStatus,
    counts: CountsStatus,
    capabilities: CapabilitiesStatus,
    links: LinksStatus,
}

/// App identity as declared by the loaded schema manifest (`app` block); the
/// id field is present in the payload, and may be empty before an app is
/// loaded. Presentation fields appear only when the app declares them.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppStatus {
    id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    icon_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    wordmark_url: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StorageStatus {
    engine: String,
    mode: String,
    detail: String,
    database_version: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerStatus {
    bind: String,
    host: String,
    port: u16,
    loopback: bool,
    uptime_ms: u64,
    uptime: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AdminStatus {
    access: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ArtifactsStatus {
    schema_hash: String,
    bundle_hash: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CountsStatus {
    loaded_tables: usize,
    loaded_functions: usize,
    live_subscriptions: usize,
    cron_jobs: usize,
    recent_diagnostics: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CapabilitiesStatus {
    summary: String,
    gaps: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LinksStatus {
    admin_console: String,
    health_json: String,
    inspect_json: String,
}

fn instance_status(inspect: &InspectState, ctx: &ServerContext) -> InstanceStatus {
    let storage_mode = if inspect.storage.sqlite_path.is_some() {
        "file"
    } else {
        "memory"
    };
    let storage_detail = if inspect.storage.sqlite_path.is_some() {
        "on-disk database"
    } else {
        "in-memory database"
    };
    let capability_summary = if inspect.capability_gaps.is_empty() {
        "No reported capability gaps".to_owned()
    } else {
        format!(
            "{} capability {} reported",
            inspect.capability_gaps.len(),
            if inspect.capability_gaps.len() == 1 {
                "gap"
            } else {
                "gaps"
            }
        )
    };
    let app = inspect.schema.app.clone().unwrap_or_default();
    InstanceStatus {
        schema_version: inspect.schema_version.clone(),
        status_kind: "snapbackInstanceStatus".to_owned(),
        name: "Snapback local server".to_owned(),
        target: inspect.target.clone(),
        runtime_engine: inspect.capability_manifest.runtime_engine.clone(),
        app: AppStatus {
            id: inspect.schema.app_id.clone(),
            name: app.name,
            description: app.description,
            icon_url: app.icon_url,
            wordmark_url: app.wordmark_url,
        },
        storage: StorageStatus {
            engine: inspect.capability_manifest.storage_engine.clone(),
            mode: storage_mode.to_owned(),
            detail: storage_detail.to_owned(),
            database_version: inspect.storage.version,
        },
        server: ServerStatus {
            bind: format!("{}:{}", ctx.host, ctx.port),
            host: ctx.host.clone(),
            port: ctx.port,
            loopback: ctx.loopback,
            uptime_ms: ctx.uptime_ms(),
            uptime: format_duration(ctx.uptime_ms()),
        },
        admin: AdminStatus {
            access: admin_access_summary(ctx),
        },
        artifacts: ArtifactsStatus {
            schema_hash: inspect
                .schema
                .schema_hash
                .clone()
                .unwrap_or_else(|| "not loaded".to_owned()),
            bundle_hash: inspect
                .functions
                .bundle_hash
                .clone()
                .unwrap_or_else(|| "not loaded".to_owned()),
        },
        counts: CountsStatus {
            loaded_tables: inspect.storage.tables.len(),
            loaded_functions: inspect.functions.functions.len(),
            live_subscriptions: inspect.subscriptions.len(),
            cron_jobs: inspect.cron.jobs.len(),
            recent_diagnostics: inspect.recent_diagnostics.len(),
        },
        capabilities: CapabilitiesStatus {
            summary: capability_summary,
            gaps: inspect.capability_gaps.clone(),
        },
        links: LinksStatus {
            admin_console: "/_snapback/admin".to_owned(),
            health_json: "/_snapback/api/health".to_owned(),
            inspect_json: "/_snapback/api/inspect".to_owned(),
        },
    }
}

fn instance_home_yaml(status: &InstanceStatus) -> String {
    let mut out = String::new();
    out.push_str(&format!(
        "schemaVersion: {}\n",
        yaml_string(&status.schema_version)
    ));
    out.push_str(&format!(
        "statusKind: {}\n",
        yaml_string(&status.status_kind)
    ));
    out.push_str(&format!("name: {}\n", yaml_string(&status.name)));
    out.push_str(&format!("target: {}\n", yaml_string(&status.target)));
    out.push_str(&format!(
        "runtimeEngine: {}\n",
        yaml_string(&status.runtime_engine)
    ));
    out.push_str("app:\n");
    out.push_str(&format!("  id: {}\n", yaml_string(&status.app.id)));
    for (key, value) in [
        ("name", &status.app.name),
        ("description", &status.app.description),
        ("iconUrl", &status.app.icon_url),
        ("wordmarkUrl", &status.app.wordmark_url),
    ] {
        if let Some(value) = value {
            out.push_str(&format!("  {key}: {}\n", yaml_string(value)));
        }
    }
    out.push_str("storage:\n");
    out.push_str(&format!(
        "  engine: {}\n",
        yaml_string(&status.storage.engine)
    ));
    out.push_str(&format!("  mode: {}\n", yaml_string(&status.storage.mode)));
    out.push_str(&format!(
        "  detail: {}\n",
        yaml_string(&status.storage.detail)
    ));
    out.push_str(&format!(
        "  databaseVersion: {}\n",
        status.storage.database_version
    ));
    out.push_str("server:\n");
    out.push_str(&format!("  bind: {}\n", yaml_string(&status.server.bind)));
    out.push_str(&format!("  host: {}\n", yaml_string(&status.server.host)));
    out.push_str(&format!("  port: {}\n", status.server.port));
    out.push_str(&format!("  loopback: {}\n", status.server.loopback));
    out.push_str(&format!("  uptimeMs: {}\n", status.server.uptime_ms));
    out.push_str(&format!(
        "  uptime: {}\n",
        yaml_string(&status.server.uptime)
    ));
    out.push_str("admin:\n");
    out.push_str(&format!(
        "  access: {}\n",
        yaml_string(&status.admin.access)
    ));
    out.push_str("artifacts:\n");
    out.push_str(&format!(
        "  schemaHash: {}\n",
        yaml_string(&status.artifacts.schema_hash)
    ));
    out.push_str(&format!(
        "  bundleHash: {}\n",
        yaml_string(&status.artifacts.bundle_hash)
    ));
    out.push_str("counts:\n");
    out.push_str(&format!(
        "  loadedTables: {}\n",
        status.counts.loaded_tables
    ));
    out.push_str(&format!(
        "  loadedFunctions: {}\n",
        status.counts.loaded_functions
    ));
    out.push_str(&format!(
        "  liveSubscriptions: {}\n",
        status.counts.live_subscriptions
    ));
    out.push_str(&format!("  cronJobs: {}\n", status.counts.cron_jobs));
    out.push_str(&format!(
        "  recentDiagnostics: {}\n",
        status.counts.recent_diagnostics
    ));
    out.push_str("capabilities:\n");
    out.push_str(&format!(
        "  summary: {}\n",
        yaml_string(&status.capabilities.summary)
    ));
    out.push_str(&format!(
        "  gaps: {}\n",
        yaml_string_list(&status.capabilities.gaps)
    ));
    out.push_str("links:\n");
    out.push_str(&format!(
        "  adminConsole: {}\n",
        yaml_string(&status.links.admin_console)
    ));
    out.push_str(&format!(
        "  healthJson: {}\n",
        yaml_string(&status.links.health_json)
    ));
    out.push_str(&format!(
        "  inspectJson: {}\n",
        yaml_string(&status.links.inspect_json)
    ));
    out
}

fn instance_home_markdown(status: &InstanceStatus) -> String {
    let mut out = String::new();
    let title = status.app.name.as_deref().unwrap_or(&status.name);
    out.push_str(&format!("# {title}\n\n"));
    if let Some(description) = &status.app.description {
        out.push_str(&format!("{description}\n\n"));
    }
    out.push_str("A Snapback instance is running here.\n\n");
    out.push_str(&format!("- schemaVersion: `{}`\n", status.schema_version));
    out.push_str(&format!("- statusKind: `{}`\n", status.status_kind));
    out.push_str(&format!("- name: {}\n", status.name));
    out.push_str(&format!("- target: `{}`\n", status.target));
    out.push_str(&format!("- runtimeEngine: `{}`\n", status.runtime_engine));
    out.push_str("\n## app\n\n");
    out.push_str(&format!("- id: `{}`\n", status.app.id));
    for (key, value) in [
        ("name", &status.app.name),
        ("description", &status.app.description),
        ("iconUrl", &status.app.icon_url),
        ("wordmarkUrl", &status.app.wordmark_url),
    ] {
        if let Some(value) = value {
            out.push_str(&format!("- {key}: {value}\n"));
        }
    }
    out.push_str("\n## storage\n\n");
    out.push_str(&format!("- engine: `{}`\n", status.storage.engine));
    out.push_str(&format!("- mode: `{}`\n", status.storage.mode));
    out.push_str(&format!("- detail: {}\n", status.storage.detail));
    out.push_str(&format!(
        "- databaseVersion: {}\n",
        status.storage.database_version
    ));
    out.push_str("\n## server\n\n");
    out.push_str(&format!("- bind: `{}`\n", status.server.bind));
    out.push_str(&format!("- host: `{}`\n", status.server.host));
    out.push_str(&format!("- port: {}\n", status.server.port));
    out.push_str(&format!("- loopback: {}\n", status.server.loopback));
    out.push_str(&format!("- uptimeMs: {}\n", status.server.uptime_ms));
    out.push_str(&format!("- uptime: {}\n", status.server.uptime));
    out.push_str("\n## admin\n\n");
    out.push_str(&format!("- access: {}\n", status.admin.access));
    out.push_str("\n## artifacts\n\n");
    out.push_str(&format!(
        "- schemaHash: `{}`\n",
        status.artifacts.schema_hash
    ));
    out.push_str(&format!(
        "- bundleHash: `{}`\n",
        status.artifacts.bundle_hash
    ));
    out.push_str("\n## counts\n\n");
    out.push_str(&format!(
        "- loadedTables: {}\n",
        status.counts.loaded_tables
    ));
    out.push_str(&format!(
        "- loadedFunctions: {}\n",
        status.counts.loaded_functions
    ));
    out.push_str(&format!(
        "- liveSubscriptions: {}\n",
        status.counts.live_subscriptions
    ));
    out.push_str(&format!("- cronJobs: {}\n", status.counts.cron_jobs));
    out.push_str(&format!(
        "- recentDiagnostics: {}\n",
        status.counts.recent_diagnostics
    ));
    out.push_str("\n## capabilities\n\n");
    out.push_str(&format!("- summary: {}\n", status.capabilities.summary));
    if status.capabilities.gaps.is_empty() {
        out.push_str("- gaps: none\n");
    } else {
        for gap in &status.capabilities.gaps {
            out.push_str(&format!("- gap: {gap}\n"));
        }
    }
    out.push_str("\n## links\n\n");
    out.push_str(&format!(
        "- [Admin console]({})\n",
        status.links.admin_console
    ));
    out.push_str(&format!("- [Health JSON]({})\n", status.links.health_json));
    out.push_str(&format!(
        "- [Inspect JSON]({})\n",
        status.links.inspect_json
    ));
    out
}

/// The embedded browser homepage. Like the embedded admin console it is a
/// single self-contained file — inline styles, inline brand SVG, no external
/// assets — so a bare `cargo run` serves it with no toolchain.
const INSTANCE_HOME_HTML: &str = include_str!("server/instance_home.html");
const SNAPBACK_MARK_SVG: &str = include_str!("../brand/snapback-mark.svg");
const SNAPBACK_FAVICON_SVG: &str = include_str!("../brand/favicon.svg");
const LOCK_ICON_SVG: &str = r#"<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>"#;

fn instance_home_html(status: &InstanceStatus) -> String {
    let title = match &status.app.name {
        Some(name) => format!("{name} — Snapback"),
        None => "Snapback".to_owned(),
    };
    INSTANCE_HOME_HTML
        .replace("__TITLE__", &html_escape(&title))
        .replace("__FAVICON_HREF__", &svg_data_uri(SNAPBACK_FAVICON_SVG))
        .replace("__SNAPBACK_MARK__", SNAPBACK_MARK_SVG)
        .replace("__LOCK_ICON__", LOCK_ICON_SVG)
        .replace("__HERO__", &instance_home_hero(status))
        .replace("__FACTS__", &instance_home_facts(status))
        .replace(
            "__DETAILS_YAML__",
            &html_escape(&instance_home_yaml(status)),
        )
}

/// App-branded hero when the manifest declares an identity, Snapback-branded
/// otherwise. Every app-supplied value is escaped: the manifest is app-authored
/// input, and this page renders on the open root.
fn instance_home_hero(status: &InstanceStatus) -> String {
    let app = &status.app;
    let app_id = if status.artifacts.schema_hash == "not loaded" {
        ""
    } else {
        app.id.trim()
    };
    let name = non_empty(&app.name);
    let description = non_empty(&app.description);
    let icon_url = non_empty(&app.icon_url);
    let wordmark_url = non_empty(&app.wordmark_url);
    let has_identity = name.is_some()
        || description.is_some()
        || icon_url.is_some()
        || wordmark_url.is_some()
        || !app_id.is_empty();
    if !has_identity {
        return String::new();
    }
    let mut out = String::new();
    if let Some(icon_url) = icon_url {
        out.push_str("<div class=\"identity\">\n");
        out.push_str(&format!(
            "<img class=\"app-icon\" src=\"{}\" alt=\"\" />\n<div>\n",
            html_escape(icon_url)
        ));
    }
    let display_name = name.unwrap_or(app_id);
    match wordmark_url {
        Some(wordmark_url) => out.push_str(&format!(
            "<img class=\"app-wordmark\" src=\"{}\" alt=\"{}\" />\n",
            html_escape(wordmark_url),
            html_escape(display_name)
        )),
        None if !display_name.is_empty() => {
            out.push_str(&format!("<h1>{}</h1>\n", html_escape(display_name)))
        }
        None => {}
    }
    if let Some(description) = description {
        out.push_str(&format!(
            "<p class=\"desc\">{}</p>\n",
            html_escape(description)
        ));
    }
    if !app_id.is_empty() {
        let sub = if name.is_some()
            || description.is_some()
            || icon_url.is_some()
            || wordmark_url.is_some()
        {
            format!(
                "app id <code>{}</code> &middot; running on Snapback",
                html_escape(app_id)
            )
        } else {
            "running on Snapback".to_owned()
        };
        out.push_str(&format!("<p class=\"sub\">{sub}</p>\n"));
    }
    if icon_url.is_some() {
        out.push_str("</div>\n</div>\n");
    }
    out
}

/// The most important public facts, as a four-column table: two key/value
/// pairs per row, so the list reads as two side-by-side columns instead of one
/// tall one. Everything shown is drawn from the same public `InstanceStatus`
/// the machine formats serve.
fn instance_home_facts(status: &InstanceStatus) -> String {
    let facts: [(&str, String, bool); 10] = [
        ("Uptime", status.server.uptime.clone(), false),
        ("Bind", status.server.bind.clone(), true),
        ("Target", status.target.clone(), true),
        ("Runtime", status.runtime_engine.clone(), true),
        (
            "Storage",
            format!("{} ({})", status.storage.engine, status.storage.mode),
            false,
        ),
        ("Tables", status.counts.loaded_tables.to_string(), false),
        (
            "Functions",
            status.counts.loaded_functions.to_string(),
            false,
        ),
        ("Cron jobs", status.counts.cron_jobs.to_string(), false),
        (
            "Live subscriptions",
            status.counts.live_subscriptions.to_string(),
            false,
        ),
        ("Capabilities", status.capabilities.summary.clone(), false),
    ];
    let cell = |key: &str, value: &str, mono: bool| {
        format!(
            "<th scope=\"row\">{}</th><td{}>{}</td>",
            html_escape(key),
            if mono { " class=\"mono\"" } else { "" },
            html_escape(value)
        )
    };
    let mut out = String::new();
    out.push_str("<table>\n<tbody>\n");
    for pair in facts.chunks(2) {
        out.push_str("<tr>");
        for (key, value, mono) in pair {
            out.push_str(&cell(key, value, *mono));
        }
        if pair.len() == 1 {
            out.push_str("<th scope=\"row\"></th><td></td>");
        }
        out.push_str("</tr>\n");
    }
    // The one sentence-length fact gets the full row width instead of
    // squeezing into a half-width value cell.
    out.push_str(&format!(
        "<tr><th scope=\"row\">Admin access</th><td colspan=\"3\">{}</td></tr>\n",
        html_escape(&status.admin.access)
    ));
    out.push_str("</tbody>\n</table>\n");
    out
}

fn non_empty(value: &Option<String>) -> Option<&str> {
    value.as_deref().filter(|value| !value.trim().is_empty())
}

fn html_escape(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            other => out.push(other),
        }
    }
    out
}

/// Minimal percent-encoding for an SVG `data:` URI (favicon): enough to keep
/// the document valid inside an HTML attribute without a base64 dependency.
fn svg_data_uri(svg: &str) -> String {
    let mut out = String::with_capacity(svg.len() + 24);
    out.push_str("data:image/svg+xml,");
    for ch in svg.chars() {
        match ch {
            '<' => out.push_str("%3C"),
            '>' => out.push_str("%3E"),
            '#' => out.push_str("%23"),
            '%' => out.push_str("%25"),
            '{' => out.push_str("%7B"),
            '}' => out.push_str("%7D"),
            '"' => out.push('\''),
            '\n' => out.push(' '),
            other => out.push(other),
        }
    }
    out
}

fn admin_access_summary(ctx: &ServerContext) -> String {
    match (ctx.loopback, ctx.admin_token.is_some()) {
        (true, false) => {
            "Open on loopback; set SNAPBACK_ADMIN_TOKEN to require a token for writes".to_owned()
        }
        (true, true) => "Reads open on loopback; writes require SNAPBACK_ADMIN_TOKEN".to_owned(),
        (false, false) => {
            "Admin API disabled on this non-loopback bind until SNAPBACK_ADMIN_TOKEN is set"
                .to_owned()
        }
        (false, true) => {
            "Admin API requires SNAPBACK_ADMIN_TOKEN on this non-loopback bind".to_owned()
        }
    }
}

fn format_duration(ms: u64) -> String {
    let seconds = ms / 1000;
    if seconds < 60 {
        format!("{seconds}s")
    } else if seconds < 3600 {
        format!("{}m {}s", seconds / 60, seconds % 60)
    } else {
        format!("{}h {}m", seconds / 3600, (seconds % 3600) / 60)
    }
}

fn yaml_string(value: &str) -> String {
    serde_json::to_string(value).expect("string serialization cannot fail")
}

fn yaml_string_list(values: &[String]) -> String {
    if values.is_empty() {
        "[]".to_owned()
    } else {
        format!(
            "[{}]",
            values
                .iter()
                .map(|value| yaml_string(value))
                .collect::<Vec<_>>()
                .join(", ")
        )
    }
}

/// Backwards-compatible entry point: build the full app with a detached
/// (loopback, address-unknown) server context.
pub fn router(snapback: LocalSnapback) -> Router {
    app(AppState::detached(snapback))
}

/// How long a connection may be idle before the reaper tears it down, and how
/// often the reaper runs. HTTP-polling clients poll well within this window;
/// WS clients are normally reaped on socket close. A WS peer that vanishes
/// without FIN/RST (suspend, cable pull) is covered twice (ENG-23424): the
/// safety-net Ping in `live_stream` errors the socket within the TCP
/// retransmission timeout, and — because an empty server-initiated drain no
/// longer counts as liveness — an idle dead peer also ages past this TTL and
/// is reaped even before the socket error lands.
///
/// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L2.
const CONNECTION_IDLE_TTL_MS: u64 = 120_000;
const MAINTENANCE_INTERVAL_MS: u64 = 30_000;
// @ref LLP 0032 L3 / LLP 0008 §Retention — keep the last N commit versions and
// anything newer than the time window; prune the rest.
const JOURNAL_RETAIN_VERSIONS: u64 = 10_000;
const JOURNAL_RETAIN_MS: u64 = 24 * 60 * 60 * 1_000;

/// Periodic lifecycle maintenance: reap connections idle past the TTL (L2) so an
/// abandoned HTTP-polling client's subscriptions and ephemeral state do not live
/// forever, prune the change journal to its retention window (L3) so it does
/// not grow without bound, and prune expired ephemeral entries through the
/// expiry index (L9) — the index makes this cheap, and it never takes the
/// global mutex.
///
/// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L2, L3, L9.
pub fn spawn_maintenance_worker(state: SharedSnapback, ephemeral: EphemeralApi) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut ticks = interval(Duration::from_millis(MAINTENANCE_INTERVAL_MS));
        loop {
            ticks.tick().await;
            let now = now_millis();
            // Room-authority TTL sweep: index-driven, off the global mutex
            // (server-side remove deltas are best effort — clients also prune
            // by TTL, LLP 0013 §TTL and leases).
            ephemeral.cleanup_expired(now);
            // The journal prune is rusqlite work — off the async worker (L7).
            with_snapback(&state, move |snapback| {
                snapback.reap_stale_connections(now, CONNECTION_IDLE_TTL_MS);
                // Best-effort; a transient prune error is retried next tick.
                let _ =
                    snapback.prune_change_journal(now, JOURNAL_RETAIN_VERSIONS, JOURNAL_RETAIN_MS);
            })
            .await;
        }
    })
}

pub fn spawn_cron_scheduler(state: SharedSnapback) -> JoinHandle<()> {
    tokio::spawn(async move {
        // Clone the activity flag once, then poll it lock-free. When no cron
        // jobs are loaded the tick takes the global lock zero times — idle
        // means idle.
        //
        // @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L5.
        let cron_active = state.lock().await.cron_activity_flag();
        let mut ticks = interval(Duration::from_secs(1));
        loop {
            ticks.tick().await;
            if !cron_active.load(std::sync::atomic::Ordering::Relaxed) {
                continue;
            }
            // A due tick persists cron state and may run actions (Hermes) —
            // off the async worker (L7).
            let now = now_millis();
            with_snapback(&state, move |snapback| {
                snapback.tick_cron_recording(now);
            })
            .await;
        }
    })
}

async fn local_dev_cors(request: Request<Body>, next: Next) -> Response {
    // @ref LLP 0025#demo-shape — web-only demos may be served by an ordinary
    // static/Vite origin while talking to the local Snapback server.
    let allowed_origin = loopback_origin(request.headers().get(header::ORIGIN));
    if request.method() == Method::OPTIONS {
        return with_cors_headers(StatusCode::NO_CONTENT.into_response(), allowed_origin);
    }
    with_cors_headers(next.run(request).await, allowed_origin)
}

fn with_cors_headers(mut response: Response, allowed_origin: Option<HeaderValue>) -> Response {
    let headers = response.headers_mut();
    if let Some(origin) = allowed_origin {
        headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin);
        headers.insert(header::VARY, HeaderValue::from_static("Origin"));
    }
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, POST, OPTIONS"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("content-type, authorization, x-snapback-admin-token"),
    );
    response
}

fn loopback_origin(origin: Option<&HeaderValue>) -> Option<HeaderValue> {
    let origin = origin?.to_str().ok()?;
    let allowed = [
        "http://127.0.0.1:",
        "https://127.0.0.1:",
        "http://localhost:",
        "https://localhost:",
        "http://[::1]:",
        "https://[::1]:",
    ];
    allowed
        .iter()
        .any(|prefix| origin.starts_with(prefix))
        .then(|| HeaderValue::from_str(origin).ok())
        .flatten()
}

/// `/health` prefers the lock-free read lane (a busy write must not make the
/// instance look down); in-memory instances fall back to the write lane.
///
/// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L6.
async fn health(
    State(state): State<SharedSnapback>,
    State(read): State<crate::local::ReadLane>,
) -> Result<Json<HealthResponse>, ApiError> {
    let (version, capabilities) = if read.available() {
        let health = with_read_lane(&read, |lane| lane.health()).await?;
        (health.version, health.capabilities)
    } else {
        let inspect = with_snapback(&state, |snapback| snapback.inspect()).await?;
        (inspect.storage.version, inspect.runtime)
    };
    Ok(Json(HealthResponse {
        ok: true,
        target: crate::manifest::TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX.to_owned(),
        sqlite_version: version,
        ibex_available: capabilities.ibex_cli.available
            || capabilities.ibex_ctx_db_host_bridge == CapabilityState::Available,
        binary: crate::identity::binary_identity(),
    }))
}

/// Public `/inspect` — the trimmed identity descriptor. Operational and posture
/// facts (connection ids, the on-disk DB path) live only in the gated
/// `/_snapback/api/inspect` twin.
///
/// @ref LLP 0031#resolved-decisions — D3: the public payload is a typed projection of `InspectState`.
async fn inspect(
    State(state): State<SharedSnapback>,
) -> Result<Json<crate::local::PublicInspect>, ApiError> {
    let inspect = with_snapback(&state, |snapback| snapback.inspect()).await?;
    Ok(Json(inspect.into()))
}

/// The v0 admin aliases perform system writes, so they share the
/// `/_snapback/*` write gate until LLP 0031's gated twins land and these
/// aliases retire.
///
/// @ref LLP 0032#phase-1--safety-floor-and-confirmed-defects — S0: the root
/// admin aliases fail closed like their `/_snapback/*` twins on every bind.
async fn apply_schema(
    State(state): State<SharedSnapback>,
    State(ctx): State<Arc<ServerContext>>,
    headers: HeaderMap,
    Json(manifest): Json<SchemaManifest>,
) -> Result<Json<DiagnosticsResponse>, ApiError> {
    crate::admin::authorize(&ctx, &headers, true)?;
    crate::admin::require_non_prod_profile(&ctx, "schema.load")?;
    let diagnostics =
        with_snapback(&state, move |snapback| snapback.apply_schema(manifest)).await?;
    Ok(Json(DiagnosticsResponse { diagnostics }))
}

async fn load_functions(
    State(state): State<SharedSnapback>,
    State(ctx): State<Arc<ServerContext>>,
    headers: HeaderMap,
    Json(manifest): Json<FunctionManifest>,
) -> Result<Json<DiagnosticsResponse>, ApiError> {
    crate::admin::authorize(&ctx, &headers, true)?;
    crate::admin::require_non_prod_profile(&ctx, "functions.load")?;
    let diagnostics =
        with_snapback(&state, move |snapback| snapback.load_functions(manifest)).await;
    // @ref LLP 0036#the-setup-wizard-d3 — the printed line is the install
    // instruction: a manifest that declares required config the store cannot
    // satisfy points the operator straight at the wizard.
    let missing = with_snapback(&state, |snapback| snapback.required_missing_config()).await;
    if !missing.is_empty() {
        println!(
            "config: {} required entr{} missing ({}) → http://{}:{}/_snapback/admin/setup",
            missing.len(),
            if missing.len() == 1 { "y" } else { "ies" },
            missing.join(", "),
            ctx.host,
            ctx.port,
        );
    }
    Ok(Json(DiagnosticsResponse { diagnostics }))
}

/// `config.status` — the LLP 0036 status primitive: declared × set ×
/// verified × applied, names and states only. Read-gated like inspect.
async fn config_status(
    State(state): State<SharedSnapback>,
    State(ctx): State<Arc<ServerContext>>,
    headers: HeaderMap,
) -> Result<Json<crate::local::ConfigStatus>, ApiError> {
    crate::admin::authorize(&ctx, &headers, false)?;
    let status = with_snapback(&state, |snapback| snapback.config_status()).await;
    Ok(Json(status))
}

#[derive(Debug, Default, Deserialize)]
struct ConfigPlanQuery {
    #[serde(default)]
    entry: Option<String>,
}

/// `config.plan` — dry-run facts: write locus, apply boundary, and whether
/// this transport would accept a value write. Nearly free locally; pins the
/// contract hosted targets need.
async fn config_plan(
    State(state): State<SharedSnapback>,
    State(ctx): State<Arc<ServerContext>>,
    headers: HeaderMap,
    Query(query): Query<ConfigPlanQuery>,
) -> Result<Json<crate::local::ConfigPlan>, ApiError> {
    crate::admin::authorize(&ctx, &headers, false)?;
    let value_writes_accepted = ctx.loopback;
    let plan = with_snapback(&state, move |snapback| {
        snapback.config_plan(query.entry.as_deref(), value_writes_accepted)
    })
    .await?;
    Ok(Json(plan))
}

#[derive(Debug, Deserialize)]
struct ConfigSetBody {
    entry: String,
    #[serde(default)]
    value: Option<String>,
    #[serde(default)]
    values: Option<Vec<String>>,
    #[serde(default)]
    append: bool,
    #[serde(default)]
    source: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ConfigEntryBody {
    entry: String,
    #[serde(default)]
    source: Option<String>,
}

/// The audited write sources (LLP 0036 §Operations and projections). Anything
/// unrecognized is recorded as plain `http`.
fn sanitize_config_source(source: Option<String>) -> String {
    match source.as_deref() {
        Some(source @ ("wizard" | "cli" | "mcp" | "agent" | "http")) => source.to_owned(),
        _ => "http".to_owned(),
    }
}

/// @ref LLP 0036#the-store-and-the-target-seam-d1-d2-d7 — the transit rule:
/// value-carrying writes are accepted only over loopback or TLS, and this
/// local server terminates no TLS, so a non-loopback bind refuses them. An
/// SSH tunnel (loopback at the server) is the blessed remote path.
fn require_value_write_transport(ctx: &ServerContext) -> Result<(), ApiError> {
    if ctx.loopback {
        return Ok(());
    }
    Err(SnapbackError::error(
        "SNAPBACK_CONFIG_TRANSIT_RULE",
        "config",
        "value-carrying config writes are accepted only over loopback or TLS; this bind is \
         non-loopback plaintext — use an SSH tunnel to the instance instead",
    )
    .into())
}

/// `config.set` — set a declared entry or add a pool member. Values never
/// appear in the response, the diagnostics ring, or any log line.
async fn config_set(
    State(state): State<SharedSnapback>,
    State(ctx): State<Arc<ServerContext>>,
    headers: HeaderMap,
    Json(body): Json<ConfigSetBody>,
) -> Result<Json<crate::local::ConfigWriteOutcome>, ApiError> {
    crate::admin::authorize(&ctx, &headers, true)?;
    require_value_write_transport(&ctx)?;
    let values = match (body.value, body.values) {
        (Some(value), None) => vec![value],
        (None, Some(values)) => values,
        _ => {
            return Err(SnapbackError::error(
                "SNAPBACK_CONFIG_VALUE_INVALID",
                "config",
                "provide exactly one of value or values",
            )
            .into());
        }
    };
    let entry = body.entry;
    let append = body.append;
    let source = sanitize_config_source(body.source);
    let outcome = with_snapback(&state, move |snapback| {
        snapback.set_config_entry(&entry, values, append, &source)
    })
    .await?;
    Ok(Json(outcome))
}

/// `config.unset` — remove an entry's stored value. Carries no value, so the
/// transit rule does not apply; the admin write gate does.
async fn config_unset(
    State(state): State<SharedSnapback>,
    State(ctx): State<Arc<ServerContext>>,
    headers: HeaderMap,
    Json(body): Json<ConfigEntryBody>,
) -> Result<Json<crate::local::ConfigWriteOutcome>, ApiError> {
    crate::admin::authorize(&ctx, &headers, true)?;
    let entry = body.entry;
    let source = sanitize_config_source(body.source);
    let outcome = with_snapback(&state, move |snapback| {
        snapback.unset_config_entry(&entry, &source)
    })
    .await?;
    Ok(Json(outcome))
}

/// `config.verify` — run the entry's probe action under the cooldown.
async fn config_verify(
    State(state): State<SharedSnapback>,
    State(ctx): State<Arc<ServerContext>>,
    headers: HeaderMap,
    Json(body): Json<ConfigEntryBody>,
) -> Result<Json<crate::local::ConfigVerifyOutcome>, ApiError> {
    crate::admin::authorize(&ctx, &headers, true)?;
    let entry = body.entry;
    let outcome =
        with_snapback(&state, move |snapback| snapback.verify_config_entry(&entry)).await?;
    Ok(Json(outcome))
}

/// The host-ops operation endpoint (LLP 0032 P6): every served operation goes
/// through one gate and returns one `hostOpsResult` envelope. Transport is a
/// projection — HTTP is always 200 once an envelope exists; `ok` and
/// `diagnostics[]` carry the outcome (LLP 0024 §Result Envelope).
async fn host_ops_handler(
    State(state): State<SharedSnapback>,
    State(ctx): State<Arc<ServerContext>>,
    headers: HeaderMap,
    Json(request): Json<crate::host_ops::HostOpsRequest>,
) -> Result<Json<crate::host_ops::HostOpsResult>, ApiError> {
    crate::admin::authorize(&ctx, &headers, true)?;
    let server_url = Some(format!("http://{}:{}", ctx.host, ctx.port));
    let result = with_snapback(&state, move |snapback| {
        crate::host_ops::execute_host_op(snapback, request, server_url)
    })
    .await;
    Ok(Json(result))
}

/// `app.reset` — the gated system write that resets the instance and, per
/// LLP 0024/LLP 0031 D5, optionally seeds it in the same call. Seed is folded
/// in here rather than living as a standalone route, so an empty body resets
/// and `{ "seed": … }` resets-then-seeds.
///
/// @ref LLP 0031#resolved-decisions — D5: seed is an optional argument to `app.reset`, not a fourth route.
async fn app_reset(
    State(state): State<SharedSnapback>,
    State(ctx): State<Arc<ServerContext>>,
    headers: HeaderMap,
    body: Option<Json<AppResetBody>>,
) -> Result<Json<AppResetResponse>, ApiError> {
    crate::admin::authorize(&ctx, &headers, true)?;
    crate::admin::require_non_prod_profile(&ctx, "app.reset")?;
    let seed = body.and_then(|Json(body)| body.seed);
    let seeded = with_snapback(
        &state,
        move |snapback| -> Result<_, crate::diagnostic::SnapbackError> {
            snapback.reset()?;
            match seed {
                Some(seed) => Ok(Some(snapback.seed(seed)?)),
                None => Ok(None),
            }
        },
    )
    .await?;
    Ok(Json(AppResetResponse { seeded }))
}

#[derive(Debug, Default, Deserialize)]
struct AppResetBody {
    #[serde(default)]
    seed: Option<SeedData>,
}

#[derive(Debug, Serialize)]
struct AppResetResponse {
    seeded: Option<crate::manifest::MutationOutput>,
}

/// `/query/{name}` runs on the lock-free read lane when the instance is
/// file-backed: a pooled WAL reader inside a pinned read transaction, so
/// queries proceed during long writes. In-memory instances (no WAL) keep the
/// serialized write-lane path.
///
/// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L6.
async fn invoke_query(
    State(state): State<SharedSnapback>,
    State(read): State<crate::local::ReadLane>,
    Path(name): Path<String>,
    Json(input): Json<HandlerInput>,
) -> Result<Json<crate::manifest::QueryOutput>, ApiError> {
    let output = if read.available() {
        with_read_lane(&read, move |lane| lane.invoke_query(&name, input)).await?
    } else {
        with_snapback(&state, move |snapback| snapback.invoke_query(&name, input)).await?
    };
    Ok(Json(output))
}

/// Mutations respond with the MutationOutput fields plus the provider-core
/// MutationReceipt (LLP 0034 §3.2, ENG-22478) — additive, so pre-receipt
/// clients are unaffected. A REJECTED mutation still produces a receipt; it
/// rides the error envelope.
async fn invoke_mutation(
    State(state): State<SharedSnapback>,
    Path(name): Path<String>,
    Json(input): Json<HandlerInput>,
) -> Result<Json<Value>, ApiError> {
    // Receipt emission rides the L7 blocking offload: the recording call
    // (Hermes eval + rusqlite) runs via with_snapback, and the envelope is
    // assembled from its (result, receipt) pair back on the async side.
    let (result, receipt) = with_snapback(&state, move |snapback| {
        snapback.invoke_mutation_recording(&name, input)
    })
    .await;
    match result {
        Ok(output) => {
            let mut body = serde_json::to_value(&output)
                .unwrap_or_else(|_| json!({ "changed_count": output.changed_count }));
            if let Some(object) = body.as_object_mut() {
                object.insert("receipt".to_owned(), receipt);
            }
            Ok(Json(body))
        }
        Err(error) => Err(ApiError::with_receipt(error, receipt)),
    }
}

/// App-data action runner for side-effectful app work that is not a transaction:
/// browser clients can trigger action egress without reaching through the admin
/// function runner, while writes still happen only through declared mutations.
///
/// @ref LLP 0031#the-invariant — app-data routes live at the root.
/// @ref LLP 0028#open-questions — per-request app actions
/// include the All Aboard walk/bike routing call, not just cron jobs.
async fn invoke_action(
    State(state): State<SharedSnapback>,
    Path(name): Path<String>,
    Json(input): Json<HandlerInput>,
) -> Result<Json<crate::local::FunctionRunResult>, ApiError> {
    let result = with_snapback(&state, move |snapback| {
        snapback.run_app_action(&name, input)
    })
    .await;
    Ok(Json(result))
}

/// The mount-lifecycle ensure-everything operation (LLP 0034 §5 / ENG-22527):
/// app-data at the root like the ephemeral ensure it generalizes — idempotent
/// and non-destructive by construction; the PROVISIONING half is gated by the
/// server profile (prod inspects and reports 'gated' instead of writing).
async fn ensure_app(
    State(state): State<SharedSnapback>,
    State(ctx): State<Arc<ServerContext>>,
    Json(input): Json<crate::local::EnsureAppInput>,
) -> Result<Json<crate::local::EnsureAppOutcome>, ApiError> {
    let provisioning_allowed = ctx.profile.allows_provisioning();
    let profile = ctx.profile.as_str().to_owned();
    let outcome = with_snapback(&state, move |snapback| {
        snapback.ensure_app(input, provisioning_allowed, &profile)
    })
    .await?;
    Ok(Json(outcome))
}

async fn subscribe_live(
    State(state): State<SharedSnapback>,
    Path(name): Path<String>,
    Json(input): Json<LiveSubscribeInput>,
) -> Result<Json<crate::local::LiveSubscribeOutput>, ApiError> {
    let output = with_snapback(&state, move |snapback| {
        snapback.subscribe_live(&name, input)
    })
    .await?;
    Ok(Json(output))
}

async fn resume_live(
    State(state): State<SharedSnapback>,
    Path(name): Path<String>,
    Json(input): Json<LiveResumeInput>,
) -> Result<Json<crate::local::LiveResumeOutput>, ApiError> {
    let output = with_snapback(&state, move |snapback| snapback.resume_live(&name, input)).await?;
    Ok(Json(output))
}

async fn unsubscribe_live(
    State(state): State<SharedSnapback>,
    Path(name): Path<String>,
    Json(input): Json<LiveUnsubscribeInput>,
) -> Result<Json<crate::local::LiveUnsubscribeOutput>, ApiError> {
    // L7 offload: disposal reads the storage version (rusqlite) for its
    // receipt, so it runs on the blocking lane like every other write path.
    let output = with_snapback(&state, move |snapback| {
        snapback.unsubscribe_live(&name, input)
    })
    .await?;
    Ok(Json(output))
}

async fn stream_live(
    State(state): State<SharedSnapback>,
    State(ephemeral): State<EphemeralApi>,
    Path(connection_id): Path<String>,
    ws: WebSocketUpgrade,
) -> Response {
    ws.on_upgrade(move |socket| live_stream(socket, state, ephemeral, connection_id))
}

async fn live_stream(
    socket: WebSocket,
    state: SharedSnapback,
    ephemeral: EphemeralApi,
    connection_id: String,
) {
    let (mut sender, mut receiver) = socket.split();
    // @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L8: an enqueue
    // wakes this task immediately (sub-poll-interval delivery, and no periodic
    // lock traffic while idle). The long interval is a safety net only, in case
    // a wake is ever missed; register before draining so no push is lost.
    let notify = ephemeral.delivery_notifier();
    let (generation, waker) = notify.register(&connection_id);
    // Delivery is event-driven (the 25ms poll is gone); this heartbeat is only a
    // defensive fallback if a wake is ever missed. At 30s it is ~1200× less lock
    // traffic than the old poll, so an idle connection is effectively idle.
    let mut safety_net = interval(Duration::from_secs(30));
    safety_net.tick().await; // consume the immediate first tick

    // Flush anything enqueued before (or racing) registration, then rely on
    // wakeups. Enqueues are no longer serialized by the global mutex (L9);
    // the no-lost-wakeup argument is push-before-wake at every enqueue site
    // plus this register-before-first-drain: a push the drain below misses
    // happened after the drain took the outbox lock, and its wake then finds
    // the already-registered waker and stores a permit.
    if drain_and_send(&ephemeral, &connection_id, &mut sender)
        .await
        .is_break()
    {
        teardown_live_stream(&state, &notify, &connection_id, generation).await;
        return;
    }

    // @ref LLP 0020#phase-4-upgrade-realtime-from-v0-outbox-to-app-grade-live-delivery — WebSocket push is a transport over the existing ordered live queue; deterministic drain stays available for tests.
    'stream: loop {
        let drain = tokio::select! {
            incoming = receiver.next() => {
                match incoming {
                    Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                    Some(Ok(Message::Text(text))) => {
                        let response = handle_live_socket_text(&ephemeral, &connection_id, &text);
                        if sender.send(Message::Text(response.into())).await.is_err() {
                            break 'stream;
                        }
                        false
                    }
                    // A protocol Ping/Pong from the peer is client-initiated
                    // liveness for the L2 reaper (ENG-23424) — most
                    // importantly the Pong answering the safety-net Ping
                    // below, which every conforming peer sends even when the
                    // app is otherwise idle. (Ephemeral text ops touch
                    // activity through their EphemeralApi calls; `live_ping`
                    // stays deliberately stateless.)
                    Some(Ok(Message::Ping(_))) | Some(Ok(Message::Pong(_))) => {
                        ephemeral.touch_connection(&connection_id);
                        false
                    }
                    Some(Ok(Message::Binary(_))) => false,
                }
            }
            _ = waker.notified() => true,
            _ = safety_net.tick() => {
                // ENG-23424: probe the peer, don't just drain. A peer that
                // vanished without FIN/RST (suspend, cable pull) never errors
                // on an *empty* drain — no bytes are written — so without this
                // Ping the task would live forever. The Ping forces socket
                // I/O every 30s: a dead peer surfaces a send error within the
                // TCP retransmission timeout, and a live one answers with a
                // Pong that refreshes its activity above.
                if sender.send(Message::Ping(Vec::new().into())).await.is_err() {
                    break 'stream;
                }
                true
            }
        };
        if drain
            && drain_and_send(&ephemeral, &connection_id, &mut sender)
                .await
                .is_break()
        {
            break 'stream;
        }
    }

    teardown_live_stream(&state, &notify, &connection_id, generation).await;
}

/// Generation-guarded stream teardown (LLP 0034 review fix 1): a task tears a
/// connection down ONLY while its registration still owns the connection. A
/// reconnect reuses the connection id — the new socket's `register` supersedes
/// this task's generation — and a half-open old socket can die arbitrarily
/// late; without the guard its teardown would remove the NEW socket's waker
/// and destroy the NEW subscriptions while the new socket keeps answering
/// pings (permanent silent staleness reported as 'live').
async fn teardown_live_stream(
    state: &SharedSnapback,
    notify: &crate::ephemeral::DeliveryNotifier,
    connection_id: &str,
    generation: u64,
) {
    if !notify.unregister(connection_id, generation) {
        return;
    }
    let mut snapback = state.lock().await;
    snapback.disconnect(connection_id, now_millis());
}

/// Drain a connection's outbox and send each message. The drain reaches the
/// room authority's per-connection queue directly — no global mutex (L9).
/// Returns `Break` if the socket send failed (the caller should tear down).
async fn drain_and_send(
    ephemeral: &EphemeralApi,
    connection_id: &str,
    sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
) -> std::ops::ControlFlow<()> {
    let messages = ephemeral.drain_live_stream(connection_id);
    for message in messages {
        if sender.send(Message::Text(message.into())).await.is_err() {
            return std::ops::ControlFlow::Break(());
        }
    }
    std::ops::ControlFlow::Continue(())
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum LiveSocketClientMessage {
    EphemeralSubscribe {
        #[serde(default, rename = "requestId", alias = "request_id")]
        request_id: Option<String>,
        request: SubscribeRequest,
    },
    EphemeralPublish {
        #[serde(default, rename = "requestId", alias = "request_id")]
        request_id: Option<String>,
        request: PublishRequest,
    },
    EphemeralDelete {
        #[serde(default, rename = "requestId", alias = "request_id")]
        request_id: Option<String>,
        request: DeleteRequest,
    },
    /// Stop observing a room (ENG-22527 item 3 / SECURITY). Carried over the
    /// shared live socket rather than a public HTTP route so the socket's
    /// connection identity (checked by the `frame_connection != connection_id`
    /// gate below) binds the requester: a participant cannot evict another
    /// connection's subscription by asserting its id. Published entries are
    /// untouched; the disposal is acked with a receipt.
    EphemeralUnsubscribe {
        #[serde(default, rename = "requestId", alias = "request_id")]
        request_id: Option<String>,
        request: SubscribeRequest,
    },
    /// Application-level liveness probe (LLP 0034 D1, Exact LLP 0284 §2.2).
    /// An idle-healthy socket otherwise sends nothing (the 25ms tick writes
    /// only when the outbox has messages) and browser/Node `WebSocket` clients
    /// cannot send protocol-level Ping frames, so without this a client cannot
    /// distinguish `live` from a dead socket until TCP timeout. Stateless: no
    /// connection state is read or touched.
    Ping {
        #[serde(default, rename = "requestId", alias = "request_id")]
        request_id: Option<String>,
    },
}

/// The serde tag each live-socket message is classified under. This exhaustive
/// match is the forcing function for LLP 0031's WebSocket rule: a new
/// `LiveSocketClientMessage` variant fails to compile here until it is named,
/// and the enforcement test asserts every name is a registered **app-data**
/// operation — so a system-authority message kind cannot be smuggled onto the
/// app-data `/live/*` socket.
///
/// @ref LLP 0031#enforcement — enumerate the accepted socket variants; fail if any is not app-data.
#[cfg(test)]
fn live_socket_operation_name(message: &LiveSocketClientMessage) -> &'static str {
    match message {
        LiveSocketClientMessage::EphemeralSubscribe { .. } => "ephemeral_subscribe",
        LiveSocketClientMessage::EphemeralPublish { .. } => "ephemeral_publish",
        LiveSocketClientMessage::EphemeralDelete { .. } => "ephemeral_delete",
        LiveSocketClientMessage::EphemeralUnsubscribe { .. } => "ephemeral_unsubscribe",
        LiveSocketClientMessage::Ping { .. } => "live_ping",
    }
}

/// Handle a socket-text operation. Ephemeral operations reach the room
/// authority directly — a busy mutation holding the global write mutex cannot
/// delay a cursor publish on this socket (LLP 0032 L9).
fn handle_live_socket_text(ephemeral: &EphemeralApi, connection_id: &str, text: &str) -> String {
    let message = match serde_json::from_str::<LiveSocketClientMessage>(text) {
        Ok(message) => message,
        Err(error) => {
            return socket_error(
                None,
                "decode",
                Diagnostic::error(
                    "SNAPBACK_WEBSOCKET_MESSAGE_INVALID",
                    "realtime",
                    "WebSocket message could not be decoded",
                )
                .with_details(json!({ "error": error.to_string() })),
            );
        }
    };

    // Liveness probe: answered immediately and statelessly (no lock, no
    // connection binding to check — the probe carries no connection_id and
    // performs no operation on connection state).
    if let LiveSocketClientMessage::Ping { request_id } = &message {
        return socket_pong(request_id.clone());
    }

    // @ref LLP 0032#phase-1--safety-floor-and-confirmed-defects — S3: a socket
    // may only speak for its own connection; the client-chosen connection_id
    // inside a frame is bound to the socket identity, never trusted.
    let (frame_request_id, frame_operation, frame_connection) = match &message {
        LiveSocketClientMessage::EphemeralSubscribe {
            request_id,
            request,
        } => (request_id.clone(), "subscribe", &request.connection_id),
        LiveSocketClientMessage::EphemeralPublish {
            request_id,
            request,
        } => (request_id.clone(), "publish", &request.connection_id),
        LiveSocketClientMessage::EphemeralDelete {
            request_id,
            request,
        } => (request_id.clone(), "delete", &request.connection_id),
        LiveSocketClientMessage::EphemeralUnsubscribe {
            request_id,
            request,
        } => (request_id.clone(), "unsubscribe", &request.connection_id),
        LiveSocketClientMessage::Ping { .. } => unreachable!("handled above"),
    };
    if frame_connection != connection_id {
        return socket_error(
            frame_request_id,
            frame_operation,
            Diagnostic::error(
                "SNAPBACK_WEBSOCKET_SENDER_MISMATCH",
                "realtime",
                "message connection_id does not match this socket's connection",
            )
            .with_details(json!({
                "socket_connection_id": connection_id,
                "message_connection_id": frame_connection,
            })),
        );
    }

    match message {
        LiveSocketClientMessage::EphemeralSubscribe {
            request_id,
            request,
        } => match ephemeral.subscribe(request, now_millis()) {
            Ok(message) => socket_ack(request_id, "subscribe", json!({ "message": message })),
            Err(error) => socket_error(request_id, "subscribe", diagnostic_from_ephemeral(error)),
        },
        LiveSocketClientMessage::EphemeralPublish {
            request_id,
            request,
        } => match ephemeral.publish(request, now_millis()) {
            Ok(outcome) => socket_ack(request_id, "publish", json!({ "outcome": outcome })),
            Err(error) => socket_error(request_id, "publish", diagnostic_from_ephemeral(error)),
        },
        LiveSocketClientMessage::EphemeralDelete {
            request_id,
            request,
        } => match ephemeral.delete(request, now_millis()) {
            Ok(message) => socket_ack(request_id, "delete", json!({ "message": message })),
            Err(error) => socket_error(request_id, "delete", diagnostic_from_ephemeral(error)),
        },
        LiveSocketClientMessage::EphemeralUnsubscribe {
            request_id,
            request,
        } => {
            let receipt_scope = request.scope.clone();
            let collection = request.collection.clone();
            match ephemeral.unsubscribe(request, now_millis()) {
                Ok(removed) => {
                    let receipt = ephemeral_unsubscribe_receipt(
                        &collection,
                        &receipt_scope,
                        removed,
                        now_millis(),
                    );
                    socket_ack(
                        request_id,
                        "unsubscribe",
                        json!({ "removed": removed, "receipt": receipt }),
                    )
                }
                Err(error) => {
                    socket_error(request_id, "unsubscribe", diagnostic_from_ephemeral(error))
                }
            }
        }
        LiveSocketClientMessage::Ping { .. } => unreachable!("handled above"),
    }
}

/// The disposal receipt for an ephemeral unsubscribe (ENG-22527 item 3). Shape
/// matches the durable subscription-disposal receipts (kind `subscription`,
/// lane `ephemeral`): the kit records it client-side so an idle-linger
/// teardown is observable. Privacy (§3.3): opaque ids, scope, and a boolean —
/// never a payload value.
fn ephemeral_unsubscribe_receipt(
    collection: &str,
    scope: &Scope,
    removed: bool,
    now_ms: u64,
) -> Value {
    json!({
        "kind": "subscription",
        "lane": "ephemeral",
        "bindingId": collection,
        "collection": collection,
        "event": "disposed",
        "reason": "unsubscribed",
        "removed": removed,
        "scope": scope,
        "receivedAtMs": now_ms,
    })
}

/// The `live_ping` response envelope. `serverTimeMs` lets a client measure
/// round-trip freshness against its heartbeat budget (LLP 0034 §2.2: `live` =
/// heartbeat within budget; `stale` = budget missed while retrying).
fn socket_pong(request_id: Option<String>) -> String {
    serde_json::to_string(&json!({
        "kind": "pong",
        "requestId": request_id,
        "serverTimeMs": now_millis(),
    }))
    .unwrap_or_else(|_| "{\"kind\":\"pong\"}".to_owned())
}

fn socket_ack(request_id: Option<String>, operation: &str, mut body: Value) -> String {
    let mut envelope = json!({
        "kind": "ephemeral_ack",
        "requestId": request_id,
        "operation": operation,
    });
    merge_json_object(&mut envelope, body.take());
    serde_json::to_string(&envelope)
        .unwrap_or_else(|_| "{\"kind\":\"ephemeral_error\",\"operation\":\"serialize\"}".to_owned())
}

fn socket_error(request_id: Option<String>, operation: &str, diagnostic: Diagnostic) -> String {
    serde_json::to_string(&json!({
        "kind": "ephemeral_error",
        "requestId": request_id,
        "operation": operation,
        "diagnostic": diagnostic,
    }))
    .unwrap_or_else(|_| "{\"kind\":\"ephemeral_error\",\"operation\":\"serialize\"}".to_owned())
}

fn merge_json_object(target: &mut Value, source: Value) {
    let (Some(target), Some(source)) = (target.as_object_mut(), source.as_object()) else {
        return;
    };
    for (key, value) in source {
        target.insert(key.clone(), value.clone());
    }
}

/// Outbox drain reaches the room authority directly — no global mutex (L9).
async fn drain_outbox(
    State(ephemeral): State<EphemeralApi>,
    Path(connection_id): Path<String>,
) -> Json<Vec<crate::ephemeral::RealtimeEnvelope>> {
    Json(ephemeral.drain_outbox(&connection_id))
}

#[derive(Debug, Deserialize)]
struct EnsureEphemeralCollectionsInput {
    #[serde(default)]
    collections: Vec<EphemeralCollection>,
    #[serde(
        default,
        rename = "ephemeralCollections",
        alias = "ephemeral_collections"
    )]
    ephemeral_collections: Vec<EphemeralCollection>,
}

impl EnsureEphemeralCollectionsInput {
    fn into_collections(self) -> Vec<EphemeralCollection> {
        if self.collections.is_empty() {
            self.ephemeral_collections
        } else {
            self.collections
        }
    }
}

/// The ephemeral endpoints reach the sharded room authority directly: no
/// global mutex, so a busy mutation on the write lane cannot delay presence
/// (LLP 0013 §Delivery lanes; LLP 0032 L9). They are pure memory operations —
/// no Hermes, no SQLite — so they run inline on async workers by design (the
/// L7 exec guard's blocking classes do not apply).
async fn ensure_ephemeral_collections(
    State(ephemeral): State<EphemeralApi>,
    Json(input): Json<EnsureEphemeralCollectionsInput>,
) -> Result<Json<crate::ephemeral::CollectionEnsureOutcome>, ApiError> {
    ephemeral
        .ensure_collections(input.into_collections())
        .map(Json)
        .map_err(ApiError::from_ephemeral)
}

async fn publish_ephemeral(
    State(ephemeral): State<EphemeralApi>,
    Json(request): Json<PublishRequest>,
) -> Result<Json<crate::ephemeral::PublishOutcome>, ApiError> {
    ephemeral
        .publish(request, now_millis())
        .map(Json)
        .map_err(ApiError::from_ephemeral)
}

async fn subscribe_ephemeral(
    State(ephemeral): State<EphemeralApi>,
    Json(request): Json<SubscribeRequest>,
) -> Result<Json<crate::ephemeral::EphemeralMessage>, ApiError> {
    ephemeral
        .subscribe(request, now_millis())
        .map(Json)
        .map_err(ApiError::from_ephemeral)
}

async fn delete_ephemeral(
    State(ephemeral): State<EphemeralApi>,
    Json(request): Json<DeleteRequest>,
) -> Result<Json<Option<crate::ephemeral::EphemeralMessage>>, ApiError> {
    ephemeral
        .delete(request, now_millis())
        .map(Json)
        .map_err(ApiError::from_ephemeral)
}

/// Connection teardown is instance control (it tears down the connection *and*
/// its durable subscriptions), so it is a gated system write under
/// `/_snapback/api/*`, not a root app route.
///
/// @ref LLP 0031#resolved-decisions — D2: `/connections/{id}/disconnect` is system/control.
async fn disconnect(
    State(state): State<SharedSnapback>,
    State(ctx): State<Arc<ServerContext>>,
    headers: HeaderMap,
    Path(connection_id): Path<String>,
) -> Result<StatusCode, ApiError> {
    crate::admin::authorize(&ctx, &headers, true)?;
    let mut snapback = state.lock().await;
    snapback.disconnect(&connection_id, now_millis());
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug)]
pub struct ApiError(SnapbackError, Option<Value>);

impl ApiError {
    fn from_ephemeral(error: crate::ephemeral::EphemeralError) -> Self {
        Self(SnapbackError::new(diagnostic_from_ephemeral(error)), None)
    }

    /// Attach a receipt to an error response (a REJECTED mutation still
    /// produces its receipt — LLP 0034 §3.2, ENG-22478).
    fn with_receipt(error: SnapbackError, receipt: Value) -> Self {
        Self(error, Some(receipt))
    }
}

fn diagnostic_from_ephemeral(error: crate::ephemeral::EphemeralError) -> Diagnostic {
    let mut diagnostic =
        Diagnostic::error(error.code.diagnostic_code(), "ephemeral", error.message);
    diagnostic.details = json!({ "code": error.code });
    diagnostic
}

impl From<SnapbackError> for ApiError {
    fn from(value: SnapbackError) -> Self {
        Self(value, None)
    }
}

/// Map a diagnostic code to an HTTP status.
///
/// @ref LLP 0032#phase-1--safety-floor-and-confirmed-defects — S5.D10: an
/// internal-error class (5xx) so a client or agent can tell "you erred" (4xx)
/// from "the server erred" (5xx); unrecognized failures default to 400, but
/// storage-layer and explicitly-internal faults are 500.
fn status_for_diagnostic_code(code: &str) -> StatusCode {
    match code {
        "SNAPBACK_UNKNOWN_FUNCTION" | "SNAPBACK_UNKNOWN_TABLE" | "SNAPBACK_UNKNOWN_FIELD" => {
            StatusCode::NOT_FOUND
        }
        "SNAPBACK_UNKNOWN_CRON_JOB" | "SNAPBACK_UNKNOWN_SUBSCRIPTION" => StatusCode::NOT_FOUND,
        "SNAPBACK_MUTATION_CONFLICT" => StatusCode::CONFLICT,
        // @ref LLP 0017#security-defaults — admin gating distinguishes "disabled"
        // (forbidden) from "needs the configured token" (unauthorized).
        "SNAPBACK_ADMIN_DISABLED"
        | "SNAPBACK_LIVE_RESUME_OWNERSHIP"
        | "SNAPBACK_PROFILE_FORBIDS" => StatusCode::FORBIDDEN,
        "SNAPBACK_ADMIN_TOKEN_REQUIRED" => StatusCode::UNAUTHORIZED,
        "SNAPBACK_SQLITE_ERROR" | "SNAPBACK_INTERNAL_ERROR" => StatusCode::INTERNAL_SERVER_ERROR,
        _ => StatusCode::BAD_REQUEST,
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = status_for_diagnostic_code(self.0.diagnostic.code.as_str());
        let mut body = json!({ "diagnostic": self.0.diagnostic });
        if let (Some(object), Some(receipt)) = (body.as_object_mut(), self.1) {
            object.insert("receipt".to_owned(), receipt);
        }
        (status, Json(body)).into_response()
    }
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::status_for_diagnostic_code;
    use axum::http::StatusCode;

    /// LLP 0032 S5.D10 — internal/storage faults are 5xx, client errors are
    /// 4xx, and unrecognized codes still default to 400.
    #[test]
    fn s5_d10_internal_errors_map_to_5xx() {
        assert_eq!(
            status_for_diagnostic_code("SNAPBACK_SQLITE_ERROR"),
            StatusCode::INTERNAL_SERVER_ERROR
        );
        assert_eq!(
            status_for_diagnostic_code("SNAPBACK_INTERNAL_ERROR"),
            StatusCode::INTERNAL_SERVER_ERROR
        );
        assert_eq!(
            status_for_diagnostic_code("SNAPBACK_MUTATION_CONFLICT"),
            StatusCode::CONFLICT
        );
        assert_eq!(
            status_for_diagnostic_code("SNAPBACK_ADMIN_TOKEN_REQUIRED"),
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            status_for_diagnostic_code("SNAPBACK_UNKNOWN_TABLE"),
            StatusCode::NOT_FOUND
        );
        // An unrecognized (client-authoring) error still defaults to 400, so
        // the new 5xx class never widens by accident.
        assert_eq!(
            status_for_diagnostic_code("SNAPBACK_SOMETHING_NEW"),
            StatusCode::BAD_REQUEST
        );
    }

    use super::{
        LiveSocketClientMessage, RouteClass, RoutePolicy, live_socket_operation_name,
        live_socket_operations, route_registry,
    };
    use crate::ephemeral::{DeleteRequest, PublishRequest, Scope, SubscribeRequest};

    const RESERVED_PREFIX: &str = "/_snapback/";

    /// LLP 0031 §The invariant — the declared registry holds the boundary: every
    /// app-data entry is a root path, every system entry is under the reserved
    /// prefix, every system-api entry is admin-gated, static console entries are
    /// public presentation, and no privileged operation lives at the root.
    #[test]
    fn s1_route_registry_matches_the_invariant() {
        let registry = route_registry();
        assert!(!registry.is_empty());
        let mut seen = std::collections::BTreeSet::new();
        for route in &registry {
            assert!(
                seen.insert((route.method, route.path)),
                "duplicate registry entry: {} {}",
                route.method,
                route.path
            );
            let reserved = route.path.starts_with(RESERVED_PREFIX);
            match route.class {
                RouteClass::AppData => {
                    assert!(
                        !reserved,
                        "app-data route must live at the root: {}",
                        route.path
                    );
                    assert!(
                        matches!(route.policy, RoutePolicy::Public | RoutePolicy::AppAuth),
                        "app-data route carries an admin policy: {}",
                        route.path
                    );
                }
                RouteClass::SystemStatic => {
                    assert!(
                        route.path.starts_with("/_snapback/admin"),
                        "system-static must be console shell/assets: {}",
                        route.path
                    );
                    assert_eq!(
                        route.policy,
                        RoutePolicy::Public,
                        "console shell is public presentation: {}",
                        route.path
                    );
                }
                RouteClass::SystemApi => {
                    assert!(
                        route.path.starts_with("/_snapback/api/"),
                        "system-api must live under /_snapback/api/: {}",
                        route.path
                    );
                    assert!(
                        matches!(
                            route.policy,
                            RoutePolicy::AdminRead | RoutePolicy::AdminWrite
                        ),
                        "system-api must be admin-gated: {}",
                        route.path
                    );
                }
            }
        }
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

    /// LLP 0031 §Enforcement — every operation multiplexed over the app-data
    /// `/live/*` socket is itself app-data, and the declared list matches the
    /// enum's variants (the exhaustive `live_socket_operation_name` forces a new
    /// variant to be classified).
    #[test]
    fn s1_live_socket_operations_are_all_app_data() {
        let declared = live_socket_operations();
        for (name, class) in &declared {
            assert_eq!(
                *class,
                RouteClass::AppData,
                "live-socket operation {name} must be app-data"
            );
        }

        let scope = Scope::from_pairs([("roomId", "room_1")]);
        let samples = [
            LiveSocketClientMessage::EphemeralSubscribe {
                request_id: None,
                request: SubscribeRequest {
                    collection: "c".to_owned(),
                    scope: scope.clone(),
                    connection_id: "conn".to_owned(),
                    auth: Default::default(),
                },
            },
            LiveSocketClientMessage::EphemeralPublish {
                request_id: None,
                request: PublishRequest {
                    collection: "c".to_owned(),
                    scope: scope.clone(),
                    connection_id: "conn".to_owned(),
                    session_id: None,
                    user_id: None,
                    custom_key: None,
                    value: Vec::new(),
                    ttl_ms: None,
                    auth: Default::default(),
                },
            },
            LiveSocketClientMessage::EphemeralDelete {
                request_id: None,
                request: DeleteRequest {
                    collection: "c".to_owned(),
                    scope: scope.clone(),
                    connection_id: "conn".to_owned(),
                    session_id: None,
                    user_id: None,
                    custom_key: None,
                    auth: Default::default(),
                },
            },
            LiveSocketClientMessage::EphemeralUnsubscribe {
                request_id: None,
                request: SubscribeRequest {
                    collection: "c".to_owned(),
                    scope,
                    connection_id: "conn".to_owned(),
                    auth: Default::default(),
                },
            },
            LiveSocketClientMessage::Ping { request_id: None },
        ];
        let sample_names: std::collections::BTreeSet<_> =
            samples.iter().map(live_socket_operation_name).collect();
        let declared_names: std::collections::BTreeSet<_> =
            declared.iter().map(|(name, _)| *name).collect();
        assert_eq!(
            sample_names, declared_names,
            "every LiveSocketClientMessage variant must be a declared app-data operation"
        );
    }
}
