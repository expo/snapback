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
use crate::server::{ApiError, ConnectionRegistry, HealthResponse, SharedSnapback};
use anyhow::Context as _;
use axum::extract::{FromRef, Path, Query, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use std::ffi::OsString;
use std::path::{Component, Path as FsPath, PathBuf};
use std::sync::Arc;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;

/// A tiny failure shell, not a second admin UI. The admin console itself is the
/// Contract/Exact bundle in `admin-ui/dist`; when that snapshot is unavailable,
/// browsers get an explicit capability diagnostic instead of a separate
/// handwritten console.
const MISSING_ADMIN_DIST_HTML: &str = r#"<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Snapback Admin Console unavailable</title>
<style>
  body { margin: 0; font: 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f7f7f8; color: #1f2328; }
  main { max-width: 760px; margin: 64px auto; padding: 0 24px; }
  h1 { font-size: 24px; margin: 0 0 12px; }
  p { line-height: 1.55; margin: 0 0 14px; }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  pre { background: #fff; border: 1px solid #d8dee4; border-radius: 6px; padding: 14px; overflow: auto; }
  a { color: #4455c7; }
</style>
</head>
<body>
<main>
<h1>Snapback Admin Console unavailable</h1>
<p><code>SNAPBACK_CAPABILITY_EXACT_ADMIN_DIST_MISSING</code></p>
<p>The Snapback admin console is served from the Contract/Exact static build. Build it, or set <code>SNAPBACK_ADMIN_DIST</code> to a built admin snapshot.</p>
<pre>cd admin-ui
./build.sh
cargo run --manifest-path ../Cargo.toml -- --memory</pre>
<p>The headless admin API is still available at <a href="/_snapback/api/inspect"><code>/_snapback/api/inspect</code></a>.</p>
</main>
</body>
</html>
"#;

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
/// zero-config local posture — OQ7 stands; since ENG-23443 the AdminWrite side
/// of that posture is a minted token rather than loopback-open) and
/// non-loopback binds default to `prod`.
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
    resolve_profile(std::env::var("SNAPBACK_PROFILE").ok().as_deref(), loopback)
}

/// Resolve the server profile from the raw `SNAPBACK_PROFILE` value (pure, so
/// the fail-closed behavior is testable without mutating the process
/// environment). An exact `dev|demo|test|prod` wins; ANY other non-empty value
/// — a typo, `production`, `PROD`, `staging` — fails CLOSED to `Prod` rather
/// than silently granting the destructive/provisioning capability via the
/// loopback default (ENG-22527 FIX 3). Unset or empty falls back to the
/// bind-address default: zero-config `dev` on loopback, `prod` on a real
/// interface.
fn resolve_profile(raw: Option<&str>, loopback: bool) -> ServerProfile {
    match raw {
        Some("dev") => ServerProfile::Dev,
        Some("demo") => ServerProfile::Demo,
        Some("test") => ServerProfile::Test,
        Some("prod") => ServerProfile::Prod,
        Some(value) if !value.is_empty() => ServerProfile::Prod,
        _ if loopback => ServerProfile::Dev,
        _ => ServerProfile::Prod,
    }
}

/// The one admin HTTP client. Contract admin-ui imports the same source as the
/// `@snapback/admin-client` workspace package, and the server also exposes it at
/// `/_snapback/admin/client.mjs` for external tooling — one client, no drift.
const ADMIN_CLIENT_MJS: &str = include_str!("../packages/snapback-admin-client/index.mjs");

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
    /// True when `admin_token` was auto-minted at serve time rather than
    /// configured via `SNAPBACK_ADMIN_TOKEN` (ENG-23443).
    pub admin_token_minted: bool,
    /// Where the minted token is persisted (0600), when it is persisted at
    /// all. Reading this file as the same user is what makes a local process
    /// admin (LLP 0036 D3); a browser page on another localhost port cannot.
    pub admin_token_file: Option<PathBuf>,
    /// Directory of a built static console bundle (`SNAPBACK_ADMIN_DIST`, or the
    /// repo-local `admin-ui/dist` when it has already been built). When present,
    /// the Contract console is served from here; otherwise `/_snapback/admin`
    /// returns an explicit missing-dist diagnostic.
    ///
    /// @ref LLP 0017#serving-model — serve a built `admin/dist` snapshot when
    /// present; the admin UI has a single Contract/Exact implementation.
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
            admin_token_minted: false,
            admin_token_file: None,
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
            admin_token_minted: false,
            admin_token_file: None,
            admin_dist: env_admin_dist(),
        }
    }

    /// Install a serve-time resolved admin token (ENG-23443): the serve path
    /// calls this when `SNAPBACK_ADMIN_TOKEN` is unset on a loopback bind, so
    /// a served instance is never tokenless for writes.
    pub fn install_minted_token(&mut self, resolved: &ResolvedAdminToken) {
        self.admin_token = Some(resolved.token.clone());
        self.admin_token_minted = resolved.minted;
        self.admin_token_file = resolved.file.clone();
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

/// The admin token the serve path settled on, and how it was obtained.
#[derive(Clone, Debug)]
pub struct ResolvedAdminToken {
    pub token: String,
    /// False only when the token came from `SNAPBACK_ADMIN_TOKEN`.
    pub minted: bool,
    /// Freshly generated this call (vs loaded from the token file or env) —
    /// the value is printed once, on the start that minted it (LLP 0036 D3).
    pub fresh: bool,
    /// The 0600 file the minted token persists in, when there is one.
    pub file: Option<PathBuf>,
}

/// Mint a local admin capability token: 122 bits of CSPRNG randomness.
pub fn mint_admin_token() -> String {
    format!("sbat_{}", uuid::Uuid::new_v4().simple())
}

/// The sibling file a minted admin token persists in, next to the artifact
/// that names the instance (the SQLite database, or the readiness descriptor
/// for in-memory instances) — the same sibling convention as the
/// `.snapback.lock` instance lock.
pub fn admin_token_sibling(path: &std::path::Path) -> PathBuf {
    let mut name = path
        .file_name()
        .map(|name| name.to_os_string())
        .unwrap_or_default();
    name.push(".admin-token");
    path.with_file_name(name)
}

/// Serve-time admin-token resolution (ENG-23443): an explicit
/// `SNAPBACK_ADMIN_TOKEN` wins; otherwise the existing token file is reused;
/// otherwise a fresh token is minted (and persisted 0600 when a file path is
/// available). The serve path calls this on every loopback bind, so admin
/// writes over HTTP are never tokenless — the localhost-CORS reflection in
/// `local_dev_cors` would otherwise let any local web page drive them.
///
/// @ref LLP 0017#security-defaults — writes require an admin token or
/// equivalent local capability even on loopback; the minted token is that
/// capability.
pub fn resolve_serve_admin_token(
    env_token: Option<String>,
    token_file: Option<PathBuf>,
) -> anyhow::Result<ResolvedAdminToken> {
    if let Some(token) = env_token.filter(|token| !token.is_empty()) {
        return Ok(ResolvedAdminToken {
            token,
            minted: false,
            fresh: false,
            file: None,
        });
    }
    let Some(path) = token_file else {
        return Ok(ResolvedAdminToken {
            token: mint_admin_token(),
            minted: true,
            fresh: true,
            file: None,
        });
    };
    match crate::secure_file::read_owner_only(&path) {
        Ok(existing) => {
            let existing = String::from_utf8(existing).with_context(|| {
                format!("admin token file {} is not valid UTF-8", path.display())
            })?;
            let existing = existing.trim();
            if !existing.is_empty() {
                return Ok(ResolvedAdminToken {
                    token: existing.to_owned(),
                    minted: true,
                    fresh: false,
                    file: Some(path),
                });
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(error)
                .with_context(|| format!("failed to read admin token file {}", path.display()));
        }
    }
    let token = mint_admin_token();
    write_token_file(&path, &token)
        .with_context(|| format!("failed to write admin token file {}", path.display()))?;
    Ok(ResolvedAdminToken {
        token,
        minted: true,
        fresh: true,
        file: Some(path),
    })
}

/// Persist a minted token owner-readable only: the file being 0600 is what
/// scopes the capability to the current user on shared machines.
fn write_token_file(path: &std::path::Path, token: &str) -> std::io::Result<()> {
    crate::secure_file::write_owner_only(path, format!("{token}\n").as_bytes())
}

fn env_admin_dist() -> Option<PathBuf> {
    resolve_admin_dist(
        std::env::var_os("SNAPBACK_ADMIN_DIST"),
        default_admin_dist(),
    )
}

fn resolve_admin_dist(raw: Option<OsString>, default: Option<PathBuf>) -> Option<PathBuf> {
    raw.map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
        .or(default)
}

fn default_admin_dist() -> Option<PathBuf> {
    let dist = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("admin-ui")
        .join("dist");
    if dist.join("index.html").is_file() {
        Some(dist)
    } else {
        None
    }
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
    /// Per-connection capability grants (ENG-23442): connection-scoped routes
    /// demand the token minted by `POST /connection/open`.
    pub connections: ConnectionRegistry,
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
            connections: ConnectionRegistry::default(),
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

impl FromRef<AppState> for ConnectionRegistry {
    fn from_ref(state: &AppState) -> Self {
        state.connections.clone()
    }
}

/// Server-runtime facts surfaced on the admin dashboard.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
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
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
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
    /// Path of the auto-minted admin token file, when the serve path
    /// persisted one (ENG-23443). Local tooling reads the token from here:
    /// same-user filesystem access *is* local admin (LLP 0036 D3), while a
    /// browser page on another localhost origin cannot read files.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token_file: Option<String>,
}

/// The canonical admin inspect payload: the existing `InspectState` extended in
/// place with `server` and `admin` blocks.
///
/// @ref LLP 0017#headless-admin-contract — extend the runtime-state facts rather
/// than inventing a parallel schema.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
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
            token_file: ctx
                .admin_token_file
                .as_ref()
                .map(|path| path.display().to_string()),
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
///
/// The tokenless-loopback-open write branch is reachable only from embedded,
/// in-process routers (`server::router`, `AppState::detached`): the serve path
/// always resolves a token first (`resolve_serve_admin_token`, ENG-23443), so
/// no HTTP-served instance accepts tokenless writes — otherwise the reflected
/// localhost CORS would hand admin writes to any local web page.
pub fn evaluate_access(
    loopback: bool,
    configured: Option<&str>,
    provided: Option<&str>,
    write: bool,
) -> AdminAccess {
    let token_ok = matches!((configured, provided), (Some(c), Some(p)) if token_eq(c, p));
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

fn token_eq(configured: &str, provided: &str) -> bool {
    let configured = configured.as_bytes();
    let provided = provided.as_bytes();
    let len = configured.len().max(provided.len());
    let mut diff = configured.len() ^ provided.len();
    for index in 0..len {
        let left = configured.get(index).copied().unwrap_or(0);
        let right = provided.get(index).copied().unwrap_or(0);
        diff |= usize::from(left ^ right);
    }
    diff == 0
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

/// Serve the console page: the built Contract bundle's `index.html`.
///
/// @ref LLP 0017#serving-model — the built snapshot is served by the same Rust
/// server; missing assets report a capability diagnostic instead of falling
/// through to a second UI.
async fn console(State(ctx): State<Arc<ServerContext>>) -> Response {
    if let Some(dist) = &ctx.admin_dist
        && let Ok(bytes) = read_admin_asset(dist, "index.html").await
    {
        return ([(header::CONTENT_TYPE, "text/html; charset=utf-8")], bytes).into_response();
    }
    (
        StatusCode::SERVICE_UNAVAILABLE,
        [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
        MISSING_ADMIN_DIST_HTML,
    )
        .into_response()
}

/// Serve the embedded setup wizard (`/_snapback/admin/setup`) — system-static
/// shell; every fact it shows and every write it makes goes through the gated
/// `/_snapback/api/config/*` lane.
async fn setup() -> Response {
    Html(SETUP_HTML).into_response()
}

/// Serve a static asset of the built console bundle (`/_snapback/admin/<path>`).
/// Only active when a dist is configured.
async fn console_asset(
    State(ctx): State<Arc<ServerContext>>,
    Path(path): Path<String>,
) -> Response {
    if !safe_admin_asset_path(&path) {
        return StatusCode::NOT_FOUND.into_response();
    }
    // The shared admin client stays embedded so external tooling has a stable
    // module URL, and a dist cannot shadow the package source the Contract
    // admin-ui bundles.
    if path == "client.mjs" {
        return (
            [(header::CONTENT_TYPE, "text/javascript; charset=utf-8")],
            ADMIN_CLIENT_MJS,
        )
            .into_response();
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
    match read_admin_asset(dist, &path).await {
        Ok(bytes) => ([(header::CONTENT_TYPE, content_type_for(&path))], bytes).into_response(),
        Err(_) if exact_artifact => diagnostic_response(
            StatusCode::BAD_REQUEST,
            crate::contract_exact::native_artifact_missing(&path),
        ),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

fn safe_admin_asset_path(path: &str) -> bool {
    // Backslashes are path separators on Windows even though URL paths use
    // `/`; rejecting them everywhere keeps the same traversal contract on all
    // build hosts. A drive prefix (`C:`) is rejected explicitly so a manifest
    // built/tested on Unix cannot become unsafe when the binary moves.
    if path.is_empty()
        || path.contains('\\')
        || path.split('/').any(|segment| {
            segment.is_empty()
                || segment == "."
                || segment == ".."
                || (segment.len() >= 2
                    && segment.as_bytes()[0].is_ascii_alphabetic()
                    && segment.as_bytes()[1] == b':')
        })
    {
        return false;
    }
    FsPath::new(path)
        .components()
        .all(|component| matches!(component, Component::Normal(_)))
}

async fn read_admin_asset(dist: &FsPath, path: &str) -> std::io::Result<Vec<u8>> {
    if !safe_admin_asset_path(path) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "admin asset path escapes the distribution root",
        ));
    }
    let root = tokio::fs::canonicalize(dist).await?;
    let target = tokio::fs::canonicalize(dist.join(path)).await?;
    if !target.starts_with(&root) || target == root {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "admin asset target escapes the distribution root",
        ));
    }
    tokio::fs::read(target).await
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
        binary: crate::identity::binary_identity(),
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
    // Actions leave the lock window and run detached under the watchdog
    // (ENG-23324); everything else runs under the lock as before.
    enum Routed {
        Done(Box<crate::local::FunctionRunResult>),
        Action(crate::local::AppActionStage),
    }
    let routed = {
        let name = name.clone();
        let input = input.clone();
        crate::server::with_snapback(&snapback, move |snapback| -> Result<Routed, ApiError> {
            // A mutation is a write; a query (or unknown function) is a read.
            let write = matches!(
                snapback.function_kind(&name),
                Some(FunctionKind::Mutation | FunctionKind::Action)
            );
            authorize(&ctx, &headers, write)?;
            if matches!(snapback.function_kind(&name), Some(FunctionKind::Action)) {
                return Ok(match snapback.stage_app_action(&name) {
                    crate::local::StagedAppAction::Done(result) => Routed::Done(result),
                    crate::local::StagedAppAction::Ready(stage) => Routed::Action(stage),
                });
            }
            Ok(Routed::Done(Box::new(snapback.run_function(&name, input))))
        })
        .await?
    };
    let result = match routed {
        Routed::Done(result) => *result,
        Routed::Action(stage) => {
            crate::server::run_staged_app_action(&snapback, &name, input, stage, "admin").await
        }
    };
    Ok(Json(result))
}

async fn admin_cron_tick(
    State(snapback): State<SharedSnapback>,
    State(ctx): State<Arc<ServerContext>>,
    headers: HeaderMap,
) -> Result<Json<Vec<crate::cron::CronRunRecord>>, ApiError> {
    authorize(&ctx, &headers, true)?;
    let now = now_millis();
    // Detached flow (ENG-23324): claims and finishes take the lock; the
    // action runs themselves execute off it.
    let runs = crate::server::cron_tick_detached(&snapback, now).await?;
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
    let claim = {
        let name = name.clone();
        crate::server::with_snapback(&snapback, move |snapback| {
            snapback.claim_manual_cron_run(&name, now)
        })
        .await?
    };
    let record = crate::server::execute_cron_claim_detached(&snapback, claim).await?;
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
    fn profile_resolution_fails_closed_on_unrecognized_values() {
        // Exact matches win, on either bind.
        assert_eq!(resolve_profile(Some("dev"), true), ServerProfile::Dev);
        assert_eq!(resolve_profile(Some("demo"), false), ServerProfile::Demo);
        assert_eq!(resolve_profile(Some("test"), true), ServerProfile::Test);
        assert_eq!(resolve_profile(Some("prod"), true), ServerProfile::Prod);

        // ENG-22527 FIX 3: any unrecognized NON-EMPTY value fails CLOSED to
        // Prod even on loopback — a typo must never grant provisioning.
        for typo in ["production", "PROD", "Dev", "staging", "prd", "true"] {
            assert_eq!(
                resolve_profile(Some(typo), true),
                ServerProfile::Prod,
                "unrecognized profile {typo:?} must fail closed to Prod"
            );
            assert!(
                !resolve_profile(Some(typo), true).allows_provisioning(),
                "unrecognized profile {typo:?} must not allow provisioning"
            );
        }

        // Unset or empty falls back to the bind-address default.
        assert_eq!(resolve_profile(None, true), ServerProfile::Dev);
        assert_eq!(resolve_profile(Some(""), true), ServerProfile::Dev);
        assert_eq!(resolve_profile(None, false), ServerProfile::Prod);
        assert_eq!(resolve_profile(Some(""), false), ServerProfile::Prod);
    }

    #[test]
    fn explicit_admin_dist_wins_over_checkout_default() {
        assert_eq!(
            resolve_admin_dist(
                Some(OsString::from("/tmp/explicit-admin-dist")),
                Some(PathBuf::from("/tmp/default-admin-dist")),
            ),
            Some(PathBuf::from("/tmp/explicit-admin-dist"))
        );
    }

    #[test]
    fn missing_or_empty_admin_dist_uses_checkout_default_when_present() {
        assert_eq!(
            resolve_admin_dist(None, Some(PathBuf::from("/tmp/default-admin-dist"))),
            Some(PathBuf::from("/tmp/default-admin-dist"))
        );
        assert_eq!(
            resolve_admin_dist(
                Some(OsString::from("")),
                Some(PathBuf::from("/tmp/default-admin-dist")),
            ),
            Some(PathBuf::from("/tmp/default-admin-dist"))
        );
    }

    #[test]
    fn missing_admin_dist_without_checkout_default_stays_unconfigured() {
        assert_eq!(resolve_admin_dist(None, None), None);
    }

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
    fn admin_token_compare_requires_exact_match() {
        assert!(token_eq("secret-token", "secret-token"));
        assert!(!token_eq("secret-token", "secret-tokem"));
        assert!(!token_eq("secret-token", "secret-token-extra"));
        assert!(!token_eq("secret-token", "secret"));
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
    fn explicit_env_token_wins_and_mints_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("app.sqlite3.admin-token");
        let resolved =
            resolve_serve_admin_token(Some("from-env".to_owned()), Some(file.clone())).unwrap();
        assert_eq!(resolved.token, "from-env");
        assert!(!resolved.minted);
        assert!(!resolved.fresh);
        assert_eq!(resolved.file, None);
        assert!(!file.exists(), "env token must not create a token file");
    }

    #[test]
    fn minted_token_persists_owner_only_and_is_stable_across_restarts() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("app.sqlite3.admin-token");

        let first = resolve_serve_admin_token(None, Some(file.clone())).unwrap();
        assert!(first.minted && first.fresh);
        assert!(first.token.starts_with("sbat_"));
        assert_eq!(first.file.as_deref(), Some(file.as_path()));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            let mode = std::fs::metadata(&file).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600, "token file must be owner-readable only");
        }

        // A restart loads the same capability instead of rotating it.
        let second = resolve_serve_admin_token(None, Some(file.clone())).unwrap();
        assert!(second.minted && !second.fresh);
        assert_eq!(second.token, first.token);
    }

    #[cfg(unix)]
    #[test]
    fn existing_token_file_is_repaired_and_symlinks_are_refused() {
        use std::os::unix::fs::PermissionsExt as _;

        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("token");
        std::fs::write(&file, b"sbat_existing\n").unwrap();
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o644)).unwrap();
        let resolved = resolve_serve_admin_token(None, Some(file.clone())).unwrap();
        assert_eq!(resolved.token, "sbat_existing");
        assert_eq!(std::fs::metadata(&file).unwrap().permissions().mode() & 0o777, 0o600);

        let target = dir.path().join("target");
        let link = dir.path().join("link");
        std::fs::write(&target, b"sbat_target\n").unwrap();
        std::os::unix::fs::symlink(&target, &link).unwrap();
        assert!(resolve_serve_admin_token(None, Some(link)).is_err());
        assert_eq!(std::fs::read_to_string(target).unwrap(), "sbat_target\n");
    }

    #[test]
    fn blank_token_file_is_re_minted_and_no_file_means_ephemeral() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("app.sqlite3.admin-token");
        std::fs::write(&file, "  \n").unwrap();
        let resolved = resolve_serve_admin_token(None, Some(file.clone())).unwrap();
        assert!(resolved.minted && resolved.fresh);
        assert!(!resolved.token.trim().is_empty());

        // No file path (in-memory, no ready file): a per-process token, never
        // absent — the regression ENG-23443 guards against is a tokenless
        // served instance.
        let a = resolve_serve_admin_token(None, None).unwrap();
        let b = resolve_serve_admin_token(None, None).unwrap();
        assert!(a.minted && a.fresh && a.file.is_none());
        assert_ne!(a.token, b.token);
    }

    #[test]
    fn token_sibling_mirrors_the_lock_sibling_convention() {
        assert_eq!(
            admin_token_sibling(std::path::Path::new("/data/app.sqlite3")),
            PathBuf::from("/data/app.sqlite3.admin-token")
        );
        assert_eq!(
            admin_token_sibling(std::path::Path::new("ready.json")),
            PathBuf::from("ready.json.admin-token")
        );
    }

    #[test]
    fn admin_asset_paths_reject_cross_platform_root_components() {
        assert!(safe_admin_asset_path("assets/app.js"));
        for unsafe_path in [
            "../secret",
            "assets/../secret",
            "assets\\..\\secret",
            "C:\\secret",
            "//server/share",
            "assets//app.js",
        ] {
            assert!(
                !safe_admin_asset_path(unsafe_path),
                "{unsafe_path:?} must be rejected"
            );
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn admin_asset_reader_refuses_symlinks_that_escape_the_dist() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let secret = outside.path().join("secret.txt");
        std::fs::write(&secret, b"outside").unwrap();
        std::os::unix::fs::symlink(&secret, root.path().join("escape.txt")).unwrap();

        let error = read_admin_asset(root.path(), "escape.txt")
            .await
            .expect_err("an escaping symlink must not be served");
        assert_eq!(error.kind(), std::io::ErrorKind::PermissionDenied);
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
