//! Admin console and headless admin API.
//!
//! @ref LLP 0017#serving-model — the same Snapback server that owns the app
//! instance serves the admin API and the packaged web console; no separate Vite
//! server is required to inspect a running instance.
//! @ref LLP 0017#headless-admin-contract — the admin facts extend the inspect
//! state rather than forking a parallel schema; the console is one consumer.

use crate::admin_impersonation::ImpersonationCapabilityRegistry;
use crate::admin_secret_read::{
    SECRET_READ_LEASE_HEADER, SecretReadLeaseRegistry, SecretReadMintBridge, SecretReadOperator,
    SecretReadScope, VerifiedSecretReadMint,
};
use crate::auth::admission::{AdmissionLease, AuthAdmissionController};
use crate::auth::invocation::PreparedAuthority;
use crate::auth::lease::AuthorizedLeaseConfig;
use crate::auth::mode::{AuthModeStateRecord, AuthProgramReadiness};
use crate::auth::provider::AuthProvider;
use crate::auth::runtime::{AuthProviderHealth, AuthRuntime};
use crate::diagnostic::SnapbackError;
use crate::local::{EphemeralApi, InspectState, LocalSnapback, ReadLane};
use crate::manifest::{AuthMode, FunctionKind, HandlerInput};
use crate::runtime::CapabilityState;
use crate::server::{
    ApiError, AuthTerminalLifecycle, ConnectionRegistry, EffectPolicy, HealthResponse,
    InvocationAuthority, PolicyAuthMode, PolicyAuthPosture, RegisteredRoute, ResponseSensitivity,
    RoutePolicy, SessionModeOverlay, SharedSnapback, committed_mode_terminal_reason,
    static_public_content_security_policy, system_api_route, system_static_route,
};
use anyhow::Context as _;
use axum::Json;
use axum::extract::{Extension, FromRef, Path, Query, State};
use axum::http::{HeaderMap, HeaderName, StatusCode, header};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::{get, post};
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};
use std::collections::{BTreeSet, HashMap};
use std::ffi::OsString;
use std::fmt;
use std::path::{Component, Path as FsPath, PathBuf};
use std::sync::{Arc, Mutex as StdMutex, RwLock as StdRwLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
#[cfg(unix)]
use std::{
    ffi::{CString, OsStr},
    fs::{File, OpenOptions},
    os::{
        fd::{AsRawFd as _, FromRawFd as _},
        unix::{ffi::OsStrExt as _, fs::OpenOptionsExt as _},
    },
};
#[cfg(unix)]
use tokio::io::AsyncReadExt as _;
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

/// One local-plaintext transport decision shared by pre-bind CLI composition
/// and request middleware used by embedded/test routers.
///
/// @ref LLP 0060#d1-plaintext-listener-fence — staging sessions is enough to
/// close a non-loopback plaintext listener; the dev override never applies to
/// either active or desired sessions.
pub(crate) fn validate_plaintext_auth_transport(
    loopback: bool,
    profile: ServerProfile,
    active: AuthMode,
    desired: AuthMode,
    allow_insecure_dev_auth: bool,
) -> Result<(), SnapbackError> {
    if loopback {
        return Ok(());
    }
    if active == AuthMode::Sessions || desired == AuthMode::Sessions {
        return Err(SnapbackError::error(
            "SNAPBACK_AUTH_TRANSPORT_INSECURE",
            "auth-mode",
            "desired or active sessions cannot serve app data on a plaintext non-loopback bind",
        ));
    }
    if profile == ServerProfile::Prod || !allow_insecure_dev_auth {
        return Err(SnapbackError::error(
            "SNAPBACK_AUTH_TRANSPORT_INSECURE",
            "auth-mode",
            "dev auth on a non-loopback listener requires the explicit non-production override",
        ));
    }
    Ok(())
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

    /// Resolve the profile from the concrete address startup will bind. The
    /// CLI resolves hostnames once before auth composition and binds this same
    /// address, so aliases cannot produce a pre-bind/post-bind policy split.
    pub(crate) fn for_bind_ip(address: std::net::IpAddr) -> Self {
        env_profile(address.is_loopback())
    }
}

/// Environment half of an operation's authority tuple. Every transport and
/// alias asks this same policy before invoking the operation core.
///
/// @ref LLP 0024#authority-tuple — dev-user impersonation and destructive
/// operations are profile-bounded capabilities regardless of transport;
/// collision rescue is narrower than the ordinary non-production set.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum OperationProfileRequirement {
    Any,
    NonProd,
    DevOrTest,
}

/// Admin half of a host operation's authority tuple. Multiplexed host-ops and
/// their dedicated route aliases resolve through this same table so transport
/// choice cannot silently strengthen or weaken the caller's requirement.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum OperationAuthorityRequirement {
    AdminRead,
    AdminWrite,
}

pub(crate) fn operation_authority_requirement(
    operation: &str,
    function_kind: Option<&FunctionKind>,
) -> OperationAuthorityRequirement {
    match crate::server::host_ops_operation_spec(operation, function_kind, false)
        .map(|spec| spec.path_policy)
    {
        Some(RoutePolicy::AdminRead) => OperationAuthorityRequirement::AdminRead,
        // Unknown/unbuilt operations and any policy this dev gate cannot
        // satisfy fail closed at the stronger endpoint gate.
        _ => OperationAuthorityRequirement::AdminWrite,
    }
}

/// One operation policy table shared by dedicated routes and multiplexed
/// host-ops. `has_dev_user` means the caller selected an app identity rather
/// than presenting hosted app authentication.
pub(crate) fn operation_profile_requirement(
    operation: &str,
    has_dev_user: bool,
) -> OperationProfileRequirement {
    match operation {
        "app.reset" | "app.ensure.provision" | "schema.load" | "functions.load" => {
            OperationProfileRequirement::NonProd
        }
        // The direct and multiplexed runners are developer/operator bypass
        // surfaces even when they project an anonymous handler input. Hosted
        // production invocation goes through the ordinary app-data gate.
        "function.run" | "auth.mintSession" => OperationProfileRequirement::NonProd,
        // Frozen LLP 0039 deliberately excludes demo from the below-manifest
        // collision-recovery authority, on both ordinary and recovery servers.
        "auth.rescueCollidingTable" => OperationProfileRequirement::DevOrTest,
        "function.explain" if has_dev_user => OperationProfileRequirement::NonProd,
        _ => OperationProfileRequirement::Any,
    }
}

pub(crate) fn operation_profile_diagnostic(
    profile: ServerProfile,
    operation: &str,
    requirement: OperationProfileRequirement,
) -> Option<crate::diagnostic::Diagnostic> {
    let allowed = match requirement {
        OperationProfileRequirement::Any => true,
        OperationProfileRequirement::NonProd => profile.allows_provisioning(),
        OperationProfileRequirement::DevOrTest => {
            matches!(profile, ServerProfile::Dev | ServerProfile::Test)
        }
    };
    if allowed {
        return None;
    }
    let allowed_profiles = match requirement {
        OperationProfileRequirement::Any => unreachable!("allowed requirements returned above"),
        OperationProfileRequirement::NonProd => "dev|demo|test",
        OperationProfileRequirement::DevOrTest => "dev|test",
    };
    Some(crate::diagnostic::Diagnostic::error(
        "SNAPBACK_PROFILE_FORBIDS",
        "admin",
        format!(
            "{operation} is not available under the '{}' profile; set SNAPBACK_PROFILE={allowed_profiles} to enable it",
            profile.as_str(),
        ),
    ))
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

/// Browser-safe administrator capability lifetime. The credential is both
/// process-bound and short-lived; the master credential is used only for the
/// exchange request and never needs to enter browser storage.
const CONSOLE_CREDENTIAL_TTL: Duration = Duration::from_secs(10 * 60);
const MAX_CONSOLE_CREDENTIALS: usize = 256;

/// In-memory registry of derived console credentials. These credentials can
/// satisfy ordinary AdminRead/AdminWrite policy only. Stronger resolvers such
/// as AdminSecretRead and impersonation deliberately use distinct carriers
/// and never consult this registry.
///
/// @ref LLP 0017#security-defaults — the browser persists a narrowly-scoped,
/// short-lived console capability instead of the master admin credential.
#[derive(Clone, Default)]
pub struct ConsoleCredentialRegistry {
    entries: Arc<StdMutex<HashMap<[u8; 32], Instant>>>,
}

impl fmt::Debug for ConsoleCredentialRegistry {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let active_entries = self
            .entries
            .lock()
            .unwrap_or_else(|lock| lock.into_inner())
            .len();
        formatter
            .debug_struct("ConsoleCredentialRegistry")
            .field("active_entries", &active_entries)
            .finish()
    }
}

impl ConsoleCredentialRegistry {
    fn mint(&self) -> ConsoleCredentialResponse {
        let now = Instant::now();
        let mut entries = self.entries.lock().unwrap_or_else(|lock| lock.into_inner());
        entries.retain(|_, expires_at| *expires_at > now);
        if entries.len() >= MAX_CONSOLE_CREDENTIALS
            && let Some(oldest) = entries
                .iter()
                .min_by_key(|(_, expires_at)| **expires_at)
                .map(|(digest, _)| *digest)
        {
            entries.remove(&oldest);
        }
        let credential = format!("sbcc_{}", uuid::Uuid::new_v4().simple());
        entries.insert(
            console_credential_digest(&credential),
            now + CONSOLE_CREDENTIAL_TTL,
        );
        ConsoleCredentialResponse {
            credential,
            expires_at_ms: now_millis().saturating_add(CONSOLE_CREDENTIAL_TTL.as_millis() as u64),
        }
    }

    fn allows(&self, credential: Option<&str>) -> bool {
        let Some(credential) = credential else {
            return false;
        };
        let now = Instant::now();
        let mut entries = self.entries.lock().unwrap_or_else(|lock| lock.into_inner());
        entries.retain(|_, expires_at| *expires_at > now);
        entries.contains_key(&console_credential_digest(credential))
    }
}

fn console_credential_digest(credential: &str) -> [u8; 32] {
    Sha256::digest(credential.as_bytes()).into()
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConsoleCredentialResponse {
    credential: String,
    expires_at_ms: u64,
}

impl fmt::Debug for ConsoleCredentialResponse {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ConsoleCredentialResponse")
            .field("credential", &"[REDACTED]")
            .field("expires_at_ms", &self.expires_at_ms)
            .finish()
    }
}

/// Server-runtime facts that live outside `LocalSnapback` (it does not know the
/// socket it is served on) and the admin authorization configuration.
#[derive(Clone)]
pub struct ServerContext {
    pub host: String,
    pub port: u16,
    pub loopback: bool,
    pub profile: ServerProfile,
    /// Must-understand exposure requested at process composition. The local
    /// target can satisfy only `local`; `hosted` is rejected before bind and
    /// repeated by request middleware for embedded composition.
    pub auth_deployment: crate::auth::deployment::AuthDeploymentTarget,
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
    /// Process-local, short-lived browser capabilities derived from the master
    /// admin token. This registry never grants secret-read or impersonation.
    pub console_credentials: ConsoleCredentialRegistry,
    /// Directory of a built static console bundle (`SNAPBACK_ADMIN_DIST`, or the
    /// repo-local `admin-ui/dist` when it has already been built). When present,
    /// the Contract console is served from here; otherwise `/_snapback/admin`
    /// returns an explicit missing-dist diagnostic.
    ///
    /// @ref LLP 0017#serving-model — serve a built `admin/dist` snapshot when
    /// present; the admin UI has a single Contract/Exact implementation.
    pub admin_dist: Option<PathBuf>,
}

impl fmt::Debug for ServerContext {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ServerContext")
            .field("host", &self.host)
            .field("port", &self.port)
            .field("loopback", &self.loopback)
            .field("profile", &self.profile)
            .field("auth_deployment", &self.auth_deployment)
            .field("pid", &self.pid)
            .field("started_at_ms", &self.started_at_ms)
            .field("admin_token_configured", &self.admin_token.is_some())
            .field("admin_token_minted", &self.admin_token_minted)
            .field(
                "admin_token_file_configured",
                &self.admin_token_file.is_some(),
            )
            .field("console_credentials", &self.console_credentials)
            .field("admin_dist_configured", &self.admin_dist.is_some())
            .finish()
    }
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
            auth_deployment: crate::auth::deployment::AuthDeploymentTarget::Local,
            pid: std::process::id(),
            started: Instant::now(),
            started_at_ms: now_millis(),
            admin_token: env_admin_token(),
            admin_token_minted: false,
            admin_token_file: None,
            console_credentials: ConsoleCredentialRegistry::default(),
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
            auth_deployment: crate::auth::deployment::AuthDeploymentTarget::Local,
            pid: std::process::id(),
            started: Instant::now(),
            started_at_ms: now_millis(),
            admin_token: env_admin_token(),
            admin_token_minted: false,
            admin_token_file: None,
            console_credentials: ConsoleCredentialRegistry::default(),
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

    pub fn with_auth_deployment(
        mut self,
        deployment: crate::auth::deployment::AuthDeploymentTarget,
    ) -> Self {
        self.auth_deployment = deployment;
        self
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
#[derive(Clone)]
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

impl fmt::Debug for ResolvedAdminToken {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ResolvedAdminToken")
            .field("token", &"[REDACTED]")
            .field("minted", &self.minted)
            .field("fresh", &self.fresh)
            .field("file_configured", &self.file.is_some())
            .finish()
    }
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
    resolve_serve_admin_token_with_io(
        env_token,
        token_file,
        crate::secure_file::read_owner_only,
        crate::secure_file::write_owner_only,
    )
}

pub(crate) fn resolve_serve_admin_token_with_io<ReadFile, WriteFile>(
    env_token: Option<String>,
    token_file: Option<PathBuf>,
    read_file: ReadFile,
    write_file: WriteFile,
) -> anyhow::Result<ResolvedAdminToken>
where
    ReadFile: Fn(&std::path::Path) -> std::io::Result<Vec<u8>>,
    WriteFile: Fn(&std::path::Path, &[u8]) -> std::io::Result<()>,
{
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
    match read_file(&path) {
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
    write_file(&path, format!("{token}\n").as_bytes())
        .with_context(|| format!("failed to write admin token file {}", path.display()))?;
    Ok(ResolvedAdminToken {
        token,
        minted: true,
        fresh: true,
        file: Some(path),
    })
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
struct AuthModeRuntimeSnapshot {
    state: Arc<AuthModeStateRecord>,
    active_policy: PolicyAuthMode,
    desired_policy: PolicyAuthMode,
}

#[derive(Clone)]
pub struct AppState {
    pub snapback: SharedSnapback,
    pub read: ReadLane,
    pub ephemeral: EphemeralApi,
    pub server: Arc<ServerContext>,
    /// Per-connection capability grants (ENG-23442): connection-scoped routes
    /// demand the token minted by `POST /connection/open`.
    pub connections: ConnectionRegistry,
    /// Terminal invalidation shares the exact registry and delivery notifier
    /// installed in this app state. The pre-bind expiry worker receives a
    /// clone, so readiness cannot accidentally describe a different graph.
    pub(crate) auth_terminal_lifecycle: AuthTerminalLifecycle,
    /// Clone-shared mode authority. A network stage/re-stage publishes the
    /// committed durable record and its derived active/desired policy inputs
    /// as one write before returning success.
    auth_mode_runtime: Arc<StdRwLock<AuthModeRuntimeSnapshot>>,
    /// Positive build/process facts used by both activation and the bootstrap
    /// availability matrix. The derived activation bit is validated at install.
    pub(crate) auth_program_readiness: Arc<AuthProgramReadiness>,
    /// Exact clone of the app instance's managed admission controller. HTTP,
    /// runtime, cron, and staged-mode publication therefore count and retire
    /// roots in one process-local epoch domain.
    pub(crate) auth_admission: AuthAdmissionController,
    /// Public process identity bound to ready-file/operator sidecars and echoed
    /// by the bootstrap handshake. It is captured once so one response cannot
    /// accidentally combine facts from different startup identities.
    pub(crate) server_startup_nonce: Arc<str>,
    /// CLI-only, process-local opt-in for exposing dev body authority on a
    /// non-loopback bind. Production profiles never honor this bit.
    pub(crate) allow_insecure_dev_auth: bool,
    /// Digest-only registry for reset-bounded administrative data leases.
    pub secret_reads: SecretReadLeaseRegistry,
    /// Present only for a serve process with a validated ready-file sibling.
    /// Middleware admits a mint only after AdminWrite and a one-shot HMAC
    /// proof; the root itself is never an HTTP credential or response value.
    /// This v0 bridge is intentionally ready-file-only; staged mode activation
    /// must refuse sessions when it is absent rather than enabling decorative,
    /// unmintable secret-read authority (owned by item 4).
    pub(crate) secret_read_mint: Option<Arc<SecretReadMintBridge>>,
    /// Digest-only request-side half of the per-process impersonation
    /// capability. The non-cloneable raw operator half never enters router
    /// state and is consumed by readiness/terminal publication.
    pub(crate) impersonation_capabilities: Option<ImpersonationCapabilityRegistry>,
    /// Optional email-code provider projection. Startup activation is owned by
    /// the staged-mode composition lane; embeddings and tests may install an
    /// already-activated provider through the builder below.
    pub(crate) auth_provider: Option<Arc<AuthProvider>>,
    /// Item-5 process authority. Production construction publishes this only
    /// after the durable stream migration and complete pre-bind rebuild.
    pub(crate) auth_coordinator: Option<Arc<crate::auth::coordinator::AuthCoordinator>>,
    /// Whether startup observed an exact ReadyV1 catalog. Keyring readiness is
    /// intentionally revalidated on every health projection.
    pub(crate) auth_catalog_ready: bool,
    /// Authenticated boot identity installed before listener bind. Its absence
    /// keeps session-mode auth-scoped live admission fail-closed.
    /// Clone-shared current boot issuer. Destructive reset rotates the durable
    /// authorization incarnation while the listener stays alive, so the
    /// successor issuer must replace the startup issuer for every router
    /// clone before the coordinator reopens publication.
    pub(crate) auth_invalidation:
        Arc<StdRwLock<Option<crate::auth::invalidation::LiveInvalidationIssuer>>>,
    /// Validated per-app lease duration. Construction rejects zero or values
    /// above the protocol hard maximum; the handshake projects this exact
    /// value only when authorized-lease readiness is true.
    pub(crate) authorized_lease_config: AuthorizedLeaseConfig,
    /// One-shot test seam for a failure after durable mode commit but before
    /// the clone-shared request projection is installed.
    #[cfg(test)]
    fail_auth_mode_publication: Arc<std::sync::atomic::AtomicBool>,
    /// Deterministic server-level coverage for unsplittable projection
    /// handling without allocating a 64 MiB test response.
    #[cfg(test)]
    pub(crate) projection_handoff_limit_for_test: usize,
}

impl AppState {
    pub fn new(
        snapback: SharedSnapback,
        read: ReadLane,
        ephemeral: EphemeralApi,
        server: ServerContext,
    ) -> Self {
        Self::new_with_secret_read_operator(snapback, read, ephemeral, server).0
    }

    /// Trusted embedding seam for operator-plane lease minting. The returned
    /// capability is never placed in router state or accepted by a handler.
    pub(crate) fn new_with_secret_read_operator(
        snapback: SharedSnapback,
        read: ReadLane,
        ephemeral: EphemeralApi,
        server: ServerContext,
    ) -> (Self, SecretReadOperator) {
        let (secret_reads, operator) =
            SecretReadLeaseRegistry::new(read.secret_read_reset_generation());
        let auth_admission = read.admission_controller();
        let connections = ConnectionRegistry::default();
        let auth_terminal_lifecycle =
            AuthTerminalLifecycle::new(connections.clone(), &ephemeral, snapback.clone());
        (
            Self {
                snapback,
                read,
                ephemeral,
                server: Arc::new(server),
                connections,
                auth_terminal_lifecycle,
                auth_mode_runtime: Arc::new(StdRwLock::new(AuthModeRuntimeSnapshot {
                    state: Arc::new(AuthModeStateRecord::initial_dev(None)),
                    active_policy: PolicyAuthMode::Dev,
                    desired_policy: PolicyAuthMode::Dev,
                })),
                auth_program_readiness: Arc::new(AuthProgramReadiness::item4(false)),
                auth_admission,
                server_startup_nonce: Arc::from(
                    crate::identity::binary_identity()
                        .startup_nonce
                        .into_boxed_str(),
                ),
                allow_insecure_dev_auth: false,
                secret_reads,
                secret_read_mint: None,
                impersonation_capabilities: None,
                auth_provider: None,
                auth_coordinator: None,
                auth_catalog_ready: false,
                auth_invalidation: Arc::new(StdRwLock::new(None)),
                authorized_lease_config: AuthorizedLeaseConfig::default(),
                #[cfg(test)]
                fail_auth_mode_publication: Arc::new(std::sync::atomic::AtomicBool::new(false)),
                #[cfg(test)]
                projection_handoff_limit_for_test: crate::ephemeral::MAX_OUTBOX_HANDOFF_BYTES,
            },
            operator,
        )
    }

    pub(crate) fn with_secret_read_mint_bridge(mut self, bridge: SecretReadMintBridge) -> Self {
        self.secret_read_mint = Some(Arc::new(bridge));
        self
    }

    /// Install only the digest-bearing request-side registry. Startup keeps
    /// and consumes the separate operator half before serving requests.
    pub fn with_impersonation_capabilities(
        mut self,
        registry: ImpersonationCapabilityRegistry,
    ) -> Self {
        self.impersonation_capabilities = Some(registry);
        self
    }

    /// Install an already-constructed provider without changing auth-mode
    /// posture or performing catalog activation.
    pub fn with_auth_provider(mut self, provider: Arc<AuthProvider>) -> Self {
        let (coordinator, catalog_ready) = {
            let mut snapback = self
                .snapback
                .try_lock()
                .expect("trusted auth-provider builder owns the detached instance");
            let database = snapback.auth_database_mut();
            let incarnation = database
                .ensure_authorization_stream_incarnation()
                .expect("trusted auth-provider builder creates its stream");
            let catalog_ready = match database.inspect_auth_catalog() {
                Ok(state) => state.is_ready(),
                Err(error) if error.diagnostic.code == "SNAPBACK_AUTH_TABLE_COLLISION" => false,
                Err(error) => panic!("trusted auth-provider catalog inspection failed: {error:?}"),
            };
            let source = if catalog_ready {
                database
                    .session_projection_source()
                    .expect("trusted auth-provider builder reads a ready catalog")
            } else {
                crate::auth::session_projection::ProjectionSource {
                    authorization_stream_value:
                        crate::auth::session_projection::AuthorizationStreamRecord::new(incarnation)
                            .encode_bytes()
                            .expect("trusted auth-provider builder encodes its stream"),
                    restore_declaration_id: None,
                    users: Vec::new(),
                    identities: Vec::new(),
                    sessions: Vec::new(),
                    superseded_tokens: Vec::new(),
                }
            };
            let projection =
                crate::auth::session_projection::SessionProjection::rebuild_with_fresh_startup_id(
                    source,
                    provider.now_ms(),
                    provider.monotonic_now(),
                )
                .expect("trusted auth-provider builder publishes a valid projection");
            (
                Arc::new(
                    crate::auth::coordinator::AuthCoordinator::new(projection)
                        .expect("trusted auth-provider projection invariants"),
                ),
                catalog_ready,
            )
        };
        self.auth_provider = Some(provider);
        self.auth_coordinator = Some(coordinator);
        self.auth_catalog_ready = catalog_ready;
        self
    }

    /// Configure a shorter per-app authorization lease duration. This trusted
    /// startup/embedding seam returns a configuration error instead of
    /// silently clamping a value above the frozen 24-hour maximum.
    pub fn with_authorized_lease_duration_ms(
        mut self,
        configured_ms: u64,
    ) -> Result<Self, SnapbackError> {
        self.authorized_lease_config = AuthorizedLeaseConfig::new(configured_ms)?;
        Ok(self)
    }

    /// Install the validated pre-bind mode authority and readiness facts.
    ///
    /// @ref LLP 0058#activation-readiness-and-later-item-fences — readiness is
    /// server-owned and the activation bit is derived, never caller asserted.
    pub fn with_auth_runtime_facts(
        mut self,
        mode_state: AuthModeStateRecord,
        readiness: AuthProgramReadiness,
    ) -> Result<Self, SnapbackError> {
        mode_state.validate_shape()?;
        readiness.validate()?;
        self.auth_admission.synchronize_mode_state(&mode_state)?;
        let active_policy = mode_state.active.into();
        let desired_policy = mode_state.desired.into();
        self.auth_mode_runtime = Arc::new(StdRwLock::new(AuthModeRuntimeSnapshot {
            state: Arc::new(mode_state),
            active_policy,
            desired_policy,
        }));
        self.auth_program_readiness = Arc::new(readiness);
        Ok(self)
    }

    /// Test/embedding seam for a process identity supplied by a trusted
    /// launcher. Production serve paths use the binary identity default.
    pub fn with_server_startup_nonce(
        mut self,
        startup_nonce: impl Into<String>,
    ) -> Result<Self, SnapbackError> {
        let startup_nonce = startup_nonce.into();
        if startup_nonce.is_empty() {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
                "auth",
                "server startup nonce must be non-empty",
            ));
        }
        self.server_startup_nonce = Arc::from(startup_nonce.into_boxed_str());
        Ok(self)
    }

    /// Install the explicit CLI-only dangerous override. Middleware still
    /// ignores it under the production profile.
    pub fn with_insecure_dev_auth_override(mut self, allowed: bool) -> Self {
        self.allow_insecure_dev_auth = allowed;
        self
    }

    pub fn auth_mode_state(&self) -> Arc<AuthModeStateRecord> {
        self.auth_mode_runtime
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .state
            .clone()
    }

    /// Install a durable mode record while the caller still owns the closed
    /// admission transition. This deliberately does not reconcile the
    /// controller: the `ModeTransitionGuard` publishes that exact record only
    /// after every other process-local projection has succeeded.
    ///
    /// @ref LLP 0058#same-mode-provisioning — runtime mode state is part of the
    /// pre-reopen projection; a failed swap leaves admission closed.
    pub(crate) fn publish_auth_mode_state_while_transition_closed(
        &self,
        mode_state: AuthModeStateRecord,
    ) -> Result<(), SnapbackError> {
        #[cfg(test)]
        if self
            .fail_auth_mode_publication
            .swap(false, std::sync::atomic::Ordering::SeqCst)
        {
            return Err(SnapbackError::error(
                "TEST_AUTH_MODE_PUBLICATION_FAILURE",
                "auth",
                "injected post-commit auth-mode publication failure",
            ));
        }
        mode_state.validate_shape()?;
        let snapshot = AuthModeRuntimeSnapshot {
            active_policy: mode_state.active.into(),
            desired_policy: mode_state.desired.into(),
            state: Arc::new(mode_state),
        };
        *self
            .auth_mode_runtime
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = snapshot;
        Ok(())
    }

    /// Publish a record that was already committed by the durable mode store.
    /// Validation happens before the one clone-shared swap; no request can
    /// observe the new record with the old active/desired policy inputs.
    pub fn publish_auth_mode_state(
        &self,
        mode_state: AuthModeStateRecord,
    ) -> Result<(), SnapbackError> {
        #[cfg(test)]
        if self
            .fail_auth_mode_publication
            .swap(false, std::sync::atomic::Ordering::SeqCst)
        {
            return Err(SnapbackError::error(
                "TEST_AUTH_MODE_PUBLICATION_FAILURE",
                "auth",
                "injected post-commit auth-mode publication failure",
            ));
        }
        mode_state.validate_shape()?;
        let predecessor = self.auth_mode_state();
        let terminal_reason = committed_mode_terminal_reason(&predecessor, &mode_state);
        // The controller publishes/reconciles first. Requests can briefly see
        // a new closed epoch with the old durable projection (and fail
        // closed), but can never see a new durable mode under an old accepting
        // epoch.
        self.auth_admission.synchronize_mode_state(&mode_state)?;
        let snapshot = AuthModeRuntimeSnapshot {
            active_policy: mode_state.active.into(),
            desired_policy: mode_state.desired.into(),
            state: Arc::new(mode_state),
        };
        *self
            .auth_mode_runtime
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = snapshot;
        if let Some(reason) = terminal_reason {
            let close_by = Instant::now()
                .checked_add(Duration::from_millis(5_000))
                .unwrap_or_else(Instant::now);
            self.auth_terminal_lifecycle
                .committed_mode_transition(reason, close_by);
        }
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn inject_auth_mode_publication_failure(&self) {
        assert!(
            !self
                .fail_auth_mode_publication
                .swap(true, std::sync::atomic::Ordering::SeqCst),
            "auth-mode publication failure hook must be one-shot"
        );
    }

    pub(crate) fn projection_handoff_limit(&self) -> usize {
        #[cfg(test)]
        {
            self.projection_handoff_limit_for_test
        }
        #[cfg(not(test))]
        {
            crate::ephemeral::MAX_OUTBOX_HANDOFF_BYTES
        }
    }

    #[cfg(test)]
    pub(crate) fn with_projection_handoff_limit_for_test(mut self, limit: usize) -> Self {
        self.projection_handoff_limit_for_test =
            limit.min(crate::ephemeral::MAX_OUTBOX_HANDOFF_BYTES);
        self
    }

    pub fn active_policy_auth_mode(&self) -> PolicyAuthMode {
        self.auth_mode_runtime
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .active_policy
    }

    pub fn desired_policy_auth_mode(&self) -> PolicyAuthMode {
        self.auth_mode_runtime
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .desired_policy
    }

    pub fn auth_program_readiness(&self) -> &AuthProgramReadiness {
        self.auth_program_readiness.as_ref()
    }

    pub fn auth_admission_controller(&self) -> AuthAdmissionController {
        self.auth_admission.clone()
    }

    pub fn server_startup_nonce(&self) -> &str {
        self.server_startup_nonce.as_ref()
    }

    /// Pre-bind transport validation used by the CLI composition lane. The
    /// request middleware repeats the same policy as defense in depth.
    ///
    /// @ref LLP 0060#d1-plaintext-listener-fence — this local listener check
    /// does not attest a public reverse proxy or any hosted edge capability.
    pub fn validate_auth_transport(&self) -> Result<(), SnapbackError> {
        let state = self.auth_mode_state();
        let posture = self.policy_auth_posture();
        let active =
            if state.active == AuthMode::Sessions || posture.active == PolicyAuthMode::Sessions {
                AuthMode::Sessions
            } else {
                AuthMode::Dev
            };
        let desired =
            if state.desired == AuthMode::Sessions || posture.desired == PolicyAuthMode::Sessions {
                AuthMode::Sessions
            } else {
                AuthMode::Dev
            };
        validate_plaintext_auth_transport(
            self.server.loopback,
            self.server.profile,
            active,
            desired,
            self.allow_insecure_dev_auth,
        )
    }

    /// Install the exact provider instance and readiness posture assembled
    /// before listener bind. Catalog activation is intentionally not part of
    /// this builder.
    pub(crate) fn with_auth_runtime(
        mut self,
        runtime: &AuthRuntime,
        coordinator: Arc<crate::auth::coordinator::AuthCoordinator>,
    ) -> Self {
        self.auth_provider = Some(runtime.provider());
        self.auth_coordinator = Some(coordinator);
        self.auth_catalog_ready = runtime.catalog_ready();
        self
    }

    pub(crate) fn with_auth_invalidation(
        self,
        issuer: crate::auth::invalidation::LiveInvalidationIssuer,
    ) -> Self {
        self.connections.install_invalidation_issuer(issuer.clone());
        *self
            .auth_invalidation
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(issuer);
        self
    }

    /// Publish a reset successor only after its durable reservation and
    /// authenticated LocalSnapback projection have both succeeded.
    pub(crate) fn install_reset_auth_invalidation(
        &self,
        issuer: crate::auth::invalidation::LiveInvalidationIssuer,
    ) {
        self.connections.install_invalidation_issuer(issuer.clone());
        *self
            .auth_invalidation
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(issuer);
    }

    pub(crate) fn clear_reset_auth_invalidation(&self) {
        self.connections.clear_invalidation_issuer();
        *self
            .auth_invalidation
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = None;
    }

    pub fn auth_provider_health(&self) -> AuthProviderHealth {
        if !self.auth_catalog_ready {
            return AuthProviderHealth::Dormant;
        }
        match self
            .auth_provider
            .as_ref()
            .map(|provider| provider.readiness())
        {
            Some(crate::auth::provider::AuthProviderReadiness::Available) => {
                AuthProviderHealth::Available
            }
            Some(crate::auth::provider::AuthProviderReadiness::Unavailable) | None => {
                AuthProviderHealth::Unavailable
            }
        }
    }

    /// Select an auth-policy mode for an embedded runtime. Production callers
    /// keep the `Dev` constructor default until the staged resolver lands;
    /// registry acceptance uses this seam to execute the closed sessions
    /// overlay against the actual router.
    pub fn with_policy_auth_mode(self, mode: PolicyAuthMode) -> Self {
        {
            let mut snapshot = self
                .auth_mode_runtime
                .write()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            snapshot.active_policy = mode;
            snapshot.desired_policy = mode;
        }
        self
    }

    /// Install an explicit active/desired posture for embedded acceptance.
    /// Item 4 owns replacing this injection seam with persisted startup state.
    pub fn with_policy_auth_posture(self, active: PolicyAuthMode, desired: PolicyAuthMode) -> Self {
        {
            let mut snapshot = self
                .auth_mode_runtime
                .write()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            snapshot.active_policy = active;
            snapshot.desired_policy = desired;
        }
        self
    }

    pub fn policy_auth_posture(&self) -> PolicyAuthPosture {
        let snapshot = self
            .auth_mode_runtime
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        PolicyAuthPosture {
            active: snapshot.active_policy,
            desired: snapshot.desired_policy,
        }
    }

    /// Wrap a fresh instance: the read and ephemeral lanes are extracted
    /// before the instance disappears behind the write mutex.
    pub fn from_snapback(snapback: LocalSnapback, server: ServerContext) -> Self {
        let read = snapback.read_lane();
        let ephemeral = snapback.ephemeral_api();
        Self::new(Arc::new(Mutex::new(snapback)), read, ephemeral, server)
    }

    /// Trusted embedding variant that retains the non-network minting seam.
    pub fn from_snapback_with_secret_read_operator(
        snapback: LocalSnapback,
        server: ServerContext,
    ) -> (Self, SecretReadOperator) {
        let read = snapback.read_lane();
        let ephemeral = snapback.ephemeral_api();
        Self::new_with_secret_read_operator(Arc::new(Mutex::new(snapback)), read, ephemeral, server)
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

impl FromRef<AppState> for PolicyAuthMode {
    fn from_ref(state: &AppState) -> Self {
        state.active_policy_auth_mode()
    }
}

impl FromRef<AppState> for PolicyAuthPosture {
    fn from_ref(state: &AppState) -> Self {
        state.policy_auth_posture()
    }
}

impl FromRef<AppState> for SecretReadLeaseRegistry {
    fn from_ref(state: &AppState) -> Self {
        state.secret_reads.clone()
    }
}

impl FromRef<AppState> for AuthProviderHealth {
    fn from_ref(state: &AppState) -> Self {
        state.auth_provider_health()
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
    #[serde(rename = "actionWorkers")]
    pub action_workers: ActionWorkerStats,
}

/// Process-wide detached-action admission facts. These stay on the gated
/// admin inspect surface: operators can distinguish handler latency from
/// native-worker saturation without exposing process capacity anonymously.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ActionWorkerStats {
    pub active_workers: usize,
    pub admitted_workers: usize,
    pub worker_limit: usize,
    pub rejected_admissions: u64,
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
        let action_workers = ActionWorkerStats {
            active_workers: crate::server::detached_action_worker_count(),
            admitted_workers: crate::server::detached_action_admitted_count(),
            worker_limit: crate::server::detached_action_worker_limit(),
            rejected_admissions: crate::server::detached_action_rejection_count(),
        };
        Self {
            inspect,
            server,
            admin,
            action_workers,
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

/// Route-level environment gate: resolve the requirement through the shared
/// operation table, then enforce it in addition to AdminWrite.
pub(crate) fn require_operation_profile(
    ctx: &ServerContext,
    operation: &str,
    has_dev_user: bool,
) -> Result<(), crate::server::ApiError> {
    let requirement = operation_profile_requirement(operation, has_dev_user);
    match operation_profile_diagnostic(ctx.profile, operation, requirement) {
        None => Ok(()),
        Some(diagnostic) => Err(crate::diagnostic::SnapbackError::new(diagnostic).into()),
    }
}

pub(crate) fn authorize_operation(
    ctx: &ServerContext,
    headers: &HeaderMap,
    operation: &str,
    function_kind: Option<&FunctionKind>,
) -> Result<(), crate::server::ApiError> {
    let write = operation_authority_requirement(operation, function_kind)
        == OperationAuthorityRequirement::AdminWrite;
    authorize(ctx, headers, write)
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn authorize_host_operation(
    ctx: &ServerContext,
    headers: &HeaderMap,
    operation: &str,
    function_kind: Option<&FunctionKind>,
    impersonated: bool,
    mode: PolicyAuthMode,
    secret_reads: &SecretReadLeaseRegistry,
    impersonation: Option<&crate::admin_impersonation::VerifiedImpersonationCapability>,
) -> Result<(), crate::server::ApiError> {
    let Some(spec) = crate::server::host_ops_operation_spec(operation, function_kind, impersonated)
    else {
        // Authenticate at the stronger legacy floor before revealing that an
        // operation name is unknown, then refuse before the string dispatcher.
        authorize(ctx, headers, true)?;
        return Err(SnapbackError::error(
            "SNAPBACK_HOST_OP_UNKNOWN",
            "host-ops",
            "unknown or unregistered host operation",
        )
        .with_details(serde_json::json!({ "operation": "unrecognized" }))
        .into());
    };
    match impersonation {
        Some(verified) => {
            crate::server::authorize_operation_spec_with_secret_reads_and_impersonation(
                ctx,
                headers,
                spec,
                mode,
                secret_reads,
                verified,
            )
        }
        None => crate::server::authorize_operation_spec_with_secret_reads(
            ctx,
            headers,
            spec,
            mode,
            secret_reads,
        ),
    }
}

pub(crate) fn authorize_direct_runner(
    ctx: &ServerContext,
    headers: &HeaderMap,
    function_kind: Option<&FunctionKind>,
    mode: PolicyAuthMode,
    secret_reads: &SecretReadLeaseRegistry,
) -> Result<(), crate::server::ApiError> {
    let spec = crate::server::direct_runner_operation_spec(function_kind);
    crate::server::authorize_operation_spec_with_secret_reads(
        ctx,
        headers,
        spec,
        mode,
        secret_reads,
    )
}

pub(crate) fn reserve_secret_read_json<T: Serialize>(
    secret_reads: &SecretReadLeaseRegistry,
    headers: &HeaderMap,
    scopes: BTreeSet<SecretReadScope>,
    rows: usize,
    value: &T,
) -> Result<(), ApiError> {
    let bearer = headers
        .get(SECRET_READ_LEASE_HEADER)
        .and_then(|value| value.to_str().ok());
    let permit = secret_reads.authorize(bearer)?;
    let bytes = serde_json::to_vec(value).map_err(|error| {
        SnapbackError::error(
            "SNAPBACK_ADMIN_SECRET_READ_SERIALIZATION_FAILED",
            "admin-secret-read",
            format!("failed to measure the complete secret-read response: {error}"),
        )
    })?;
    secret_reads.reserve(
        &permit,
        &scopes,
        u64::try_from(rows).unwrap_or(u64::MAX),
        u64::try_from(bytes.len()).unwrap_or(u64::MAX),
    )?;
    Ok(())
}

pub(crate) fn preflight_secret_read(
    secret_reads: &SecretReadLeaseRegistry,
    headers: &HeaderMap,
    scopes: BTreeSet<SecretReadScope>,
) -> Result<(), ApiError> {
    let bearer = headers
        .get(SECRET_READ_LEASE_HEADER)
        .and_then(|value| value.to_str().ok());
    secret_reads.authorize_scopes(bearer, &scopes)?;
    Ok(())
}

fn function_run_secret_scopes(
    result: &crate::local::FunctionRunResult,
) -> BTreeSet<SecretReadScope> {
    let mut scopes = BTreeSet::from([SecretReadScope::FunctionRun(result.function.clone())]);
    scopes.extend(result.reads.iter().cloned().map(SecretReadScope::Table));
    scopes.extend(
        result
            .captured_reads
            .iter()
            .filter_map(|read| read.table.clone())
            .map(SecretReadScope::Table),
    );
    scopes
}

pub(crate) fn authorize(
    ctx: &ServerContext,
    headers: &HeaderMap,
    write: bool,
) -> Result<(), ApiError> {
    authorize_for_mode(ctx, headers, write, PolicyAuthMode::Dev)
}

/// Resolve ordinary administrator authority with mode-aware carrier rules.
/// `Authorization` remains a v0-dev compatibility spelling only. In sessions
/// it is reserved for the session bearer resolver, so admin authority must use
/// its explicit header (or the distinct derived console header).
pub(crate) fn authorize_for_mode(
    ctx: &ServerContext,
    headers: &HeaderMap,
    write: bool,
    mode: PolicyAuthMode,
) -> Result<(), ApiError> {
    if ctx
        .console_credentials
        .allows(provided_console_credential(headers))
    {
        return Ok(());
    }
    authorize_admin_access(ctx, headers, write, mode)
}

fn authorize_admin_access(
    ctx: &ServerContext,
    headers: &HeaderMap,
    write: bool,
    mode: PolicyAuthMode,
) -> Result<(), ApiError> {
    let provided = provided_token(headers, mode == PolicyAuthMode::Dev);
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

/// Resolve only an explicitly configured master administrator credential. The
/// console-credential exchange uses this stricter gate so a stolen derived
/// credential cannot mint a fresh lifetime for itself. Served loopback
/// instances always have a configured or auto-minted token; embedded tokenless
/// routers do not need a browser credential and cannot mint one.
fn authorize_master(
    ctx: &ServerContext,
    headers: &HeaderMap,
    mode: PolicyAuthMode,
) -> Result<(), ApiError> {
    // @ref LLP 0039#authority-resolution — sessions reserves Authorization
    // for a session bearer; even this master-only exchange uses the explicit
    // administrator carrier in that mode.
    let provided = provided_token(headers, mode == PolicyAuthMode::Dev);
    match (ctx.admin_token.as_deref(), provided.as_deref()) {
        (Some(configured), Some(candidate)) if token_eq(configured, candidate) => Ok(()),
        (None, _) if !ctx.loopback => Err(SnapbackError::error(
            "SNAPBACK_ADMIN_DISABLED",
            "admin",
            "admin API is disabled on this non-loopback bind without a valid admin token",
        )
        .into()),
        _ => Err(SnapbackError::error(
            "SNAPBACK_ADMIN_TOKEN_REQUIRED",
            "admin",
            "minting a console credential requires the configured master admin token",
        )
        .into()),
    }
}

fn provided_console_credential(headers: &HeaderMap) -> Option<&str> {
    headers
        .get("x-snapback-console-credential")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|credential| !credential.is_empty())
}

fn provided_token(headers: &HeaderMap, allow_authorization: bool) -> Option<String> {
    if let Some(token) = headers
        .get("x-snapback-admin-token")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|token| !token.is_empty())
    {
        return Some(token.to_owned());
    }
    allow_authorization.then_some(())?;
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

/// The Snapback-owned admin namespace. Metadata and handlers are paired in the
/// same values consumed by both `server::app()` and `route_registry()`.
///
/// @ref LLP 0017#serving-model — `/_snapback/*` is the reserved admin namespace.
/// @ref LLP 0031#enforcement — admin, static, and config routes share the same
/// router↔registry construction as root app-data routes.
pub(crate) fn admin_route_registrations() -> Vec<RegisteredRoute> {
    let read =
        |path, sensitivity| system_api_route("GET", path, RoutePolicy::AdminRead, sensitivity);
    let write = |method, path, sensitivity| {
        system_api_route(method, path, RoutePolicy::AdminWrite, sensitivity)
    };
    vec![
        RegisteredRoute::new(system_static_route("GET", "/_snapback/admin"), get(console)),
        RegisteredRoute::new(
            system_static_route("GET", "/_snapback/admin/"),
            get(console),
        ),
        RegisteredRoute::new(
            system_static_route("GET", "/_snapback/admin/setup"),
            get(setup),
        ),
        RegisteredRoute::new(
            system_static_route("GET", "/_snapback/admin/{*path}"),
            get(console_asset),
        ),
        RegisteredRoute::new(
            read(
                "/_snapback/api/health",
                ResponseSensitivity::OperatorMetadata,
            ),
            get(admin_health),
        ),
        RegisteredRoute::new(
            write(
                "POST",
                "/_snapback/api/console/credential",
                ResponseSensitivity::CredentialSecret,
            ),
            post(mint_console_credential),
        ),
        RegisteredRoute::new(
            write(
                "POST",
                "/_snapback/api/admin-secret-read/mint",
                ResponseSensitivity::CredentialSecret,
            )
            .with_effect(EffectPolicy::SecretReadMintProof),
            post(mint_secret_read_lease),
        ),
        RegisteredRoute::new(
            write(
                "GET",
                "/_snapback/api/inspect",
                ResponseSensitivity::SensitiveApplicationData,
            )
            .with_session_overlay(SessionModeOverlay::secret_read()),
            get(admin_inspect),
        ),
        RegisteredRoute::new(
            read(
                "/_snapback/api/receipts",
                ResponseSensitivity::SensitiveApplicationData,
            )
            .with_session_overlay(SessionModeOverlay::secret_read()),
            get(admin_receipts),
        ),
        RegisteredRoute::new(
            read(
                "/_snapback/api/data/{table}",
                ResponseSensitivity::SensitiveApplicationData,
            )
            .with_session_overlay(SessionModeOverlay::secret_read()),
            get(admin_data),
        ),
        // The route has an AdminRead floor. Query versus mutation/action is an
        // operation-level split retained by the handler and operation registry.
        RegisteredRoute::new(
            system_api_route(
                "POST",
                "/_snapback/api/functions/{name}/run",
                RoutePolicy::AdminRead,
                ResponseSensitivity::SensitiveApplicationData,
            )
            .with_effect(EffectPolicy::FunctionKind)
            .with_session_overlay(SessionModeOverlay {
                path_policy: None,
                credential_resolution: None,
                invocation_authority: None,
                legacy_body_policy: Some(crate::server::LegacyBodyPolicy::Rejected),
                effect_policy: None,
                response_sensitivity: None,
            }),
            post(admin_run_function),
        ),
        RegisteredRoute::new(
            write(
                "POST",
                "/_snapback/api/cron/tick",
                ResponseSensitivity::SensitiveApplicationData,
            )
            .with_invocation_authority(InvocationAuthority::System),
            post(admin_cron_tick),
        ),
        RegisteredRoute::new(
            write(
                "POST",
                "/_snapback/api/cron/{name}/run",
                ResponseSensitivity::SensitiveApplicationData,
            )
            .with_invocation_authority(InvocationAuthority::System),
            post(admin_run_cron_job),
        ),
        RegisteredRoute::new(
            write(
                "POST",
                "/_snapback/api/ephemeral/cleanup",
                ResponseSensitivity::OperatorMetadata,
            ),
            post(admin_ephemeral_cleanup),
        ),
    ]
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
        let digests = inline_script_sha256_digests(&bytes);
        let mut response =
            ([(header::CONTENT_TYPE, "text/html; charset=utf-8")], bytes).into_response();
        response.headers_mut().insert(
            HeaderName::from_static("content-security-policy"),
            static_public_content_security_policy(digests.iter().map(String::as_str)),
        );
        return response;
    }
    (
        StatusCode::SERVICE_UNAVAILABLE,
        [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
        MISSING_ADMIN_DIST_HTML,
    )
        .into_response()
}

/// Hash the exact inline script bytes in a built admin document. External
/// scripts normally have an empty body and need no hash; retaining only
/// non-empty bodies also admits the Exact manifest data block on engines that
/// apply `script-src` to non-executable script elements.
pub(crate) fn inline_script_sha256_digests(bytes: &[u8]) -> Vec<String> {
    let Ok(html) = std::str::from_utf8(bytes) else {
        return Vec::new();
    };
    let mut digests = Vec::new();
    let mut rest = html;
    while let Some(open_start) = rest.find("<script") {
        rest = &rest[open_start + "<script".len()..];
        let Some(open_end) = rest.find('>') else {
            break;
        };
        let body_and_suffix = &rest[open_end + 1..];
        let Some(close_start) = body_and_suffix.find("</script>") else {
            break;
        };
        let body = &body_and_suffix[..close_start];
        if !body.is_empty() {
            digests.push(
                base64::engine::general_purpose::STANDARD.encode(Sha256::digest(body.as_bytes())),
            );
        }
        rest = &body_and_suffix[close_start + "</script>".len()..];
    }
    digests
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

fn unsafe_admin_asset_error(message: &'static str) -> std::io::Error {
    std::io::Error::new(std::io::ErrorKind::PermissionDenied, message)
}

#[cfg(unix)]
fn openat_admin_component(parent: &File, name: &OsStr, directory: bool) -> std::io::Result<File> {
    let name = CString::new(name.as_bytes())
        .map_err(|_| unsafe_admin_asset_error("admin asset path contains a NUL byte"))?;
    let flags = libc::O_RDONLY
        | libc::O_CLOEXEC
        | libc::O_NOFOLLOW
        | if directory {
            libc::O_DIRECTORY
        } else {
            // Refuse to block on a substituted FIFO/device before fstat can
            // prove that the opened final object is a regular file.
            libc::O_NONBLOCK
        };
    // SAFETY: `parent` is a live directory descriptor, `name` is NUL-terminated,
    // and no creation flag is present (so openat takes no mode argument).
    let descriptor = unsafe { libc::openat(parent.as_raw_fd(), name.as_ptr(), flags) };
    if descriptor < 0 {
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() == Some(libc::ELOOP) {
            return Err(unsafe_admin_asset_error(
                "admin asset traversal refuses symbolic links",
            ));
        }
        return Err(error);
    }
    // SAFETY: openat returned a new owned descriptor on success.
    Ok(unsafe { File::from_raw_fd(descriptor) })
}

#[cfg(unix)]
fn open_admin_dist_capability(dist: &FsPath) -> std::io::Result<File> {
    // Resolve the configured root once, then never consult that path again.
    // Opening every component of the resulting absolute path with O_NOFOLLOW
    // means a concurrent path swap can only fail the capability acquisition;
    // it cannot redirect the descriptor outside the resolved root.
    let canonical = std::fs::canonicalize(dist)?;
    let mut directory = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_CLOEXEC | libc::O_NOFOLLOW)
        .open(FsPath::new("/"))?;
    for component in canonical.components() {
        match component {
            Component::RootDir | Component::CurDir => {}
            Component::Normal(name) => {
                directory = openat_admin_component(&directory, name, true)?;
            }
            Component::ParentDir | Component::Prefix(_) => {
                return Err(unsafe_admin_asset_error(
                    "admin distribution root is not an absolute normal path",
                ));
            }
        }
    }
    Ok(directory)
}

#[cfg(unix)]
fn open_admin_asset_with_hook(
    dist: &FsPath,
    path: &str,
    mut after_directory_open: impl FnMut(usize),
) -> std::io::Result<File> {
    // @ref LLP 0017#static-bundling-and-the-native-shell — containment and
    // reading are one descriptor-relative operation, not two path lookups.
    if !safe_admin_asset_path(path) {
        return Err(unsafe_admin_asset_error(
            "admin asset path escapes the distribution root",
        ));
    }
    let mut directory = open_admin_dist_capability(dist)?;
    after_directory_open(0);
    let components = path.split('/').collect::<Vec<_>>();
    for (index, component) in components.iter().enumerate() {
        let final_component = index + 1 == components.len();
        let opened = openat_admin_component(&directory, OsStr::new(component), !final_component)?;
        if final_component {
            if !opened.metadata()?.file_type().is_file() {
                return Err(unsafe_admin_asset_error(
                    "admin asset target is not a regular file",
                ));
            }
            return Ok(opened);
        }
        directory = opened;
        after_directory_open(index + 1);
    }
    Err(unsafe_admin_asset_error("admin asset path is empty"))
}

#[cfg(unix)]
async fn read_admin_asset(dist: &FsPath, path: &str) -> std::io::Result<Vec<u8>> {
    let dist = dist.to_owned();
    let path = path.to_owned();
    let file =
        tokio::task::spawn_blocking(move || open_admin_asset_with_hook(&dist, &path, |_| {}))
            .await
            .map_err(|error| {
                std::io::Error::other(format!("admin asset open task failed: {error}"))
            })??;
    let mut file = tokio::fs::File::from_std(file);
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).await?;
    Ok(bytes)
}

#[cfg(not(unix))]
async fn read_admin_asset(_dist: &FsPath, path: &str) -> std::io::Result<Vec<u8>> {
    if !safe_admin_asset_path(path) {
        return Err(unsafe_admin_asset_error(
            "admin asset path escapes the distribution root",
        ));
    }
    // Cross-platform guarantee: never fall back to canonicalize-then-read.
    // Until this target has a root-relative, no-reparse-point handle walk, its
    // filesystem-backed admin console fails closed; the headless admin API and
    // embedded setup/client assets remain available.
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "filesystem admin assets require a no-follow handle-relative backend on this platform",
    ))
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
            receipt: None,
        }),
    )
        .into_response()
}

async fn admin_health(
    State(snapback): State<SharedSnapback>,
    State(ctx): State<Arc<ServerContext>>,
    State(auth_provider): State<AuthProviderHealth>,
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
        auth_provider,
        binary: crate::identity::binary_identity(),
    }))
}

/// Exchange the master administrator token for the capability a browser may
/// persist. Even though registry middleware enforces the route's AdminWrite
/// floor, repeat the narrower master-only check here: console credentials are
/// intentionally non-renewable.
async fn mint_console_credential(
    State(ctx): State<Arc<ServerContext>>,
    State(policy_mode): State<PolicyAuthMode>,
    headers: HeaderMap,
) -> Result<Json<ConsoleCredentialResponse>, ApiError> {
    authorize_master(&ctx, &headers, policy_mode)?;
    Ok(Json(ctx.console_credentials.mint()))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SecretReadMintResponse {
    lease: String,
}

async fn mint_secret_read_lease(
    State(state): State<AppState>,
    Extension(verified): Extension<VerifiedSecretReadMint>,
    Extension(admission): Extension<AdmissionLease>,
) -> Result<Json<SecretReadMintResponse>, ApiError> {
    let bridge = state
        .secret_read_mint
        .as_ref()
        .ok_or_else(crate::admin_secret_read::mint_proof_required)?;
    let _effect = admission.effect_guard("secret-read lease mint publication")?;
    let lease = bridge.mint(verified)?;
    Ok(Json(SecretReadMintResponse {
        lease: lease.into_bearer(),
    }))
}

async fn admin_inspect(
    State(runtime): State<AppState>,
    State(snapback): State<SharedSnapback>,
    State(ctx): State<Arc<ServerContext>>,
    State(policy_mode): State<PolicyAuthMode>,
    State(secret_reads): State<SecretReadLeaseRegistry>,
    headers: HeaderMap,
) -> Result<Json<AdminInspect>, ApiError> {
    // This projection carries raw cron/recent diagnostics, handler results,
    // full function bodies, and the absolute minted-token path. It is a
    // sensitive administrative read and therefore requires the write-grade
    // bearer whenever one is configured; anonymous loopback callers use the
    // typed root `/inspect` projection instead.
    if policy_mode == PolicyAuthMode::Dev {
        authorize(&ctx, &headers, true)?;
    } else {
        preflight_secret_read(
            &secret_reads,
            &headers,
            BTreeSet::from([SecretReadScope::AdminInspect]),
        )?;
    }
    let mut inspect =
        crate::server::with_snapback(&snapback, |snapback| snapback.inspect()).await?;
    crate::server::project_auth_runtime_facts(&mut inspect, &runtime);
    let response = AdminInspect::assemble(inspect, &ctx);
    if policy_mode == PolicyAuthMode::Sessions {
        reserve_secret_read_json(
            &secret_reads,
            &headers,
            BTreeSet::from([SecretReadScope::AdminInspect]),
            0,
            &response,
        )?;
    }
    Ok(Json(response))
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
    State(policy_mode): State<PolicyAuthMode>,
    State(secret_reads): State<SecretReadLeaseRegistry>,
    headers: HeaderMap,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, crate::server::ApiError> {
    if policy_mode == PolicyAuthMode::Dev {
        authorize(&ctx, &headers, false)?;
    } else {
        preflight_secret_read(
            &secret_reads,
            &headers,
            BTreeSet::from([SecretReadScope::Receipts]),
        )?;
    }
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
    if policy_mode == PolicyAuthMode::Sessions {
        reserve_secret_read_json(
            &secret_reads,
            &headers,
            BTreeSet::from([SecretReadScope::Receipts]),
            0,
            &body,
        )?;
    }
    Ok(Json(body))
}

async fn admin_data(
    State(snapback): State<SharedSnapback>,
    State(ctx): State<Arc<ServerContext>>,
    State(policy_mode): State<PolicyAuthMode>,
    State(secret_reads): State<SecretReadLeaseRegistry>,
    headers: HeaderMap,
    Path(table): Path<String>,
    Query(params): Query<DataQuery>,
) -> Result<Json<crate::storage::TableScan>, ApiError> {
    if policy_mode == PolicyAuthMode::Dev {
        authorize(&ctx, &headers, false)?;
    }
    let limit = params.limit.unwrap_or(50).clamp(1, 500);
    let offset = params.offset.unwrap_or(0);
    let table_scope = table.clone();
    if policy_mode == PolicyAuthMode::Sessions {
        preflight_secret_read(
            &secret_reads,
            &headers,
            BTreeSet::from([SecretReadScope::Table(table_scope.clone())]),
        )?;
    }
    let scan = crate::server::with_snapback(&snapback, move |snapback| {
        snapback.scan_table(&table, limit, offset)
    })
    .await?;
    if policy_mode == PolicyAuthMode::Sessions {
        reserve_secret_read_json(
            &secret_reads,
            &headers,
            BTreeSet::from([SecretReadScope::Table(table_scope)]),
            scan.rows.len(),
            &scan,
        )?;
    }
    Ok(Json(scan))
}

async fn admin_run_function(
    State(state): State<AppState>,
    Extension(authority): Extension<PreparedAuthority>,
    headers: HeaderMap,
    Path(name): Path<String>,
    Json(mut input): Json<HandlerInput>,
) -> Result<Json<crate::local::FunctionRunResult>, ApiError> {
    let snapback = state.snapback.clone();
    let ctx = state.server.clone();
    let policy_mode = state.active_policy_auth_mode();
    let secret_reads = state.secret_reads.clone();
    // @ref LLP 0039#authority-resolution — session-mode administrative
    // invocation never borrows a supplied app identity; the envelope records
    // the explicit bypass and query reads consume scoped secret authority.
    if policy_mode == PolicyAuthMode::Sessions {
        input.auth = Default::default();
    }
    // Actions leave the lock window and run detached under the watchdog
    // (ENG-23324); everything else runs under the lock as before.
    enum Routed {
        Done(Box<crate::local::FunctionRunResult>),
        Action(Box<crate::local::AppActionStage>),
    }
    let routed = {
        let name = name.clone();
        let input = input.clone();
        let secret_reads = secret_reads.clone();
        let gate_headers = headers.clone();
        crate::server::with_snapback(&snapback, move |snapback| -> Result<Routed, ApiError> {
            // A mutation is a write; a query (or unknown function) is a read.
            let function_kind = snapback.function_kind(&name);
            authorize_direct_runner(
                &ctx,
                &gate_headers,
                function_kind.as_ref(),
                policy_mode,
                &secret_reads,
            )?;
            if policy_mode == PolicyAuthMode::Sessions
                && matches!(
                    function_kind,
                    Some(FunctionKind::Query | FunctionKind::LiveQuery)
                )
            {
                let mut scopes = BTreeSet::from([SecretReadScope::FunctionRun(name.clone())]);
                scopes.extend(
                    snapback
                        .function_declared_read_tables(&name)
                        .into_iter()
                        .map(SecretReadScope::Table),
                );
                preflight_secret_read(&secret_reads, &gate_headers, scopes)?;
            }
            // A caller-supplied app user is the `devUser` authority mode, not
            // hosted authentication. Apply the same centralized profile rule
            // as the multiplexed host-ops alias before invoking app code.
            //
            // @ref LLP 0024#authority-tuple — devUser is local/dev only.
            require_operation_profile(&ctx, "function.run", input.auth.user_id.is_some())?;
            if matches!(snapback.function_kind(&name), Some(FunctionKind::Action)) {
                return Ok(
                    match snapback.stage_app_action_with_authority(&name, authority) {
                        crate::local::StagedAppAction::Done(result) => Routed::Done(result),
                        crate::local::StagedAppAction::Ready(stage) => {
                            Routed::Action(Box::new(stage))
                        }
                    },
                );
            }
            #[cfg(test)]
            if name == "preflightExecutionSentinel" {
                SECRET_READ_TEST_QUERY_EXECUTIONS.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            }
            Ok(Routed::Done(Box::new(
                snapback.run_function_with_authority(&name, input, authority),
            )))
        })
        .await?
    };
    let mut result = match routed {
        Routed::Done(result) => *result,
        Routed::Action(stage) => {
            crate::server::run_staged_app_action(&snapback, &name, input, *stage, "admin").await
        }
    };
    if policy_mode == PolicyAuthMode::Sessions {
        result.admin_bypass = true;
        if matches!(
            result.kind,
            Some(FunctionKind::Query | FunctionKind::LiveQuery)
        ) {
            // Ibex can report an error after one or more ctx.db reads without
            // returning the complete dependency witness. Until the runtime
            // carries provenance on its error type, fail closed with fixed
            // server text and never forward handler-controlled diagnostics.
            if !result.ok {
                return Err(secret_read_provenance_unavailable().into());
            }
            let scopes = function_run_secret_scopes(&result);
            let rows = result.rows.as_ref().map_or(0, Vec::len);
            reserve_secret_read_json(&secret_reads, &headers, scopes, rows, &result)?;
        }
    }
    Ok(Json(result))
}

#[cfg(test)]
static SECRET_READ_TEST_QUERY_EXECUTIONS: std::sync::atomic::AtomicUsize =
    std::sync::atomic::AtomicUsize::new(0);

pub(crate) fn secret_read_provenance_unavailable() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_ADMIN_SECRET_READ_PROVENANCE_UNAVAILABLE",
        "admin-secret-read",
        "the failed invocation did not provide a complete secret-read provenance witness",
    )
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

    #[tokio::test]
    async fn declared_scope_preflight_stops_before_the_query_execution_sentinel() {
        use crate::admin_secret_read::{SecretReadLeaseRequest, SecretReadScope};
        use crate::manifest::{
            FieldManifest, FieldType, FunctionDefinition, FunctionManifest, FunctionRuntime,
            HandlerPlan, QueryPlan, SchemaManifest, TableManifest,
        };
        use axum::body::Body;
        use axum::http::Request;
        use std::sync::atomic::Ordering;
        use tower::ServiceExt as _;

        let mut snapback = LocalSnapback::memory().unwrap();
        snapback
            .apply_schema(SchemaManifest {
                tables: vec![TableManifest {
                    name: "sentinelRows".to_owned(),
                    fields: vec![FieldManifest {
                        name: "value".to_owned(),
                        field_type: FieldType::String,
                        optional: false,
                    }],
                    indexes: Vec::new(),
                    syncable: false,
                    permission_backing: false,
                    permission_fields: None,
                    membership: None,
                }],
                ..SchemaManifest::default()
            })
            .unwrap();
        snapback.load_functions(FunctionManifest {
            functions: vec![FunctionDefinition::new(
                "preflightExecutionSentinel",
                FunctionKind::Query,
                FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
                    table: "sentinelRows".to_owned(),
                    filters: Vec::new(),
                    order: Vec::new(),
                    limit: None,
                    membership_filters: Vec::new(),
                    indexed_by: None,
                })),
            )],
            ..FunctionManifest::default()
        });
        let mut context = ServerContext::detached();
        context.admin_token = Some("ordinary-admin".to_owned());
        let (state, operator) =
            AppState::from_snapback_with_secret_read_operator(snapback, context);
        let lease = operator
            .mint(SecretReadLeaseRequest {
                scopes: BTreeSet::from([SecretReadScope::FunctionRun(
                    "preflightExecutionSentinel".to_owned(),
                )]),
                ttl: Duration::from_secs(60),
                row_budget: 10,
                byte_budget: 1_000_000,
            })
            .unwrap();
        SECRET_READ_TEST_QUERY_EXECUTIONS.store(0, Ordering::SeqCst);
        let response = crate::server::app(state.with_policy_auth_mode(PolicyAuthMode::Sessions))
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/_snapback/api/functions/preflightExecutionSentinel/run")
                    .header("content-type", "application/json")
                    .header(SECRET_READ_LEASE_HEADER, lease.bearer())
                    .body(Body::from(r#"{"args":{}}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert_eq!(SECRET_READ_TEST_QUERY_EXECUTIONS.load(Ordering::SeqCst), 0);
    }

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
        assert_eq!(
            std::fs::metadata(&file).unwrap().permissions().mode() & 0o777,
            0o600
        );

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

    #[cfg(unix)]
    #[test]
    fn admin_asset_open_is_stable_across_parent_symlink_swap() {
        use std::io::Read as _;

        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let assets = root.path().join("assets");
        std::fs::create_dir(&assets).unwrap();
        std::fs::write(assets.join("app.js"), b"safe bundle").unwrap();
        std::fs::write(outside.path().join("app.js"), b"outside secret").unwrap();

        // Swap the path only after the walker has opened the original assets
        // directory. Any later path-based read would follow the new symlink;
        // openat on the held directory descriptor must keep reading the
        // original object instead.
        let mut swapped = false;
        let mut file = open_admin_asset_with_hook(root.path(), "assets/app.js", |step| {
            if step == 1 {
                std::fs::rename(&assets, root.path().join("held-assets")).unwrap();
                std::os::unix::fs::symlink(outside.path(), &assets).unwrap();
                swapped = true;
            }
        })
        .expect("descriptor-relative open survives parent path replacement");
        assert!(swapped, "test must exercise the swap window");
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes).unwrap();
        assert_eq!(bytes, b"safe bundle");
        assert_eq!(
            std::fs::read(root.path().join("assets/app.js")).unwrap(),
            b"outside secret",
            "an ordinary post-swap path read demonstrates the old TOCTOU"
        );
    }

    #[cfg(not(unix))]
    #[tokio::test]
    async fn admin_asset_reader_fails_closed_without_handle_relative_backend() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("app.js"), b"must not be served").unwrap();
        let error = read_admin_asset(root.path(), "app.js")
            .await
            .expect_err("unsupported platform must never use a path-based fallback");
        assert_eq!(error.kind(), std::io::ErrorKind::Unsupported);
    }

    #[test]
    fn authorization_bearer_is_dev_only_and_custom_header_is_explicit() {
        let mut headers = HeaderMap::new();
        headers.insert("x-snapback-admin-token", "from-custom".parse().unwrap());
        assert_eq!(
            provided_token(&headers, false).as_deref(),
            Some("from-custom")
        );

        let mut headers = HeaderMap::new();
        headers.insert(header::AUTHORIZATION, "Bearer from-bearer".parse().unwrap());
        assert_eq!(
            provided_token(&headers, true).as_deref(),
            Some("from-bearer")
        );
        assert_eq!(provided_token(&headers, false), None);

        assert_eq!(provided_token(&HeaderMap::new(), true), None);
    }

    #[test]
    fn credential_bearing_debug_surfaces_are_redacted() {
        let registry = ConsoleCredentialRegistry::default();
        let response = registry.mint();
        let derived = response.credential.clone();
        let mut context = ServerContext::detached();
        context.admin_token = Some("MASTER_DEBUG_SENTINEL".to_owned());
        context.console_credentials = registry.clone();
        let resolved = ResolvedAdminToken {
            token: "RESOLVED_MASTER_DEBUG_SENTINEL".to_owned(),
            minted: true,
            fresh: true,
            file: Some(PathBuf::from("/secret/admin-token")),
        };

        for rendered in [
            format!("{registry:?}"),
            format!("{response:?}"),
            format!("{context:?}"),
            format!("{resolved:?}"),
        ] {
            assert!(!rendered.contains(&derived), "{rendered}");
            assert!(!rendered.contains("MASTER_DEBUG_SENTINEL"), "{rendered}");
            assert!(
                !rendered.contains("RESOLVED_MASTER_DEBUG_SENTINEL"),
                "{rendered}"
            );
        }
        assert_eq!(
            format!("{registry:?}"),
            "ConsoleCredentialRegistry { active_entries: 1 }"
        );
    }
}
