//! Admin console and headless admin API.
//!
//! @ref LLP 0017#serving-model — the same Snapback server that owns the app
//! instance serves the admin API and the packaged web console; no separate Vite
//! server is required to inspect a running instance.
//! @ref LLP 0017#headless-admin-contract — the admin facts extend the inspect
//! state rather than forking a parallel schema; the console is one consumer.

use crate::diagnostic::SnapbackError;
use crate::local::{EphemeralApi, InspectState, LocalSnapback, ReadLane};
use crate::manifest::{FunctionKind, HandlerInput};
use crate::runtime::CapabilityState;
use crate::server::{ApiError, HealthResponse, SharedSnapback};
use axum::extract::{FromRef, Path, Query, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;

/// The packaged web admin console: a single self-contained file embedded in the
/// binary so a built `snapback` serves a working console with no Node, Vite, or
/// browser toolchain.
///
/// @ref LLP 0017#serving-model — production and ordinary local inspection must
/// work without starting Vite; the bundle ships embedded.
const CONSOLE_HTML: &str = include_str!("admin/console.html");

/// The config setup wizard: one self-contained page rendered entirely from
/// manifest declarations plus `config.status`, embedded like the console.
///
/// @ref LLP 0036#the-setup-wizard-d3 — a projection of the gated config ops,
/// not a second implementation; it never reads a value back.
const SETUP_HTML: &str = include_str!("admin/setup.html");

/// The positive environment/profile capability (LLP 0034 §5 D4 residual,
/// ENG-22527): auth (`AdminWrite`) answers "may this principal?"; the profile
/// answers "is this operation appropriate in this environment?". Destructive
/// and provisioning operations require BOTH. Resolution: `SNAPBACK_PROFILE`
/// (dev|demo|test|prod) wins; otherwise loopback binds default to `dev` (the
/// zero-config local posture, mirroring the loopback-open AdminWrite stance —
/// OQ7 stands) and non-loopback binds default to `prod`.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ServerProfile {
    Dev,
    Demo,
    Test,
    Prod,
}

impl ServerProfile {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Dev => "dev",
            Self::Demo => "demo",
            Self::Test => "test",
            Self::Prod => "prod",
        }
    }

    pub fn allows_provisioning(self) -> bool {
        !matches!(self, Self::Prod)
    }
}

fn env_profile(loopback: bool) -> ServerProfile {
    match std::env::var("SNAPBACK_PROFILE").ok().as_deref() {
        Some("dev") => ServerProfile::Dev,
        Some("demo") => ServerProfile::Demo,
        Some("test") => ServerProfile::Test,
        Some("prod") => ServerProfile::Prod,
        _ if loopback => ServerProfile::Dev,
        _ => ServerProfile::Prod,
    }
}

/// Server-runtime facts that live outside `LocalSnapback` (it does not know the
/// socket it is served on) and the admin authorization configuration.
#[derive(Clone, Debug)]
pub struct ServerContext {
    pub host: String,
    pub port: u16,
    pub loopback: bool,
    pub profile: ServerProfile,
    pub pid: u32,
    pub started: Instant,
    pub started_at_ms: u64,
    pub admin_token: Option<String>,
    /// Directory of a built static console bundle (`SNAPBACK_ADMIN_DIST`). When
    /// present, the Contract console is served from here; otherwise the embedded
    /// single-file console is the fallback.
    ///
    /// @ref LLP 0017#serving-model — serve a built `admin/dist` snapshot when
    /// present, keeping the embedded console as the always-works fallback.
    pub admin_dist: Option<PathBuf>,
}

impl ServerContext {
    /// Build a context for a bound listener. The admin token is read once from
    /// `SNAPBACK_ADMIN_TOKEN`; an empty value is treated as unset.
    pub fn new(host: impl Into<String>, port: u16, loopback: bool) -> Self {
        Self {
            host: host.into(),
            port,
            loopback,
            profile: env_profile(loopback),
            pid: std::process::id(),
            started: Instant::now(),
            started_at_ms: now_millis(),
            admin_token: env_admin_token(),
            admin_dist: env_admin_dist(),
        }
    }

    /// A context for embedded or test use where the bind address is unknown.
    /// Treated as loopback so local tooling and tests keep their open defaults.
    pub fn detached() -> Self {
        Self {
            host: "127.0.0.1".to_owned(),
            port: 0,
            loopback: true,
            profile: env_profile(true),
            pid: std::process::id(),
            started: Instant::now(),
            started_at_ms: now_millis(),
            admin_token: env_admin_token(),
            admin_dist: env_admin_dist(),
        }
    }

    pub fn uptime_ms(&self) -> u64 {
        self.started.elapsed().as_millis() as u64
    }
}

fn env_admin_token() -> Option<String> {
    std::env::var("SNAPBACK_ADMIN_TOKEN")
        .ok()
        .filter(|token| !token.is_empty())
}

fn env_admin_dist() -> Option<PathBuf> {
    std::env::var_os("SNAPBACK_ADMIN_DIST")
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
}

/// Shared application state: the Snapback instance (write lane), the lock-free
/// read lane, the lock-free ephemeral lane (LLP 0032 L9), and the server
/// context. `FromRef` lets the original core handlers keep extracting
/// `SharedSnapback` unchanged while other handlers reach the `ReadLane`,
/// `EphemeralApi`, or `ServerContext`.
#[derive(Clone)]
pub struct AppState {
    pub snapback: SharedSnapback,
    pub read: ReadLane,
    pub ephemeral: EphemeralApi,
    pub server: Arc<ServerContext>,
}

impl AppState {
    pub fn new(
        snapback: SharedSnapback,
        read: ReadLane,
        ephemeral: EphemeralApi,
        server: ServerContext,
    ) -> Self {
        Self {
            snapback,
            read,
            ephemeral,
            server: Arc::new(server),
        }
    }

    /// Wrap a fresh instance: the read and ephemeral lanes are extracted
    /// before the instance disappears behind the write mutex.
    pub fn from_snapback(snapback: LocalSnapback, server: ServerContext) -> Self {
        let read = snapback.read_lane();
        let ephemeral = snapback.ephemeral_api();
        Self::new(Arc::new(Mutex::new(snapback)), read, ephemeral, server)
    }

    pub fn detached(snapback: LocalSnapback) -> Self {
        Self::from_snapback(snapback, ServerContext::detached())
    }
}

impl FromRef<AppState> for SharedSnapback {
    fn from_ref(state: &AppState) -> Self {
        state.snapback.clone()
    }
}

impl FromRef<AppState> for ReadLane {
    fn from_ref(state: &AppState) -> Self {
        state.read.clone()
    }
}

impl FromRef<AppState> for EphemeralApi {
    fn from_ref(state: &AppState) -> Self {
        state.ephemeral.clone()
    }
}

impl FromRef<AppState> for Arc<ServerContext> {
    fn from_ref(state: &AppState) -> Self {
        state.server.clone()
    }
}

/// Server-runtime facts surfaced on the admin dashboard.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct ServerInfo {
    pub host: String,
    pub port: u16,
    pub loopback: bool,
    pub pid: u32,
    pub started_at_ms: u64,
    pub uptime_ms: u64,
    /// `"file"` or `"memory"`, derived from the storage path.
    pub storage_mode: String,
}

/// Which admin capabilities this target offers, and how writes are gated.
///
/// @ref LLP 0017#headless-admin-contract — admin-write capability is a reported
/// capability field, not a private flag, and unimplemented surfaces are honest
/// gaps rather than placeholder controls.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct AdminCapabilities {
    pub console: bool,
    pub read_inspect: bool,
    pub data_explorer: bool,
    pub function_runner: bool,
    pub cron_controls: bool,
    pub ephemeral_cleanup: bool,
    /// Not in this slice: direct row edits land only once they commit as ordinary
    /// changesets with validation and live notification.
    pub direct_data_edit: bool,
    /// Not in this slice: raw SQL is an explicit portability/safety opt-out.
    pub raw_sql: bool,
    pub token_configured: bool,
    pub writes_require_token: bool,
    pub bind_loopback: bool,
}

/// The canonical admin inspect payload: the existing `InspectState` extended in
/// place with `server` and `admin` blocks.
///
/// @ref LLP 0017#headless-admin-contract — extend the runtime-state facts rather
/// than inventing a parallel schema.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct AdminInspect {
    #[serde(flatten)]
    pub inspect: InspectState,
    pub server: ServerInfo,
    pub admin: AdminCapabilities,
}

impl AdminInspect {
    pub fn assemble(inspect: InspectState, ctx: &ServerContext) -> Self {
        let in_memory = inspect.storage.sqlite_path.is_none();
        let token_configured = ctx.admin_token.is_some();
        let server = ServerInfo {
            host: ctx.host.clone(),
            port: ctx.port,
            loopback: ctx.loopback,
            pid: ctx.pid,
            started_at_ms: ctx.started_at_ms,
            uptime_ms: ctx.uptime_ms(),
            storage_mode: if in_memory { "memory" } else { "file" }.to_owned(),
        };
        let admin = AdminCapabilities {
            console: true,
            read_inspect: true,
            data_explorer: true,
            function_runner: true,
            cron_controls: true,
            ephemeral_cleanup: true,
            direct_data_edit: false,
            raw_sql: false,
            token_configured,
            writes_require_token: token_configured || !ctx.loopback,
            bind_loopback: ctx.loopback,
        };
        Self {
            inspect,
            server,
            admin,
        }
    }
}

/// The decision of the admin access policy for one request.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AdminAccess {
    Allowed,
    /// Admin is off entirely for this bind (non-loopback without a valid token).
    Disabled,
    /// A write needs the configured admin token and it was missing or wrong.
    TokenRequired,
}

/// The admin security model as a pure function, so it is unit-testable.
///
/// @ref LLP 0017#security-defaults — loopback reads are convenient; writes are
/// token-gated when a token is set even on loopback; a non-loopback bind without
/// a valid token disables admin.
pub fn evaluate_access(
    loopback: bool,
    configured: Option<&str>,
    provided: Option<&str>,
    write: bool,
) -> AdminAccess {
    let token_ok = matches!((configured, provided), (Some(c), Some(p)) if c == p);
    if write {
        match configured {
            Some(_) => {
                if token_ok {
                    AdminAccess::Allowed
                } else {
                    AdminAccess::TokenRequired
                }
            }
            None => {
                if loopback {
                    AdminAccess::Allowed
                } else {
                    AdminAccess::Disabled
                }
            }
        }
    } else if loopback || token_ok {
        AdminAccess::Allowed
    } else {
        AdminAccess::Disabled
    }
}

/// Route-level profile gate (ENG-22527): destructive/provisioning system
/// writes require a non-prod profile in addition to AdminWrite.
pub(crate) fn require_non_prod_profile(
    ctx: &ServerContext,
    operation: &str,
) -> Result<(), crate::server::ApiError> {
    if ctx.profile.allows_provisioning() {
        return Ok(());
    }
    Err(crate::diagnostic::SnapbackError::new(
        crate::diagnostic::Diagnostic::error(
            "SNAPBACK_PROFILE_FORBIDS",
            "admin",
            format!(
                "{operation} is not available under the '{}' profile; set SNAPBACK_PROFILE=dev|demo|test to enable it",
                ctx.profile.as_str()
            ),
        ),
    )
    .into())
}

pub(crate) fn authorize(
    ctx: &ServerContext,
    headers: &HeaderMap,
    write: bool,
) -> Result<(), ApiError> {
    let provided = provided_token(headers);
    match evaluate_access(
        ctx.loopback,
        ctx.admin_token.as_deref(),
        provided.as_deref(),
        write,
    ) {
        AdminAccess::Allowed => Ok(()),
        AdminAccess::Disabled => Err(SnapbackError::error(
            "SNAPBACK_ADMIN_DISABLED",
            "admin",
            "admin API is disabled on this non-loopback bind without a valid admin token",
        )
        .into()),
        AdminAccess::TokenRequired => Err(SnapbackError::error(
            "SNAPBACK_ADMIN_TOKEN_REQUIRED",
            "admin",
            "this admin write requires the configured admin token",
        )
        .into()),
    }
}

fn provided_token(headers: &HeaderMap) -> Option<String> {
    if let Some(token) = headers
        .get("x-snapback-admin-token")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|token| !token.is_empty())
    {
        return Some(token.to_owned());
    }
    headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| {
            value
                .strip_prefix("Bearer ")
                .or_else(|| value.strip_prefix("bearer "))
        })
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .map(ToOwned::to_owned)
}

/// The Snapback-owned admin namespace. Merged into the core router.
///
/// @ref LLP 0017#serving-model — `/_snapback/*` is the reserved admin namespace.
pub fn admin_routes() -> Router<AppState> {
    Router::new()
        .route("/_snapback/admin", get(console))
        .route("/_snapback/admin/", get(console))
        .route("/_snapback/admin/setup", get(setup))
        .route("/_snapback/admin/{*path}", get(console_asset))
        .route("/_snapback/api/health", get(admin_health))
        .route("/_snapback/api/inspect", get(admin_inspect))
        .route("/_snapback/api/receipts", get(admin_receipts))
        .route("/_snapback/api/data/{table}", get(admin_data))
        .route(
            "/_snapback/api/functions/{name}/run",
            post(admin_run_function),
        )
        .route("/_snapback/api/cron/tick", post(admin_cron_tick))
        .route("/_snapback/api/cron/{name}/run", post(admin_run_cron_job))
        .route(
            "/_snapback/api/ephemeral/cleanup",
            post(admin_ephemeral_cleanup),
        )
}

/// Serve the console page: the built Contract bundle's `index.html` when a
/// static dist is configured, otherwise the embedded single-file console.
///
/// @ref LLP 0017#serving-model — the built snapshot is served by the same Rust
/// server; the embedded console is the always-works fallback.
async fn console(State(ctx): State<Arc<ServerContext>>) -> Response {
    if let Some(dist) = &ctx.admin_dist
        && let Ok(bytes) = tokio::fs::read(dist.join("index.html")).await
    {
        return ([(header::CONTENT_TYPE, "text/html; charset=utf-8")], bytes).into_response();
    }
    Html(CONSOLE_HTML).into_response()
}

/// Serve the embedded setup wizard (`/_snapback/admin/setup`) — system-static
/// shell; every fact it shows and every write it makes goes through the gated
/// `/_snapback/api/config/*` lane.
async fn setup() -> Response {
    Html(SETUP_HTML).into_response()
}

/// Serve a static asset of the built console bundle (`/_snapback/admin/<path>`).
/// Only active when a dist is configured; the embedded console has no assets.
async fn console_asset(
    State(ctx): State<Arc<ServerContext>>,
    Path(path): Path<String>,
) -> Response {
    // Reject path traversal and empty segments before touching the filesystem.
    if path
        .split('/')
        .any(|segment| segment.is_empty() || segment == "." || segment == "..")
    {
        return StatusCode::NOT_FOUND.into_response();
    }
    let exact_artifact = crate::contract_exact::is_exact_static_artifact_path(&path);
    let Some(dist) = &ctx.admin_dist else {
        if exact_artifact {
            return diagnostic_response(
                StatusCode::BAD_REQUEST,
                crate::contract_exact::native_artifacts_unavailable(&path),
            );
        }
        return StatusCode::NOT_FOUND.into_response();
    };
    match tokio::fs::read(dist.join(&path)).await {
        Ok(bytes) => ([(header::CONTENT_TYPE, content_type_for(&path))], bytes).into_response(),
        Err(_) if exact_artifact => diagnostic_response(
            StatusCode::BAD_REQUEST,
            crate::contract_exact::native_artifact_missing(&path),
        ),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

fn content_type_for(path: &str) -> &'static str {
    match path.rsplit('.').next() {
        Some("html") => "text/html; charset=utf-8",
        Some("js" | "mjs") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json" | "map") => "application/json; charset=utf-8",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("ico") => "image/x-icon",
        Some("woff2") => "font/woff2",
        Some("woff") => "font/woff",
        Some("wasm") => "application/wasm",
        _ => "application/octet-stream",
    }
}

fn diagnostic_response(status: StatusCode, error: SnapbackError) -> Response {
    (
        status,
        Json(crate::server::ErrorResponse {
            diagnostic: error.diagnostic,
        }),
    )
        .into_response()
}

async fn admin_health(
    State(snapback): State<SharedSnapback>,
    State(ctx): State<Arc<ServerContext>>,
    headers: HeaderMap,
) -> Result<Json<HealthResponse>, ApiError> {
    authorize(&ctx, &headers, false)?;
    let inspect = crate::server::with_snapback(&snapback, |snapback| snapback.inspect()).await?;
    Ok(Json(HealthResponse {
        ok: true,
        target: inspect.target,
        sqlite_version: inspect.storage.version,
        ibex_available: inspect.runtime.ibex_cli.available
            || inspect.runtime.ibex_ctx_db_host_bridge == CapabilityState::Available,
    }))
}

async fn admin_inspect(
    State(snapback): State<SharedSnapback>,
    State(ctx): State<Arc<ServerContext>>,
    headers: HeaderMap,
) -> Result<Json<AdminInspect>, ApiError> {
    authorize(&ctx, &headers, false)?;
    let inspect = crate::server::with_snapback(&snapback, |snapback| snapback.inspect()).await?;
    Ok(Json(AdminInspect::assemble(inspect, &ctx)))
}

#[derive(Debug, Deserialize)]
struct DataQuery {
    limit: Option<usize>,
    offset: Option<usize>,
}

/// Receipt retention surface (LLP 0034 §3 / ENG-22478): the bounded
/// in-memory receipt rings — dev/debug reads under the admin read policy
/// (LLP 0031 SystemApi). `?connection_id=` filters to one connection's ring.
/// Privacy (§3.3): rings hold opaque ids/versions/table names and verbatim
/// adapter correlation — never ephemeral payload values.
async fn admin_receipts(
    State(state): State<SharedSnapback>,
    State(ctx): State<Arc<ServerContext>>,
    headers: HeaderMap,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, crate::server::ApiError> {
    authorize(&ctx, &headers, false)?;
    // L7 shape: the rings and gauges are pure in-memory reads, but the guard
    // discipline is one pattern for every handler that takes the global lock.
    let connection_filter = params.get("connection_id").cloned();
    let body = crate::server::with_snapback(&state, move |snapback| {
        let mut body = snapback.receipts_snapshot(connection_filter.as_deref());
        // Delivered-rate observability (LLP 0034 §3.2 / Exact 0284 §2.5.1):
        // the coalescing diagnostics ride the receipts surface as
        // receipt-visible facts so conformance can measure delivered rate
        // against the budget.
        if let Some(object) = body.as_object_mut() {
            object.insert(
                "ephemeralDelivery".to_owned(),
                serde_json::to_value(snapback.ephemeral_diagnostics()).unwrap_or_default(),
            );
        }
        body
    })
    .await;
    Ok(Json(body))
}

async fn admin_data(
    State(snapback): State<SharedSnapback>,
    State(ctx): State<Arc<ServerContext>>,
    headers: HeaderMap,
    Path(table): Path<String>,
    Query(params): Query<DataQuery>,
) -> Result<Json<crate::storage::TableScan>, ApiError> {
    authorize(&ctx, &headers, false)?;
    let limit = params.limit.unwrap_or(50).clamp(1, 500);
    let offset = params.offset.unwrap_or(0);
    let scan = crate::server::with_snapback(&snapback, move |snapback| {
        snapback.scan_table(&table, limit, offset)
    })
    .await?;
    Ok(Json(scan))
}

async fn admin_run_function(
    State(snapback): State<SharedSnapback>,
    State(ctx): State<Arc<ServerContext>>,
    headers: HeaderMap,
    Path(name): Path<String>,
    Json(input): Json<HandlerInput>,
) -> Result<Json<crate::local::FunctionRunResult>, ApiError> {
    let result = crate::server::with_snapback(&snapback, move |snapback| -> Result<_, ApiError> {
        // A mutation is a write; a query (or unknown function) is a read.
        let write = matches!(
            snapback.function_kind(&name),
            Some(FunctionKind::Mutation | FunctionKind::Action)
        );
        authorize(&ctx, &headers, write)?;
        Ok(snapback.run_function(&name, input))
    })
    .await?;
    Ok(Json(result))
}

async fn admin_cron_tick(
    State(snapback): State<SharedSnapback>,
    State(ctx): State<Arc<ServerContext>>,
    headers: HeaderMap,
) -> Result<Json<Vec<crate::cron::CronRunRecord>>, ApiError> {
    authorize(&ctx, &headers, true)?;
    let now = now_millis();
    let runs =
        crate::server::with_snapback(&snapback, move |snapback| snapback.tick_cron(now)).await?;
    Ok(Json(runs))
}

async fn admin_run_cron_job(
    State(snapback): State<SharedSnapback>,
    State(ctx): State<Arc<ServerContext>>,
    headers: HeaderMap,
    Path(name): Path<String>,
) -> Result<Json<crate::cron::CronRunRecord>, ApiError> {
    authorize(&ctx, &headers, true)?;
    let now = now_millis();
    let record = crate::server::with_snapback(&snapback, move |snapback| {
        snapback.run_cron_job_now(&name, now)
    })
    .await?;
    Ok(Json(record))
}

async fn admin_ephemeral_cleanup(
    State(ephemeral): State<EphemeralApi>,
    State(ctx): State<Arc<ServerContext>>,
    headers: HeaderMap,
) -> Result<StatusCode, ApiError> {
    // @ref LLP 0017#ephemeral-inspector — ephemeral mutating controls are
    // privileged writes, gated like durable admin writes.
    authorize(&ctx, &headers, true)?;
    // Room authority is off the global mutex (LLP 0032 L9): cleanup reaches
    // the store directly and cannot queue behind a busy write.
    ephemeral.cleanup_expired(now_millis());
    Ok(StatusCode::NO_CONTENT)
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loopback_reads_are_open_and_writes_open_without_a_token() {
        // The existing local dev default: everything works on loopback.
        assert_eq!(
            evaluate_access(true, None, None, false),
            AdminAccess::Allowed
        );
        assert_eq!(
            evaluate_access(true, None, None, true),
            AdminAccess::Allowed
        );
    }

    #[test]
    fn loopback_writes_require_the_token_once_one_is_set() {
        // Reads stay public on loopback; writes need the token.
        assert_eq!(
            evaluate_access(true, Some("secret"), None, false),
            AdminAccess::Allowed
        );
        assert_eq!(
            evaluate_access(true, Some("secret"), None, true),
            AdminAccess::TokenRequired
        );
        assert_eq!(
            evaluate_access(true, Some("secret"), Some("secret"), true),
            AdminAccess::Allowed
        );
        assert_eq!(
            evaluate_access(true, Some("secret"), Some("wrong"), true),
            AdminAccess::TokenRequired
        );
    }

    #[test]
    fn non_loopback_disables_admin_until_a_valid_token_is_presented() {
        assert_eq!(
            evaluate_access(false, None, None, false),
            AdminAccess::Disabled
        );
        assert_eq!(
            evaluate_access(false, None, None, true),
            AdminAccess::Disabled
        );
        assert_eq!(
            evaluate_access(false, Some("secret"), None, false),
            AdminAccess::Disabled
        );
        assert_eq!(
            evaluate_access(false, Some("secret"), Some("secret"), false),
            AdminAccess::Allowed
        );
        assert_eq!(
            evaluate_access(false, Some("secret"), Some("secret"), true),
            AdminAccess::Allowed
        );
    }

    #[test]
    fn bearer_and_custom_header_tokens_are_both_accepted() {
        let mut headers = HeaderMap::new();
        headers.insert("x-snapback-admin-token", "from-custom".parse().unwrap());
        assert_eq!(provided_token(&headers).as_deref(), Some("from-custom"));

        let mut headers = HeaderMap::new();
        headers.insert(header::AUTHORIZATION, "Bearer from-bearer".parse().unwrap());
        assert_eq!(provided_token(&headers).as_deref(), Some("from-bearer"));

        assert_eq!(provided_token(&HeaderMap::new()), None);
    }
}
