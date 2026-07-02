use crate::admin::{AppState, ServerContext};
use crate::diagnostic::{Diagnostic, SnapbackError};
use crate::ephemeral::{DeleteRequest, EphemeralCollection, PublishRequest, SubscribeRequest};
use crate::local::{InspectState, LiveResumeInput, LiveSubscribeInput, LocalSnapback};
use crate::manifest::{FunctionManifest, HandlerInput, SchemaManifest, SeedData};
use crate::runtime::CapabilityState;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
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

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct HealthResponse {
    pub ok: bool,
    pub target: String,
    pub sqlite_version: u64,
    pub ibex_available: bool,
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
        .route("/live/{name}/subscribe", post(subscribe_live))
        .route("/live/{name}/resume", post(resume_live))
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
        .route(
            "/_snapback/api/connections/{connection_id}/disconnect",
            post(disconnect),
        )
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
        spec("POST", "/live/{name}/subscribe", AppData, AppAuth),
        spec("POST", "/live/{name}/resume", AppData, AppAuth),
        spec("GET", "/live/{connection_id}/stream", AppData, AppAuth),
        spec("GET", "/outbox/{connection_id}", AppData, Public),
        spec("POST", "/ephemeral/collections/ensure", AppData, Public),
        spec("POST", "/ephemeral/publish", AppData, Public),
        spec("POST", "/ephemeral/subscribe", AppData, Public),
        spec("POST", "/ephemeral/delete", AppData, Public),
        // System API — migrated gated writes (LLP 0031 D5/D2).
        spec("POST", "/_snapback/api/schema/load", SystemApi, AdminWrite),
        spec("POST", "/_snapback/api/functions/load", SystemApi, AdminWrite),
        spec("POST", "/_snapback/api/app/reset", SystemApi, AdminWrite),
        spec(
            "POST",
            "/_snapback/api/connections/{connection_id}/disconnect",
            SystemApi,
            AdminWrite,
        ),
        // System API — existing admin surface.
        spec("GET", "/_snapback/api/health", SystemApi, AdminRead),
        spec("GET", "/_snapback/api/inspect", SystemApi, AdminRead),
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
        spec("POST", "/_snapback/api/cron/{name}/run", SystemApi, AdminWrite),
        spec(
            "POST",
            "/_snapback/api/ephemeral/cleanup",
            SystemApi,
            AdminWrite,
        ),
        // System static — console shell/assets (public presentation only).
        spec("GET", "/_snapback/admin", SystemStatic, Public),
        spec("GET", "/_snapback/admin/", SystemStatic, Public),
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
        ("live_ping", RouteClass::AppData),
    ]
}

/// Browser-friendly default route for a running Snapback instance.
///
/// @ref LLP 0017#serving-model — system surfaces live under the reserved
/// `/_snapback/*` namespace; the default route can point humans at them without
/// becoming another privileged API.
/// @ref LLP 0024#http-projection — agent operations remain admin API/MCP
/// projections, not the root browser URL.
async fn instance_home(
    State(state): State<SharedSnapback>,
    State(ctx): State<Arc<ServerContext>>,
) -> Result<Response, ApiError> {
    let mut snapback = state.lock().await;
    let inspect = snapback.inspect()?;
    Ok((
        [(header::CONTENT_TYPE, "text/yaml; charset=utf-8")],
        instance_home_yaml(&inspect, &ctx),
    )
        .into_response())
}

fn instance_home_yaml(inspect: &InspectState, ctx: &ServerContext) -> String {
    let bind = format!("{}:{}", ctx.host, ctx.port);
    let storage_mode = if inspect.storage.sqlite_path.is_some() {
        "file"
    } else {
        "memory"
    };
    // @ref LLP 0031#resolved-decisions — D3: the public `/` must not reveal the
    // absolute on-disk DB path; report the mode, not the location.
    let storage_detail = if inspect.storage.sqlite_path.is_some() {
        "on-disk database"
    } else {
        "in-memory database"
    };
    let schema_hash = inspect
        .schema
        .schema_hash
        .as_deref()
        .unwrap_or("not loaded");
    let bundle_hash = inspect
        .functions
        .bundle_hash
        .as_deref()
        .unwrap_or("not loaded");
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
    format!(
        concat!(
            "schemaVersion: {schema_version}\n",
            "statusKind: {status_kind}\n",
            "name: {name}\n",
            "target: {target}\n",
            "runtimeEngine: {runtime_engine}\n",
            "storage:\n",
            "  engine: {storage_engine}\n",
            "  mode: {storage_mode}\n",
            "  detail: {storage_detail}\n",
            "  databaseVersion: {database_version}\n",
            "server:\n",
            "  bind: {bind}\n",
            "  host: {host}\n",
            "  port: {port}\n",
            "  loopback: {loopback}\n",
            "  uptimeMs: {uptime_ms}\n",
            "  uptime: {uptime}\n",
            "admin:\n",
            "  access: {admin_access}\n",
            "artifacts:\n",
            "  schemaHash: {schema_hash}\n",
            "  bundleHash: {bundle_hash}\n",
            "counts:\n",
            "  loadedTables: {table_count}\n",
            "  loadedFunctions: {function_count}\n",
            "  liveSubscriptions: {subscription_count}\n",
            "  cronJobs: {cron_job_count}\n",
            "  recentDiagnostics: {diagnostic_count}\n",
            "capabilities:\n",
            "  summary: {capability_summary}\n",
            "  gaps: {capability_gaps}\n",
            "links:\n",
            "  adminConsole: {admin_console}\n",
            "  healthJson: {health_json}\n",
            "  inspectJson: {inspect_json}\n",
        ),
        schema_version = yaml_string(&inspect.schema_version),
        status_kind = yaml_string("snapbackInstanceStatus"),
        name = yaml_string("Snapback local server"),
        target = yaml_string(&inspect.target),
        runtime_engine = yaml_string(&inspect.capability_manifest.runtime_engine),
        storage_engine = yaml_string(&inspect.capability_manifest.storage_engine),
        storage_mode = yaml_string(storage_mode),
        storage_detail = yaml_string(&storage_detail),
        database_version = inspect.storage.version,
        bind = yaml_string(&bind),
        host = yaml_string(&ctx.host),
        port = ctx.port,
        loopback = ctx.loopback,
        uptime_ms = ctx.uptime_ms(),
        uptime = yaml_string(&format_duration(ctx.uptime_ms())),
        admin_access = yaml_string(&admin_access_summary(ctx)),
        schema_hash = yaml_string(schema_hash),
        bundle_hash = yaml_string(bundle_hash),
        table_count = inspect.storage.tables.len(),
        function_count = inspect.functions.functions.len(),
        subscription_count = inspect.subscriptions.len(),
        cron_job_count = inspect.cron.jobs.len(),
        diagnostic_count = inspect.recent_diagnostics.len(),
        capability_summary = yaml_string(&capability_summary),
        capability_gaps = yaml_string_list(&inspect.capability_gaps),
        admin_console = yaml_string("/_snapback/admin"),
        health_json = yaml_string("/_snapback/api/health"),
        inspect_json = yaml_string("/_snapback/api/inspect"),
    )
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
pub fn router(state: SharedSnapback) -> Router {
    app(AppState::detached(state))
}

/// How long a connection may be idle before the reaper tears it down, and how
/// often the reaper runs. HTTP-polling clients poll well within this window;
/// WS clients are reaped on socket close and never reach it.
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
/// forever, and prune the change journal to its retention window (L3) so it does
/// not grow without bound.
///
/// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L2, L3.
pub fn spawn_maintenance_worker(state: SharedSnapback) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut ticks = interval(Duration::from_millis(MAINTENANCE_INTERVAL_MS));
        loop {
            ticks.tick().await;
            let now = now_millis();
            let mut snapback = state.lock().await;
            snapback.reap_stale_connections(now, CONNECTION_IDLE_TTL_MS);
            // Best-effort; a transient prune error is retried next tick.
            let _ = snapback.prune_change_journal(now, JOURNAL_RETAIN_VERSIONS, JOURNAL_RETAIN_MS);
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
            let mut snapback = state.lock().await;
            snapback.tick_cron_recording(now_millis());
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

async fn health(State(state): State<SharedSnapback>) -> Result<Json<HealthResponse>, ApiError> {
    let mut snapback = state.lock().await;
    let inspect = snapback.inspect()?;
    Ok(Json(HealthResponse {
        ok: true,
        target: inspect.target,
        sqlite_version: inspect.storage.version,
        ibex_available: inspect.runtime.ibex_cli.available
            || inspect.runtime.ibex_ctx_db_host_bridge == CapabilityState::Available,
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
    let mut snapback = state.lock().await;
    Ok(Json(snapback.inspect()?.into()))
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
    let mut snapback = state.lock().await;
    Ok(Json(DiagnosticsResponse {
        diagnostics: snapback.apply_schema(manifest)?,
    }))
}

async fn load_functions(
    State(state): State<SharedSnapback>,
    State(ctx): State<Arc<ServerContext>>,
    headers: HeaderMap,
    Json(manifest): Json<FunctionManifest>,
) -> Result<Json<DiagnosticsResponse>, ApiError> {
    crate::admin::authorize(&ctx, &headers, true)?;
    let mut snapback = state.lock().await;
    Ok(Json(DiagnosticsResponse {
        diagnostics: snapback.load_functions(manifest),
    }))
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
    let seed = body.and_then(|Json(body)| body.seed);
    let mut snapback = state.lock().await;
    snapback.reset()?;
    let seeded = match seed {
        Some(seed) => Some(snapback.seed(seed)?),
        None => None,
    };
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

async fn invoke_query(
    State(state): State<SharedSnapback>,
    Path(name): Path<String>,
    Json(input): Json<HandlerInput>,
) -> Result<Json<crate::manifest::QueryOutput>, ApiError> {
    let snapback = state.lock().await;
    Ok(Json(snapback.invoke_query(&name, input)?))
}

async fn invoke_mutation(
    State(state): State<SharedSnapback>,
    Path(name): Path<String>,
    Json(input): Json<HandlerInput>,
) -> Result<Json<crate::manifest::MutationOutput>, ApiError> {
    let mut snapback = state.lock().await;
    Ok(Json(snapback.invoke_mutation(&name, input)?))
}

async fn subscribe_live(
    State(state): State<SharedSnapback>,
    Path(name): Path<String>,
    Json(input): Json<LiveSubscribeInput>,
) -> Result<Json<crate::local::LiveSubscribeOutput>, ApiError> {
    let mut snapback = state.lock().await;
    Ok(Json(snapback.subscribe_live(&name, input)?))
}

async fn resume_live(
    State(state): State<SharedSnapback>,
    Path(name): Path<String>,
    Json(input): Json<LiveResumeInput>,
) -> Result<Json<crate::local::LiveResumeOutput>, ApiError> {
    let mut snapback = state.lock().await;
    Ok(Json(snapback.resume_live(&name, input)?))
}

async fn stream_live(
    State(state): State<SharedSnapback>,
    Path(connection_id): Path<String>,
    ws: WebSocketUpgrade,
) -> Response {
    ws.on_upgrade(move |socket| live_stream(socket, state, connection_id))
}

async fn live_stream(socket: WebSocket, state: SharedSnapback, connection_id: String) {
    let (mut sender, mut receiver) = socket.split();
    // @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L8: an enqueue
    // wakes this task immediately (sub-poll-interval delivery, and no periodic
    // lock traffic while idle). The long interval is a safety net only, in case
    // a wake is ever missed; register before draining so no push is lost.
    let notify = state.lock().await.delivery_notifier();
    let waker = notify.register(&connection_id);
    // Delivery is event-driven (the 25ms poll is gone); this heartbeat is only a
    // defensive fallback if a wake is ever missed. At 30s it is ~1200× less lock
    // traffic than the old poll, so an idle connection is effectively idle.
    let mut safety_net = interval(Duration::from_secs(30));
    safety_net.tick().await; // consume the immediate first tick

    // Flush anything enqueued before (or racing) registration, then rely on
    // wakeups. Enqueues are serialized under the global lock, so a push either
    // lands before this drain or wakes the now-registered waker.
    if drain_and_send(&state, &connection_id, &mut sender)
        .await
        .is_break()
    {
        notify.unregister(&connection_id);
        let mut snapback = state.lock().await;
        snapback.disconnect(&connection_id, now_millis());
        return;
    }

    // @ref LLP 0020#phase-4-upgrade-realtime-from-v0-outbox-to-app-grade-live-delivery — WebSocket push is a transport over the existing ordered live queue; deterministic drain stays available for tests.
    'stream: loop {
        let drain = tokio::select! {
            incoming = receiver.next() => {
                match incoming {
                    Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                    Some(Ok(Message::Text(text))) => {
                        let response = handle_live_socket_text(&state, &connection_id, &text).await;
                        if sender.send(Message::Text(response.into())).await.is_err() {
                            break 'stream;
                        }
                        false
                    }
                    Some(Ok(Message::Binary(_))) | Some(Ok(Message::Ping(_))) | Some(Ok(Message::Pong(_))) => false,
                }
            }
            _ = waker.notified() => true,
            _ = safety_net.tick() => true,
        };
        if drain && drain_and_send(&state, &connection_id, &mut sender).await.is_break() {
            break 'stream;
        }
    }

    notify.unregister(&connection_id);
    let mut snapback = state.lock().await;
    snapback.disconnect(&connection_id, now_millis());
}

/// Drain a connection's outbox under the lock and send each message. Returns
/// `Break` if the socket send failed (the caller should tear down).
async fn drain_and_send(
    state: &SharedSnapback,
    connection_id: &str,
    sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
) -> std::ops::ControlFlow<()> {
    let messages = {
        let mut snapback = state.lock().await;
        snapback.drain_live_stream(connection_id)
    };
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
        LiveSocketClientMessage::Ping { .. } => "live_ping",
    }
}

async fn handle_live_socket_text(
    state: &SharedSnapback,
    connection_id: &str,
    text: &str,
) -> String {
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
        } => {
            let outcome = {
                let mut snapback = state.lock().await;
                snapback.subscribe_ephemeral(request, now_millis())
            };
            match outcome {
                Ok(message) => socket_ack(request_id, "subscribe", json!({ "message": message })),
                Err(error) => {
                    socket_error(request_id, "subscribe", diagnostic_from_ephemeral(error))
                }
            }
        }
        LiveSocketClientMessage::EphemeralPublish {
            request_id,
            request,
        } => {
            let outcome = {
                let mut snapback = state.lock().await;
                snapback.publish_ephemeral(request, now_millis())
            };
            match outcome {
                Ok(outcome) => socket_ack(request_id, "publish", json!({ "outcome": outcome })),
                Err(error) => socket_error(request_id, "publish", diagnostic_from_ephemeral(error)),
            }
        }
        LiveSocketClientMessage::EphemeralDelete {
            request_id,
            request,
        } => {
            let outcome = {
                let mut snapback = state.lock().await;
                snapback.delete_ephemeral(request, now_millis())
            };
            match outcome {
                Ok(message) => socket_ack(request_id, "delete", json!({ "message": message })),
                Err(error) => socket_error(request_id, "delete", diagnostic_from_ephemeral(error)),
            }
        }
        LiveSocketClientMessage::Ping { .. } => unreachable!("handled above"),
    }
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

async fn drain_outbox(
    State(state): State<SharedSnapback>,
    Path(connection_id): Path<String>,
) -> Json<Vec<crate::ephemeral::RealtimeEnvelope>> {
    let mut snapback = state.lock().await;
    Json(snapback.drain_outbox(&connection_id))
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

async fn ensure_ephemeral_collections(
    State(state): State<SharedSnapback>,
    Json(input): Json<EnsureEphemeralCollectionsInput>,
) -> Result<Json<crate::ephemeral::CollectionEnsureOutcome>, ApiError> {
    let mut snapback = state.lock().await;
    snapback
        .ensure_ephemeral_collections(input.into_collections())
        .map(Json)
        .map_err(ApiError::from_ephemeral)
}

async fn publish_ephemeral(
    State(state): State<SharedSnapback>,
    Json(request): Json<PublishRequest>,
) -> Result<Json<crate::ephemeral::PublishOutcome>, ApiError> {
    let mut snapback = state.lock().await;
    snapback
        .publish_ephemeral(request, now_millis())
        .map(Json)
        .map_err(ApiError::from_ephemeral)
}

async fn subscribe_ephemeral(
    State(state): State<SharedSnapback>,
    Json(request): Json<SubscribeRequest>,
) -> Result<Json<crate::ephemeral::EphemeralMessage>, ApiError> {
    let mut snapback = state.lock().await;
    snapback
        .subscribe_ephemeral(request, now_millis())
        .map(Json)
        .map_err(ApiError::from_ephemeral)
}

async fn delete_ephemeral(
    State(state): State<SharedSnapback>,
    Json(request): Json<DeleteRequest>,
) -> Result<Json<Option<crate::ephemeral::EphemeralMessage>>, ApiError> {
    let mut snapback = state.lock().await;
    snapback
        .delete_ephemeral(request, now_millis())
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
pub struct ApiError(SnapbackError);

impl ApiError {
    fn from_ephemeral(error: crate::ephemeral::EphemeralError) -> Self {
        Self(SnapbackError::new(diagnostic_from_ephemeral(error)))
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
        Self(value)
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
        "SNAPBACK_ADMIN_DISABLED" | "SNAPBACK_LIVE_RESUME_OWNERSHIP" => StatusCode::FORBIDDEN,
        "SNAPBACK_ADMIN_TOKEN_REQUIRED" => StatusCode::UNAUTHORIZED,
        "SNAPBACK_SQLITE_ERROR" | "SNAPBACK_INTERNAL_ERROR" => {
            StatusCode::INTERNAL_SERVER_ERROR
        }
        _ => StatusCode::BAD_REQUEST,
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = status_for_diagnostic_code(self.0.diagnostic.code.as_str());
        (
            status,
            Json(ErrorResponse {
                diagnostic: self.0.diagnostic,
            }),
        )
            .into_response()
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
                        matches!(route.policy, RoutePolicy::AdminRead | RoutePolicy::AdminWrite),
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
                    scope,
                    connection_id: "conn".to_owned(),
                    session_id: None,
                    user_id: None,
                    custom_key: None,
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
