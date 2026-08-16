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
pub use crate::contract_types::ServerProfile;
use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::local::{EphemeralApi, InspectState, LocalSnapback, ReadLane};
use crate::manifest::{AuthMode, FunctionKind, HandlerInput};
use crate::runtime::CapabilityState;
use crate::server::{
    ApiError, AuthTerminalLifecycle, ConnectionRegistry, CredentialResolution, EffectPolicy,
    HealthResponse, InvocationAuthority, LegacyBodyPolicy, PolicyAuthMode, PolicyAuthPosture,
    RegisteredRoute, ResponseSensitivity, RouteClass, RoutePolicy, RouteSpec, SessionModeOverlay,
    SharedSnapback, committed_mode_terminal_reason, static_public_content_security_policy,
    system_api_route, system_static_route,
};
use anyhow::Context as _;
use axum::Json;
use axum::body::{Body, Bytes};
use axum::extract::{ConnectInfo, Extension, FromRef, Path, Query, State};
use axum::http::{HeaderMap, HeaderName, HeaderValue, StatusCode, header};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::{get, post, put};
use base64::Engine as _;
use futures_util::StreamExt as _;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest as _, Sha256};
use std::collections::{BTreeSet, HashMap};
use std::ffi::OsString;
use std::fmt;
use std::net::SocketAddr;
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
use subtle::ConstantTimeEq as _;
#[cfg(unix)]
use tokio::io::AsyncReadExt as _;
use tokio::sync::Mutex;

/// A tiny failure shell, not a second admin UI. The admin console itself is the
/// Contract/Exact bundle in `admin-ui/dist`; when that snapshot is unavailable,
/// browsers get an explicit capability diagnostic instead of a separate
/// handwritten console.
///
/// @ref LLP 0017#static-bundling-and-the-native-shell — published runtimes
/// carry their build-matched snapshot; this recovery page is a contributor
/// source-build diagnostic and must not turn package consumers into builders.
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
<p>Published <code>@expo/snapback-cli</code> installs include and select a build-matched console automatically. If a published install shows this page, reinstall that exact package closure.</p>
<p><strong>Contributor source-build recovery:</strong> build the checkout's Contract/Exact snapshot, then restart the source runtime. <code>SNAPBACK_ADMIN_DIST</code> is available only when deliberately testing another contributor-built snapshot.</p>
<pre>bun install --frozen-lockfile --cwd admin-ui
bun run --cwd admin-ui build
cargo run -- start --memory</pre>
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
            "desired or active sessions cannot serve app data on a plaintext non-loopback bind; select the intended non-production environment with SNAPBACK_PROFILE and terminate TLS before the listener (the dev override never bypasses sessions transport policy)",
        )
        .with_details(json!({
            "profileEnvVar": "SNAPBACK_PROFILE",
            "requiredTransport": "TLS",
            "overrideAppliesToSessions": false,
        })));
    }
    if profile == ServerProfile::Prod || !allow_insecure_dev_auth {
        return Err(SnapbackError::error(
            "SNAPBACK_AUTH_TRANSPORT_INSECURE",
            "auth-mode",
            "dev auth on a plaintext non-loopback listener requires SNAPBACK_PROFILE=dev|demo|test and the explicit --allow-insecure-dev-auth override",
        )
        .with_details(json!({
            "profileEnvVar": "SNAPBACK_PROFILE",
            "allowedProfiles": ["dev", "demo", "test"],
            "requiredFlag": "--allow-insecure-dev-auth",
        })));
    }
    Ok(())
}

impl ServerProfile {
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
        // Operational readiness is an authenticated control-plane fact with
        // the same all-profile inspection posture as app.inspect. The active
        // network profile is recorded by the evaluator, never used as a gate.
        "app.inspect" | "app.readiness.v1" => OperationProfileRequirement::Any,
        // @ref LLP 0167#authority-one-activation-chokepoint — reads are
        // available in every profile and writes must reach the network-profile
        // activation gate so its finer hosted/Prod policy and refusal codes
        // remain authoritative. Do not preempt that gate with NonProd here.
        "debug.networkProfileGet" | "debug.networkProfileSet" => OperationProfileRequirement::Any,
        // The dedicated data-patch target classifier owns the stricter
        // local/non-production/primary-instance rule and its availability
        // refusal diagnostic.
        "data.patch.preview" | "data.patch.apply" => OperationProfileRequirement::Any,
        "app.reset"
        | "app.ensure.provision"
        | "app.seed.ensure.v1"
        | "app.seed.preview.v1"
        | "app.seed.reset-install.v1"
        | "app.seed.clear.v1"
        | "schema.load"
        | "functions.load" => OperationProfileRequirement::NonProd,
        // The direct and multiplexed runners are developer/operator bypass
        // surfaces even when they project an anonymous handler input. Hosted
        // production invocation goes through the ordinary app-data gate.
        "function.run" | "auth.mintSession" => OperationProfileRequirement::NonProd,
        // The asset operator surface is developer/operator tooling like the
        // direct runner; hosted production traffic uses the ordinary asset
        // routes.
        "asset.put"
        | "asset.ensureSeedFixture"
        | "asset.inspect"
        | "asset.list"
        | "asset.retry"
        | "asset.delete" => OperationProfileRequirement::NonProd,
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

fn canonical_loopback_http_origin(raw: &str) -> Option<String> {
    let uri = raw.trim().parse::<axum::http::Uri>().ok()?;
    let scheme = uri.scheme_str()?;
    if !matches!(scheme, "http" | "https") || uri.path() != "/" || uri.query().is_some() {
        return None;
    }
    let authority = uri.authority()?;
    if authority.as_str().contains('@') || authority.port_u16().is_none() {
        return None;
    }
    let host = authority
        .host()
        .strip_prefix('[')
        .and_then(|host| host.strip_suffix(']'))
        .unwrap_or_else(|| authority.host());
    let normalized_authority = if host.eq_ignore_ascii_case("localhost") {
        format!("localhost:{}", authority.port_u16()?)
    } else {
        let address = host.parse::<std::net::IpAddr>().ok()?;
        if !address.is_loopback() {
            return None;
        }
        std::net::SocketAddr::new(address, authority.port_u16()?).to_string()
    };
    Some(format!("{scheme}://{normalized_authority}"))
}

fn env_dev_auth_origins() -> BTreeSet<String> {
    std::env::var("SNAPBACK_DEV_AUTH_ORIGINS")
        .ok()
        .into_iter()
        .flat_map(|raw| {
            raw.split(',')
                .filter_map(canonical_loopback_http_origin)
                .collect::<Vec<_>>()
        })
        .collect()
}

/// Resolve the server profile from the raw `SNAPBACK_PROFILE` value (pure, so
/// the fail-closed behavior is testable without mutating the process
/// environment). An exact `dev|demo|test|prod` wins; ANY other non-empty value
/// — a typo, `production`, `PROD`, `staging` — fails CLOSED to `Prod` rather
/// than silently granting the destructive/provisioning capability via the
/// loopback default (ENG-22527 FIX 3). Unset or empty falls back to the
/// bind-address default: zero-config `dev` on loopback, `prod` on a real
/// interface.
pub(crate) fn resolve_profile(raw: Option<&str>, loopback: bool) -> ServerProfile {
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
/// `@expo/snapback-admin-client` workspace package, and the server also exposes it at
/// `/_snapback/admin/client.mjs` for external tooling — one client, no drift.
const ADMIN_CLIENT_MJS: &str = include_str!("../packages/snapback-admin-client/index.mjs");

/// Browser-safe administrator capability lifetime. The credential is
/// short-lived and may slide only while active, with an eight-hour absolute
/// ceiling from its first mint. The master credential is used only for the
/// initial exchange and never needs to enter browser storage.
const CONSOLE_CREDENTIAL_TTL: Duration = Duration::from_secs(10 * 60);
const CONSOLE_CREDENTIAL_MAX_LIFETIME: Duration = Duration::from_secs(8 * 60 * 60);
const CONSOLE_CLAIM_CREDENTIAL_MAX_LIFETIME: Duration = Duration::from_secs(90 * 60);
const MAX_CONSOLE_CREDENTIALS: usize = 256;
const MAX_CONSOLE_CLAIM_REDEMPTIONS: usize = 256;
const CONSOLE_CREDENTIAL_STORE_VERSION: u32 = 2;
const MAX_CONSOLE_CREDENTIAL_STORE_BYTES: usize = 256 * 1024;

const CONSOLE_APPROVAL_TTL: Duration = Duration::from_secs(10 * 60);
const CONSOLE_APPROVAL_POLL_INTERVAL: Duration = Duration::from_secs(2);
const MAX_PENDING_CONSOLE_APPROVALS: usize = 64;
const CONSOLE_APPROVAL_REQUESTS_PER_MINUTE: u32 = 20;
const CONSOLE_APPROVAL_ATTEMPTS_PER_MINUTE: u32 = 30;
const CONSOLE_APPROVAL_POLLS_PER_MINUTE: u32 = 120;

const CONSOLE_CLAIM_TTL: Duration = Duration::from_secs(30 * 60);
const MAX_PENDING_CONSOLE_CLAIMS: usize = 64;
const MAX_CONSOLE_CLAIM_RECORDS: usize = 256;
const CONSOLE_CLAIM_MINTS_PER_MINUTE: u32 = 20;
const CONSOLE_CLAIM_EXCHANGES_PER_MINUTE: u32 = 60;
const CONSOLE_CREDENTIAL_EXCHANGES_PER_MINUTE: u32 = 60;

/// A managed front must renew often enough that loss of the master-observed
/// claim state closes its origin admission promptly. The CLI polls at 500ms,
/// leaving several opportunities inside this interval without making tests or
/// revocation depend on a long wall-clock wait.
pub(crate) const CONSOLE_RELAY_LEASE_INTERVAL: Duration = Duration::from_secs(3);
const MAX_CONSOLE_REACHABILITY_SESSIONS: usize = 128;

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
enum ConsoleCredentialProvenance {
    #[default]
    Standard,
    OperatorClaim,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConsoleCredentialEntry {
    issued_at_ms: u64,
    expires_at_ms: u64,
    max_expires_at_ms: u64,
    #[serde(default)]
    provenance: ConsoleCredentialProvenance,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PersistedConsoleCredentialStore {
    version: u32,
    credentials: Vec<PersistedConsoleCredential>,
    #[serde(default)]
    claim_redemptions: Vec<PersistedConsoleClaimRedemption>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PersistedConsoleCredential {
    digest_sha256: String,
    issued_at_ms: u64,
    expires_at_ms: u64,
    max_expires_at_ms: u64,
    #[serde(default)]
    provenance: ConsoleCredentialProvenance,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PersistedConsoleClaimRedemption {
    claim_digest_sha256: String,
    redeemed_at_ms: u64,
    transport_peer: String,
    credential_digest_sha256: String,
    credential_expires_at_ms: u64,
    credential_max_expires_at_ms: u64,
    revoked_at_ms: Option<u64>,
}

#[derive(Clone, Debug)]
struct ConsoleClaimRedemption {
    redeemed_at_ms: u64,
    transport_peer: String,
    credential_digest: [u8; 32],
    credential_expires_at_ms: u64,
    credential_max_expires_at_ms: u64,
    revoked_at_ms: Option<u64>,
}

/// In-memory registry of derived console credentials. These credentials can
/// satisfy ordinary AdminRead/AdminWrite policy only. Stronger resolvers such
/// as AdminSecretRead and impersonation deliberately use distinct carriers
/// and never consult this registry.
///
/// @ref LLP 0017#security-defaults — the browser persists a narrowly-scoped,
/// short-lived console capability instead of the master admin credential.
#[derive(Clone, Default)]
pub struct ConsoleCredentialRegistry {
    state: Arc<StdMutex<ConsoleCredentialState>>,
}

#[derive(Default)]
struct ConsoleCredentialState {
    entries: HashMap<[u8; 32], ConsoleCredentialEntry>,
    claim_redemptions: HashMap<[u8; 32], ConsoleClaimRedemption>,
    persistence: Option<PathBuf>,
    master_exchange_window: RateWindow,
}

impl fmt::Debug for ConsoleCredentialRegistry {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let active_entries = self
            .state
            .lock()
            .unwrap_or_else(|lock| lock.into_inner())
            .entries
            .len();
        formatter
            .debug_struct("ConsoleCredentialRegistry")
            .field("active_entries", &active_entries)
            .finish()
    }
}

impl ConsoleCredentialRegistry {
    pub fn persistent(path: PathBuf) -> anyhow::Result<Self> {
        let now_ms = now_millis();
        let (entries, claim_redemptions) = match crate::secure_file::read_strict_owner_only(
            &path,
            MAX_CONSOLE_CREDENTIAL_STORE_BYTES,
        ) {
            Ok(bytes) => {
                let persisted: PersistedConsoleCredentialStore = serde_json::from_slice(&bytes)
                    .map_err(|error| anyhow::anyhow!(
                        "SNAPBACK_ADMIN_CONSOLE_CREDENTIAL_STORE_INVALID: persisted credential store is not valid JSON: {error}"
                    ))?;
                anyhow::ensure!(
                    matches!(persisted.version, 1 | CONSOLE_CREDENTIAL_STORE_VERSION),
                    "SNAPBACK_ADMIN_CONSOLE_CREDENTIAL_STORE_INVALID: unsupported persisted credential store version {}",
                    persisted.version
                );
                anyhow::ensure!(
                    persisted.credentials.len() <= MAX_CONSOLE_CREDENTIALS,
                    "SNAPBACK_ADMIN_CONSOLE_CREDENTIAL_STORE_INVALID: persisted credential store exceeds its entry limit"
                );
                anyhow::ensure!(
                    persisted.claim_redemptions.len() <= MAX_CONSOLE_CLAIM_REDEMPTIONS,
                    "SNAPBACK_ADMIN_CONSOLE_CREDENTIAL_STORE_INVALID: persisted claim-redemption store exceeds its entry limit"
                );
                let mut entries = HashMap::new();
                for persisted in persisted.credentials {
                    let digest = decode_console_credential_digest(&persisted.digest_sha256)
                        .ok_or_else(|| anyhow::anyhow!(
                            "SNAPBACK_ADMIN_CONSOLE_CREDENTIAL_STORE_INVALID: persisted credential digest is invalid"
                        ))?;
                    let lifetime_cap = match persisted.provenance {
                        ConsoleCredentialProvenance::Standard => CONSOLE_CREDENTIAL_MAX_LIFETIME,
                        ConsoleCredentialProvenance::OperatorClaim => {
                            CONSOLE_CLAIM_CREDENTIAL_MAX_LIFETIME
                        }
                    };
                    anyhow::ensure!(
                        persisted.issued_at_ms <= persisted.expires_at_ms
                            && persisted.expires_at_ms <= persisted.max_expires_at_ms
                            && persisted
                                .max_expires_at_ms
                                .saturating_sub(persisted.issued_at_ms)
                                <= lifetime_cap.as_millis() as u64,
                        "SNAPBACK_ADMIN_CONSOLE_CREDENTIAL_STORE_INVALID: persisted credential lifetime is invalid"
                    );
                    if persisted.issued_at_ms <= now_ms && persisted.expires_at_ms > now_ms {
                        entries.insert(
                            digest,
                            ConsoleCredentialEntry {
                                issued_at_ms: persisted.issued_at_ms,
                                expires_at_ms: persisted.expires_at_ms,
                                max_expires_at_ms: persisted.max_expires_at_ms,
                                provenance: persisted.provenance,
                            },
                        );
                    }
                }
                let mut claim_redemptions = HashMap::new();
                for persisted in persisted.claim_redemptions {
                    let claim_digest =
                        decode_console_credential_digest(&persisted.claim_digest_sha256)
                            .ok_or_else(|| anyhow::anyhow!(
                                "SNAPBACK_ADMIN_CONSOLE_CREDENTIAL_STORE_INVALID: persisted claim digest is invalid"
                            ))?;
                    let credential_digest =
                        decode_console_credential_digest(&persisted.credential_digest_sha256)
                            .ok_or_else(|| anyhow::anyhow!(
                                "SNAPBACK_ADMIN_CONSOLE_CREDENTIAL_STORE_INVALID: persisted claim credential digest is invalid"
                            ))?;
                    anyhow::ensure!(
                        persisted.redeemed_at_ms <= persisted.credential_expires_at_ms
                            && persisted.credential_expires_at_ms
                                <= persisted.credential_max_expires_at_ms
                            && persisted
                                .credential_max_expires_at_ms
                                .saturating_sub(persisted.redeemed_at_ms)
                                <= CONSOLE_CLAIM_CREDENTIAL_MAX_LIFETIME.as_millis() as u64
                            && persisted.revoked_at_ms.is_none_or(|revoked| {
                                revoked >= persisted.redeemed_at_ms
                                    && revoked <= persisted.credential_max_expires_at_ms
                            }),
                        "SNAPBACK_ADMIN_CONSOLE_CREDENTIAL_STORE_INVALID: persisted claim redemption lifetime is invalid"
                    );
                    if persisted.credential_max_expires_at_ms > now_ms {
                        claim_redemptions.insert(
                            claim_digest,
                            ConsoleClaimRedemption {
                                redeemed_at_ms: persisted.redeemed_at_ms,
                                transport_peer: persisted.transport_peer,
                                credential_digest,
                                credential_expires_at_ms: persisted.credential_expires_at_ms,
                                credential_max_expires_at_ms: persisted
                                    .credential_max_expires_at_ms,
                                revoked_at_ms: persisted.revoked_at_ms,
                            },
                        );
                    }
                }
                (entries, claim_redemptions)
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                (HashMap::new(), HashMap::new())
            }
            Err(error) => {
                return Err(anyhow::anyhow!(
                    "SNAPBACK_ADMIN_CONSOLE_CREDENTIAL_STORE_INVALID: persisted credential store could not be read: {error}"
                ));
            }
        };
        Ok(Self {
            state: Arc::new(StdMutex::new(ConsoleCredentialState {
                entries,
                claim_redemptions,
                persistence: Some(path),
                master_exchange_window: RateWindow::default(),
            })),
        })
    }

    pub(crate) fn admit_master_exchange(&self) -> Result<(), SnapbackError> {
        let mut state = self.state.lock().unwrap_or_else(|lock| lock.into_inner());
        if admit_rate(
            &mut state.master_exchange_window,
            now_millis(),
            CONSOLE_CREDENTIAL_EXCHANGES_PER_MINUTE,
        ) {
            Ok(())
        } else {
            Err(console_claim_error(
                "SNAPBACK_ADMIN_CONSOLE_CREDENTIAL_RATE_LIMITED",
                "console master-credential exchange rate limit exceeded",
            ))
        }
    }

    fn mint(&self) -> Result<ConsoleCredentialResponse, SnapbackError> {
        self.mint_at(now_millis())
    }

    fn mint_at(&self, now_ms: u64) -> Result<ConsoleCredentialResponse, SnapbackError> {
        let mut state = self.state.lock().unwrap_or_else(|lock| lock.into_inner());
        let original = state.entries.clone();
        let original_redemptions = state.claim_redemptions.clone();
        prune_console_credential_state(&mut state, now_ms);
        evict_oldest_console_credential(&mut state, now_ms);
        let credential = format!("sbcc_{}", uuid::Uuid::new_v4().simple());
        let expires_at_ms = now_ms.saturating_add(CONSOLE_CREDENTIAL_TTL.as_millis() as u64);
        let max_expires_at_ms =
            now_ms.saturating_add(CONSOLE_CREDENTIAL_MAX_LIFETIME.as_millis() as u64);
        state.entries.insert(
            console_credential_digest(&credential),
            ConsoleCredentialEntry {
                issued_at_ms: now_ms,
                expires_at_ms,
                max_expires_at_ms,
                provenance: ConsoleCredentialProvenance::Standard,
            },
        );
        if let Err(error) = persist_console_credentials(&state) {
            state.entries = original;
            state.claim_redemptions = original_redemptions;
            return Err(console_credential_store_error(error));
        }
        Ok(ConsoleCredentialResponse {
            credential,
            expires_at_ms,
            provenance: None,
            reachability: None,
        })
    }

    // @ref LLP 0017#security-defaults — claim provenance and its ninety-minute
    // absolute renewal ceiling are committed in the same owner-only
    // publication as the redemption binding. There is no issued-but-unbound
    // credential window for a concurrent status/revoke observer to race.
    fn mint_claim_derived_at(
        &self,
        claim_digest: [u8; 32],
        transport_peer: String,
        now_ms: u64,
    ) -> Result<ConsoleCredentialResponse, SnapbackError> {
        let mut state = self.state.lock().unwrap_or_else(|lock| lock.into_inner());
        let original = state.entries.clone();
        let original_redemptions = state.claim_redemptions.clone();
        prune_console_credential_state(&mut state, now_ms);
        if constant_time_matching_digest(&state.claim_redemptions, &claim_digest).is_some() {
            return Err(console_claim_invalid());
        }
        if state.claim_redemptions.len() >= MAX_CONSOLE_CLAIM_REDEMPTIONS {
            return Err(console_claim_error(
                "SNAPBACK_ADMIN_CLAIM_RATE_LIMITED",
                "console claim redemption capacity is exhausted",
            ));
        }
        evict_oldest_console_credential(&mut state, now_ms);
        let credential = format!("sbcc_{}", uuid::Uuid::new_v4().simple());
        let credential_digest = console_credential_digest(&credential);
        let expires_at_ms = now_ms.saturating_add(CONSOLE_CREDENTIAL_TTL.as_millis() as u64);
        let max_expires_at_ms =
            now_ms.saturating_add(CONSOLE_CLAIM_CREDENTIAL_MAX_LIFETIME.as_millis() as u64);
        state.entries.insert(
            credential_digest,
            ConsoleCredentialEntry {
                issued_at_ms: now_ms,
                expires_at_ms,
                max_expires_at_ms,
                provenance: ConsoleCredentialProvenance::OperatorClaim,
            },
        );
        state.claim_redemptions.insert(
            claim_digest,
            ConsoleClaimRedemption {
                redeemed_at_ms: now_ms,
                transport_peer,
                credential_digest,
                credential_expires_at_ms: expires_at_ms,
                credential_max_expires_at_ms: max_expires_at_ms,
                revoked_at_ms: None,
            },
        );
        if let Err(error) = persist_console_credentials(&state) {
            state.entries = original;
            state.claim_redemptions = original_redemptions;
            return Err(console_credential_store_error(error));
        }
        Ok(ConsoleCredentialResponse {
            credential,
            expires_at_ms,
            provenance: Some(ConsoleCredentialProvenance::OperatorClaim),
            reachability: None,
        })
    }

    fn renew(&self, credential: &str) -> Result<Option<ConsoleCredentialResponse>, SnapbackError> {
        self.renew_at(credential, now_millis())
    }

    fn renew_at(
        &self,
        credential: &str,
        now_ms: u64,
    ) -> Result<Option<ConsoleCredentialResponse>, SnapbackError> {
        let digest = console_credential_digest(credential);
        let mut state = self.state.lock().unwrap_or_else(|lock| lock.into_inner());
        let original = state.entries.clone();
        let original_redemptions = state.claim_redemptions.clone();
        prune_console_credential_state(&mut state, now_ms);
        let Some(entry) = state.entries.get_mut(&digest) else {
            return Ok(None);
        };
        entry.expires_at_ms = now_ms
            .saturating_add(CONSOLE_CREDENTIAL_TTL.as_millis() as u64)
            .min(entry.max_expires_at_ms);
        let expires_at_ms = entry.expires_at_ms;
        let provenance = entry.provenance;
        if provenance == ConsoleCredentialProvenance::OperatorClaim
            && let Some(redemption) = state
                .claim_redemptions
                .values_mut()
                .find(|redemption| bool::from(redemption.credential_digest.ct_eq(&digest)))
        {
            redemption.credential_expires_at_ms = expires_at_ms;
        }
        if let Err(error) = persist_console_credentials(&state) {
            state.entries = original;
            state.claim_redemptions = original_redemptions;
            return Err(console_credential_store_error(error));
        }
        Ok(Some(ConsoleCredentialResponse {
            credential: credential.to_owned(),
            expires_at_ms,
            provenance: (provenance == ConsoleCredentialProvenance::OperatorClaim)
                .then_some(provenance),
            reachability: None,
        }))
    }

    fn allows(&self, credential: Option<&str>) -> bool {
        let Some(credential) = credential else {
            return false;
        };
        self.allows_at(credential, now_millis())
    }

    fn allows_at(&self, credential: &str, now_ms: u64) -> bool {
        let mut state = self.state.lock().unwrap_or_else(|lock| lock.into_inner());
        prune_console_credential_state(&mut state, now_ms);
        state
            .entries
            .contains_key(&console_credential_digest(credential))
    }

    fn claim_redemption_status_at(
        &self,
        claim_digest: &[u8; 32],
        now_ms: u64,
    ) -> Option<ConsoleClaimStatusResponse> {
        let mut state = self.state.lock().unwrap_or_else(|lock| lock.into_inner());
        prune_console_credential_state(&mut state, now_ms);
        let redemption = state
            .claim_redemptions
            .iter()
            .find(|(digest, _)| bool::from(digest.ct_eq(claim_digest)))
            .map(|(_, redemption)| redemption)?;
        let status = if redemption.revoked_at_ms.is_some() {
            "revoked"
        } else if redemption.credential_expires_at_ms <= now_ms {
            "credential_expired"
        } else {
            "redeemed"
        };
        Some(ConsoleClaimStatusResponse {
            status,
            claim_expires_at_ms: None,
            redeemed_at_ms: Some(redemption.redeemed_at_ms),
            transport_peer: Some(redemption.transport_peer.clone()),
            transport_peer_source: Some("directTransport"),
            credential_digest_sha256: Some(encode_console_credential_digest(
                &redemption.credential_digest,
            )),
            credential_expires_at_ms: Some(redemption.credential_expires_at_ms),
            credential_max_expires_at_ms: Some(redemption.credential_max_expires_at_ms),
            revoked_at_ms: redemption.revoked_at_ms,
        })
    }

    fn revoke_claim_credential_at(
        &self,
        claim_digest: &[u8; 32],
        now_ms: u64,
    ) -> Result<Option<ConsoleClaimStatusResponse>, SnapbackError> {
        let mut state = self.state.lock().unwrap_or_else(|lock| lock.into_inner());
        let original = state.entries.clone();
        let original_redemptions = state.claim_redemptions.clone();
        prune_console_credential_state(&mut state, now_ms);
        let Some(matched_digest) = state
            .claim_redemptions
            .keys()
            .find(|digest| bool::from(digest.ct_eq(claim_digest)))
            .copied()
        else {
            return Ok(None);
        };
        let credential_digest = state
            .claim_redemptions
            .get(&matched_digest)
            .expect("constant-time selected redemption remains under the registry lock")
            .credential_digest;
        state.entries.remove(&credential_digest);
        let redemption = state
            .claim_redemptions
            .get_mut(&matched_digest)
            .expect("constant-time selected redemption remains under the registry lock");
        if redemption.revoked_at_ms.is_none() {
            redemption.revoked_at_ms = Some(
                now_ms
                    .max(redemption.redeemed_at_ms)
                    .min(redemption.credential_max_expires_at_ms),
            );
        }
        if let Err(error) = persist_console_credentials(&state) {
            state.entries = original;
            state.claim_redemptions = original_redemptions;
            return Err(console_credential_store_error(error));
        }
        let redemption = state
            .claim_redemptions
            .get(&matched_digest)
            .expect("revoked redemption remains under the registry lock");
        Ok(Some(ConsoleClaimStatusResponse {
            status: "revoked",
            claim_expires_at_ms: None,
            redeemed_at_ms: Some(redemption.redeemed_at_ms),
            transport_peer: Some(redemption.transport_peer.clone()),
            transport_peer_source: Some("directTransport"),
            credential_digest_sha256: Some(encode_console_credential_digest(
                &redemption.credential_digest,
            )),
            credential_expires_at_ms: Some(redemption.credential_expires_at_ms),
            credential_max_expires_at_ms: Some(redemption.credential_max_expires_at_ms),
            revoked_at_ms: redemption.revoked_at_ms,
        }))
    }
}

fn prune_console_credential_state(state: &mut ConsoleCredentialState, now_ms: u64) {
    state
        .entries
        .retain(|_, entry| entry.issued_at_ms <= now_ms && entry.expires_at_ms > now_ms);
    state
        .claim_redemptions
        .retain(|_, redemption| redemption.credential_max_expires_at_ms > now_ms);
}

fn evict_oldest_console_credential(state: &mut ConsoleCredentialState, now_ms: u64) {
    if state.entries.len() < MAX_CONSOLE_CREDENTIALS {
        return;
    }
    let Some(oldest) = state
        .entries
        .iter()
        .min_by_key(|(_, entry)| entry.expires_at_ms)
        .map(|(digest, _)| *digest)
    else {
        return;
    };
    state.entries.remove(&oldest);
    if let Some(redemption) = state
        .claim_redemptions
        .values_mut()
        .find(|redemption| bool::from(redemption.credential_digest.ct_eq(&oldest)))
    {
        redemption.revoked_at_ms = Some(now_ms.min(redemption.credential_max_expires_at_ms));
    }
}

fn persist_console_credentials(state: &ConsoleCredentialState) -> std::io::Result<()> {
    let Some(path) = state.persistence.as_deref() else {
        return Ok(());
    };
    let mut credentials = state
        .entries
        .iter()
        .map(|(digest, entry)| PersistedConsoleCredential {
            digest_sha256: encode_console_credential_digest(digest),
            issued_at_ms: entry.issued_at_ms,
            expires_at_ms: entry.expires_at_ms,
            max_expires_at_ms: entry.max_expires_at_ms,
            provenance: entry.provenance,
        })
        .collect::<Vec<_>>();
    credentials.sort_by(|left, right| left.digest_sha256.cmp(&right.digest_sha256));
    let mut claim_redemptions = state
        .claim_redemptions
        .iter()
        .map(
            |(claim_digest, redemption)| PersistedConsoleClaimRedemption {
                claim_digest_sha256: encode_console_credential_digest(claim_digest),
                redeemed_at_ms: redemption.redeemed_at_ms,
                transport_peer: redemption.transport_peer.clone(),
                credential_digest_sha256: encode_console_credential_digest(
                    &redemption.credential_digest,
                ),
                credential_expires_at_ms: redemption.credential_expires_at_ms,
                credential_max_expires_at_ms: redemption.credential_max_expires_at_ms,
                revoked_at_ms: redemption.revoked_at_ms,
            },
        )
        .collect::<Vec<_>>();
    claim_redemptions
        .sort_by(|left, right| left.claim_digest_sha256.cmp(&right.claim_digest_sha256));
    let bytes = serde_json::to_vec(&PersistedConsoleCredentialStore {
        version: CONSOLE_CREDENTIAL_STORE_VERSION,
        credentials,
        claim_redemptions,
    })
    .map_err(std::io::Error::other)?;
    let mut temporary = path.as_os_str().to_os_string();
    temporary.push(format!(".tmp-{}", uuid::Uuid::new_v4().simple()));
    let temporary = PathBuf::from(temporary);
    crate::secure_file::write_new_owner_only(&temporary, &bytes)?;
    let publication =
        std::fs::rename(&temporary, path).and_then(|()| crate::secure_file::sync_parent(path));
    if publication.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    publication
}

fn console_credential_store_error(error: std::io::Error) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_ADMIN_CONSOLE_CREDENTIAL_STORE_FAILED",
        "admin",
        "the derived console credential store could not be updated",
    )
    .with_details(serde_json::json!({ "kind": format!("{:?}", error.kind()) }))
}

fn encode_console_credential_digest(digest: &[u8; 32]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(64);
    for byte in digest {
        encoded.push(HEX[(byte >> 4) as usize] as char);
        encoded.push(HEX[(byte & 0x0f) as usize] as char);
    }
    encoded
}

fn decode_console_credential_digest(encoded: &str) -> Option<[u8; 32]> {
    if encoded.len() != 64 {
        return None;
    }
    let mut digest = [0_u8; 32];
    for (index, pair) in encoded.as_bytes().chunks_exact(2).enumerate() {
        let high = (pair[0] as char).to_digit(16)? as u8;
        let low = (pair[1] as char).to_digit(16)? as u8;
        digest[index] = (high << 4) | low;
    }
    Some(digest)
}

fn console_credential_digest(credential: &str) -> [u8; 32] {
    Sha256::digest(credential.as_bytes()).into()
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConsoleCredentialResponse {
    credential: String,
    expires_at_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    provenance: Option<ConsoleCredentialProvenance>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reachability: Option<ConsoleReachabilityCredentialBinding>,
}

impl fmt::Debug for ConsoleCredentialResponse {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ConsoleCredentialResponse")
            .field("credential", &"[REDACTED]")
            .field("expires_at_ms", &self.expires_at_ms)
            .field("provenance", &self.provenance)
            .field("reachability", &self.reachability)
            .finish()
    }
}

#[derive(Clone, Default)]
pub struct ConsoleApprovalRegistry {
    state: Arc<StdMutex<ConsoleApprovalState>>,
}

#[derive(Default)]
struct ConsoleApprovalState {
    entries: HashMap<[u8; 32], ConsoleApprovalEntry>,
    request_window: RateWindow,
    approval_window: RateWindow,
    poll_window: RateWindow,
}

struct ConsoleApprovalEntry {
    user_code: String,
    expires_at_ms: u64,
    last_poll_at_ms: Option<u64>,
    approved: Option<ConsoleCredentialResponse>,
}

#[derive(Default)]
struct RateWindow {
    started_at_ms: u64,
    count: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConsoleApprovalRequestResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    expires_in: u64,
    interval: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ConsoleApprovalPollRequest {
    device_code: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConsoleApprovalPollResponse {
    status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    credential: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    expires_at_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    interval: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ConsoleApprovalApproveRequest {
    user_code: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConsoleApprovalApproveResponse {
    approved: bool,
}

impl fmt::Debug for ConsoleApprovalRegistry {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let pending = self
            .state
            .lock()
            .unwrap_or_else(|lock| lock.into_inner())
            .entries
            .len();
        formatter
            .debug_struct("ConsoleApprovalRegistry")
            .field("pending", &pending)
            .finish()
    }
}

impl ConsoleApprovalRegistry {
    fn request(
        &self,
        verification_uri: String,
    ) -> Result<ConsoleApprovalRequestResponse, SnapbackError> {
        self.request_at(verification_uri, now_millis())
    }

    fn request_at(
        &self,
        verification_uri: String,
        now_ms: u64,
    ) -> Result<ConsoleApprovalRequestResponse, SnapbackError> {
        let mut state = self.state.lock().unwrap_or_else(|lock| lock.into_inner());
        prune_console_approvals(&mut state, now_ms);
        if !admit_rate(
            &mut state.request_window,
            now_ms,
            CONSOLE_APPROVAL_REQUESTS_PER_MINUTE,
        ) || state.entries.len() >= MAX_PENDING_CONSOLE_APPROVALS
        {
            return Err(console_approval_error(
                "SNAPBACK_ADMIN_APPROVAL_RATE_LIMITED",
                "console approval request rate limit exceeded",
            ));
        }
        let device_code = format!("sbcd_{}", uuid::Uuid::new_v4().simple());
        let user_code = (0..16)
            .find_map(|_| {
                let raw = uuid::Uuid::new_v4()
                    .simple()
                    .to_string()
                    .to_ascii_uppercase();
                let candidate = format!("{}-{}", &raw[..4], &raw[4..8]);
                (!state
                    .entries
                    .values()
                    .any(|entry| entry.user_code == candidate))
                .then_some(candidate)
            })
            .ok_or_else(|| {
                console_approval_error(
                    "SNAPBACK_ADMIN_APPROVAL_RATE_LIMITED",
                    "console approval code capacity is exhausted",
                )
            })?;
        state.entries.insert(
            console_credential_digest(&device_code),
            ConsoleApprovalEntry {
                user_code: user_code.clone(),
                expires_at_ms: now_ms.saturating_add(CONSOLE_APPROVAL_TTL.as_millis() as u64),
                last_poll_at_ms: None,
                approved: None,
            },
        );
        Ok(ConsoleApprovalRequestResponse {
            device_code,
            user_code,
            verification_uri,
            expires_in: CONSOLE_APPROVAL_TTL.as_secs(),
            interval: CONSOLE_APPROVAL_POLL_INTERVAL.as_secs(),
        })
    }

    fn approve(
        &self,
        user_code: &str,
        credentials: &ConsoleCredentialRegistry,
    ) -> Result<(), SnapbackError> {
        self.approve_at(user_code, credentials, now_millis())
    }

    fn approve_at(
        &self,
        user_code: &str,
        credentials: &ConsoleCredentialRegistry,
        now_ms: u64,
    ) -> Result<(), SnapbackError> {
        let mut state = self.state.lock().unwrap_or_else(|lock| lock.into_inner());
        prune_console_approvals(&mut state, now_ms);
        if !admit_rate(
            &mut state.approval_window,
            now_ms,
            CONSOLE_APPROVAL_ATTEMPTS_PER_MINUTE,
        ) {
            return Err(console_approval_error(
                "SNAPBACK_ADMIN_APPROVAL_RATE_LIMITED",
                "console approval attempt rate limit exceeded",
            ));
        }
        let normalized =
            normalize_console_approval_code(user_code).ok_or_else(console_approval_invalid)?;
        let digest = state
            .entries
            .iter()
            .find(|(_, entry)| entry.user_code == normalized && entry.approved.is_none())
            .map(|(digest, _)| *digest)
            .ok_or_else(console_approval_invalid)?;
        let credential = credentials.mint_at(now_ms)?;
        state
            .entries
            .get_mut(&digest)
            .expect("selected approval remains under the registry lock")
            .approved = Some(credential);
        Ok(())
    }

    fn poll(&self, device_code: &str) -> Result<ConsoleApprovalPollResponse, SnapbackError> {
        self.poll_at(device_code, now_millis())
    }

    fn poll_at(
        &self,
        device_code: &str,
        now_ms: u64,
    ) -> Result<ConsoleApprovalPollResponse, SnapbackError> {
        let digest = console_credential_digest(device_code);
        let mut state = self.state.lock().unwrap_or_else(|lock| lock.into_inner());
        prune_console_approvals(&mut state, now_ms);
        if !admit_rate(
            &mut state.poll_window,
            now_ms,
            CONSOLE_APPROVAL_POLLS_PER_MINUTE,
        ) {
            return Err(console_approval_error(
                "SNAPBACK_ADMIN_APPROVAL_RATE_LIMITED",
                "console approval poll rate limit exceeded",
            ));
        }
        let entry = state
            .entries
            .get_mut(&digest)
            .ok_or_else(console_approval_invalid)?;
        if let Some(last_poll_at_ms) = entry.last_poll_at_ms
            && now_ms.saturating_sub(last_poll_at_ms)
                < CONSOLE_APPROVAL_POLL_INTERVAL.as_millis() as u64
        {
            return Err(console_approval_error(
                "SNAPBACK_ADMIN_APPROVAL_RATE_LIMITED",
                "console approval was polled faster than its declared interval",
            ));
        }
        entry.last_poll_at_ms = Some(now_ms);
        if let Some(credential) = entry.approved.take() {
            state.entries.remove(&digest);
            return Ok(ConsoleApprovalPollResponse {
                status: "approved",
                credential: Some(credential.credential),
                expires_at_ms: Some(credential.expires_at_ms),
                interval: None,
            });
        }
        Ok(ConsoleApprovalPollResponse {
            status: "authorization_pending",
            credential: None,
            expires_at_ms: None,
            interval: Some(CONSOLE_APPROVAL_POLL_INTERVAL.as_secs()),
        })
    }
}

fn prune_console_approvals(state: &mut ConsoleApprovalState, now_ms: u64) {
    state
        .entries
        .retain(|_, entry| entry.expires_at_ms > now_ms);
}

fn admit_rate(window: &mut RateWindow, now_ms: u64, limit: u32) -> bool {
    if window.started_at_ms == 0 || now_ms.saturating_sub(window.started_at_ms) >= 60_000 {
        window.started_at_ms = now_ms;
        window.count = 0;
    }
    if window.count >= limit {
        return false;
    }
    window.count += 1;
    true
}

fn normalize_console_approval_code(value: &str) -> Option<String> {
    let compact = value
        .trim()
        .chars()
        .filter(|character| *character != '-')
        .collect::<String>()
        .to_ascii_uppercase();
    if compact.len() != 8 || !compact.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    Some(format!("{}-{}", &compact[..4], &compact[4..]))
}

fn console_approval_invalid() -> SnapbackError {
    console_approval_error(
        "SNAPBACK_ADMIN_APPROVAL_INVALID",
        "console approval code is invalid, expired, or already used",
    )
}

fn console_approval_error(code: &'static str, message: &'static str) -> SnapbackError {
    SnapbackError::error(code, "admin", message)
}

#[derive(Clone, Default)]
pub struct ConsoleClaimRegistry {
    state: Arc<StdMutex<ConsoleClaimState>>,
}

#[derive(Default)]
struct ConsoleClaimState {
    entries: HashMap<[u8; 32], ConsoleClaimEntry>,
    mint_window: RateWindow,
    exchange_window: RateWindow,
}

#[derive(Clone, Copy)]
struct ConsoleClaimEntry {
    expires_at_ms: u64,
    retain_until_ms: u64,
    consumed_at_ms: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConsoleClaimMintResponse {
    claim_code: String,
    expires_at_ms: u64,
    expires_in: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ConsoleClaimCodeRequest {
    claim_code: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConsoleClaimStatusResponse {
    status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    claim_expires_at_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    redeemed_at_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    transport_peer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    transport_peer_source: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    credential_digest_sha256: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    credential_expires_at_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    credential_max_expires_at_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    revoked_at_ms: Option<u64>,
}

impl fmt::Debug for ConsoleClaimRegistry {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let state = self.state.lock().unwrap_or_else(|lock| lock.into_inner());
        let pending = state
            .entries
            .values()
            .filter(|entry| entry.consumed_at_ms.is_none())
            .count();
        formatter
            .debug_struct("ConsoleClaimRegistry")
            .field("pending", &pending)
            .field("retained_records", &state.entries.len())
            .finish()
    }
}

impl ConsoleClaimRegistry {
    fn mint(&self) -> Result<ConsoleClaimMintResponse, SnapbackError> {
        self.mint_at(now_millis())
    }

    fn mint_at(&self, now_ms: u64) -> Result<ConsoleClaimMintResponse, SnapbackError> {
        let mut state = self.state.lock().unwrap_or_else(|lock| lock.into_inner());
        prune_console_claims(&mut state, now_ms);
        if !admit_rate(
            &mut state.mint_window,
            now_ms,
            CONSOLE_CLAIM_MINTS_PER_MINUTE,
        ) || state
            .entries
            .values()
            .filter(|entry| entry.consumed_at_ms.is_none() && entry.expires_at_ms > now_ms)
            .count()
            >= MAX_PENDING_CONSOLE_CLAIMS
        {
            return Err(console_claim_error(
                "SNAPBACK_ADMIN_CLAIM_RATE_LIMITED",
                "console claim mint rate or pending limit exceeded",
            ));
        }
        while state.entries.len() >= MAX_CONSOLE_CLAIM_RECORDS {
            let Some(oldest) = state
                .entries
                .iter()
                .filter(|(_, entry)| {
                    entry.consumed_at_ms.is_some() || entry.expires_at_ms <= now_ms
                })
                .min_by_key(|(_, entry)| entry.retain_until_ms)
                .map(|(digest, _)| *digest)
            else {
                return Err(console_claim_error(
                    "SNAPBACK_ADMIN_CLAIM_RATE_LIMITED",
                    "console claim record capacity is exhausted",
                ));
            };
            state.entries.remove(&oldest);
        }
        let claim_code = format!("sbcl_{}", uuid::Uuid::new_v4().simple());
        let expires_at_ms = now_ms.saturating_add(CONSOLE_CLAIM_TTL.as_millis() as u64);
        state.entries.insert(
            console_credential_digest(&claim_code),
            ConsoleClaimEntry {
                expires_at_ms,
                retain_until_ms: expires_at_ms.saturating_add(CONSOLE_CLAIM_TTL.as_millis() as u64),
                consumed_at_ms: None,
            },
        );
        Ok(ConsoleClaimMintResponse {
            claim_code,
            expires_at_ms,
            expires_in: CONSOLE_CLAIM_TTL.as_secs(),
        })
    }

    fn exchange(
        &self,
        claim_code: &str,
        transport_peer: String,
        credentials: &ConsoleCredentialRegistry,
    ) -> Result<ConsoleCredentialResponse, SnapbackError> {
        self.exchange_at(claim_code, transport_peer, credentials, now_millis())
    }

    fn exchange_at(
        &self,
        claim_code: &str,
        transport_peer: String,
        credentials: &ConsoleCredentialRegistry,
        now_ms: u64,
    ) -> Result<ConsoleCredentialResponse, SnapbackError> {
        let candidate = console_credential_digest(claim_code);
        let mut state = self.state.lock().unwrap_or_else(|lock| lock.into_inner());
        prune_console_claims(&mut state, now_ms);
        if !admit_rate(
            &mut state.exchange_window,
            now_ms,
            CONSOLE_CLAIM_EXCHANGES_PER_MINUTE,
        ) {
            return Err(console_claim_error(
                "SNAPBACK_ADMIN_CLAIM_RATE_LIMITED",
                "console claim exchange rate limit exceeded",
            ));
        }
        let matched = constant_time_matching_digest(&state.entries, &candidate)
            .ok_or_else(console_claim_invalid)?;
        let entry = state
            .entries
            .get(&matched)
            .copied()
            .expect("constant-time selected claim remains under the registry lock");
        if entry.consumed_at_ms.is_some() || entry.expires_at_ms <= now_ms {
            return Err(console_claim_invalid());
        }
        let response = credentials.mint_claim_derived_at(matched, transport_peer, now_ms)?;
        state
            .entries
            .get_mut(&matched)
            .expect("exchanged claim remains under the registry lock")
            .consumed_at_ms = Some(now_ms);
        Ok(response)
    }

    fn status(
        &self,
        claim_code: &str,
        credentials: &ConsoleCredentialRegistry,
    ) -> Result<ConsoleClaimStatusResponse, SnapbackError> {
        self.status_at(claim_code, credentials, now_millis())
    }

    fn status_at(
        &self,
        claim_code: &str,
        credentials: &ConsoleCredentialRegistry,
        now_ms: u64,
    ) -> Result<ConsoleClaimStatusResponse, SnapbackError> {
        let candidate = console_credential_digest(claim_code);
        let mut state = self.state.lock().unwrap_or_else(|lock| lock.into_inner());
        prune_console_claims(&mut state, now_ms);
        if let Some(status) = credentials.claim_redemption_status_at(&candidate, now_ms) {
            return Ok(status);
        }
        let matched = constant_time_matching_digest(&state.entries, &candidate)
            .ok_or_else(console_claim_status_invalid)?;
        let entry = state
            .entries
            .get(&matched)
            .expect("constant-time selected claim remains under the registry lock");
        Ok(ConsoleClaimStatusResponse {
            status: if entry.expires_at_ms <= now_ms {
                "claim_expired"
            } else {
                "pending"
            },
            claim_expires_at_ms: Some(entry.expires_at_ms),
            redeemed_at_ms: None,
            transport_peer: None,
            transport_peer_source: None,
            credential_digest_sha256: None,
            credential_expires_at_ms: None,
            credential_max_expires_at_ms: None,
            revoked_at_ms: None,
        })
    }

    fn revoke(
        &self,
        claim_code: &str,
        credentials: &ConsoleCredentialRegistry,
    ) -> Result<ConsoleClaimStatusResponse, SnapbackError> {
        let candidate = console_credential_digest(claim_code);
        let now_ms = now_millis();
        let mut state = self.state.lock().unwrap_or_else(|lock| lock.into_inner());
        if let Some(status) = credentials.revoke_claim_credential_at(&candidate, now_ms)? {
            return Ok(status);
        }
        let matched = constant_time_matching_digest(&state.entries, &candidate)
            .ok_or_else(console_claim_status_invalid)?;
        let entry = state
            .entries
            .get_mut(&matched)
            .expect("selected pending claim remains under the registry lock");
        entry.consumed_at_ms = Some(now_ms);
        entry.expires_at_ms = entry.expires_at_ms.min(now_ms);
        Ok(ConsoleClaimStatusResponse {
            status: "claim_expired",
            claim_expires_at_ms: Some(entry.expires_at_ms),
            redeemed_at_ms: None,
            transport_peer: None,
            transport_peer_source: None,
            credential_digest_sha256: None,
            credential_expires_at_ms: None,
            credential_max_expires_at_ms: None,
            revoked_at_ms: None,
        })
    }

    fn pending_claim_digest(&self, claim_code: &str) -> Result<[u8; 32], SnapbackError> {
        let candidate = console_credential_digest(claim_code);
        let now_ms = now_millis();
        let mut state = self.state.lock().unwrap_or_else(|lock| lock.into_inner());
        prune_console_claims(&mut state, now_ms);
        let matched = constant_time_matching_digest(&state.entries, &candidate)
            .ok_or_else(console_claim_status_invalid)?;
        let entry = state
            .entries
            .get(&matched)
            .expect("selected pending claim remains under the registry lock");
        if entry.consumed_at_ms.is_some() || entry.expires_at_ms <= now_ms {
            return Err(console_claim_status_invalid());
        }
        Ok(matched)
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConsoleReachabilityCredentialBinding {
    session_id: String,
    instance_id: String,
}

#[derive(Clone, Default)]
pub(crate) struct ConsoleReachabilityRegistry {
    state: Arc<StdMutex<ConsoleReachabilityState>>,
}

#[derive(Default)]
struct ConsoleReachabilityState {
    sessions: HashMap<String, ConsoleReachabilitySession>,
    managed_claims: HashMap<[u8; 32], ManagedReachabilityClaim>,
}

#[derive(Clone, Debug)]
struct ManagedReachabilityClaim {
    session_id: String,
    retain_until_ms: u64,
}

#[derive(Clone, Debug)]
struct ConsoleReachabilitySession {
    origin: String,
    authority: String,
    instance_id: String,
    claim_digest: Option<[u8; 32]>,
    credential_digest: Option<[u8; 32]>,
    lease_expires_at_ms: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ConsoleReachabilityRegisterRequest {
    origin: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConsoleReachabilityLeaseResponse {
    session_id: String,
    instance_id: String,
    lease_expires_at_ms: u64,
    lease_interval_ms: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ConsoleReachabilityClaimRequest {
    session_id: String,
    claim_code: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ConsoleReachabilityDropRequest {
    session_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConsoleReachabilityDropResponse {
    dropped: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConsoleReachabilityObservationResponse {
    claim: ConsoleClaimStatusResponse,
    #[serde(skip_serializing_if = "Option::is_none")]
    lease: Option<ConsoleReachabilityLeaseResponse>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ConsoleReachabilityIdentityQuery {
    session: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConsoleReachabilityIdentityResponse {
    instance_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    session_id: Option<String>,
}

impl fmt::Debug for ConsoleReachabilityRegistry {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut state = self.state.lock().unwrap_or_else(|lock| lock.into_inner());
        prune_console_reachability(&mut state, now_millis());
        formatter
            .debug_struct("ConsoleReachabilityRegistry")
            .field("active_sessions", &state.sessions.len())
            .finish()
    }
}

impl ConsoleReachabilityRegistry {
    fn register(
        &self,
        origin: &str,
        instance_id: &str,
    ) -> Result<ConsoleReachabilityLeaseResponse, SnapbackError> {
        let (origin, authority) = validated_reachability_origin(origin)?;
        let now_ms = now_millis();
        let mut state = self.state.lock().unwrap_or_else(|lock| lock.into_inner());
        prune_console_reachability(&mut state, now_ms);
        if state.sessions.len() >= MAX_CONSOLE_REACHABILITY_SESSIONS {
            return Err(console_claim_error(
                "SNAPBACK_ADMIN_REACHABILITY_CAPACITY",
                "console reachability session capacity is exhausted",
            ));
        }
        let session_id = format!("sbrs_{}", uuid::Uuid::new_v4().simple());
        let lease_expires_at_ms = relay_lease_deadline(now_ms, u64::MAX);
        state.sessions.insert(
            session_id.clone(),
            ConsoleReachabilitySession {
                origin,
                authority,
                instance_id: instance_id.to_owned(),
                claim_digest: None,
                credential_digest: None,
                lease_expires_at_ms,
            },
        );
        Ok(ConsoleReachabilityLeaseResponse {
            session_id,
            instance_id: instance_id.to_owned(),
            lease_expires_at_ms,
            lease_interval_ms: CONSOLE_RELAY_LEASE_INTERVAL.as_millis() as u64,
        })
    }

    fn bind_claim(
        &self,
        session_id: &str,
        claim_digest: [u8; 32],
        claim_expires_at_ms: u64,
    ) -> Result<ConsoleReachabilityLeaseResponse, SnapbackError> {
        let now_ms = now_millis();
        let mut state = self.state.lock().unwrap_or_else(|lock| lock.into_inner());
        prune_console_reachability(&mut state, now_ms);
        if state
            .managed_claims
            .get(&claim_digest)
            .is_some_and(|binding| binding.session_id != session_id)
        {
            return Err(console_claim_error(
                "SNAPBACK_ADMIN_RELAY_LEASE_CLAIM_MISMATCH",
                "console relay claim is already bound to another session",
            ));
        }
        let session = state.sessions.get_mut(session_id).ok_or_else(|| {
            console_claim_error(
                "SNAPBACK_ADMIN_RELAY_LEASE_INVALID",
                "console relay lease is unavailable",
            )
        })?;
        if session
            .claim_digest
            .is_some_and(|bound| bound != claim_digest)
        {
            return Err(console_claim_error(
                "SNAPBACK_ADMIN_RELAY_LEASE_CLAIM_MISMATCH",
                "console relay lease is already bound to another claim",
            ));
        }
        session.claim_digest = Some(claim_digest);
        session.lease_expires_at_ms = relay_lease_deadline(now_ms, claim_expires_at_ms);
        let response = reachability_lease_response(session_id, session);
        state.managed_claims.insert(
            claim_digest,
            ManagedReachabilityClaim {
                session_id: session_id.to_owned(),
                retain_until_ms: claim_expires_at_ms,
            },
        );
        Ok(response)
    }

    fn renew(
        &self,
        session_id: &str,
        claim_code: &str,
        status: &ConsoleClaimStatusResponse,
    ) -> Result<ConsoleReachabilityLeaseResponse, SnapbackError> {
        let now_ms = now_millis();
        let claim_digest = console_credential_digest(claim_code);
        let mut state = self.state.lock().unwrap_or_else(|lock| lock.into_inner());
        prune_console_reachability(&mut state, now_ms);
        let session = state.sessions.get_mut(session_id).ok_or_else(|| {
            console_claim_error(
                "SNAPBACK_ADMIN_RELAY_LEASE_INVALID",
                "console relay lease is unavailable",
            )
        })?;
        if session.claim_digest != Some(claim_digest) {
            return Err(console_claim_error(
                "SNAPBACK_ADMIN_RELAY_LEASE_CLAIM_MISMATCH",
                "console relay lease does not match this claim",
            ));
        }
        let status_deadline = match status.status {
            "pending" => status.claim_expires_at_ms,
            "redeemed" => {
                let encoded = status.credential_digest_sha256.as_deref().ok_or_else(|| {
                    console_claim_error(
                        "SNAPBACK_ADMIN_RELAY_LEASE_STATUS_INVALID",
                        "redeemed console relay status omitted its credential binding",
                    )
                })?;
                let credential_digest =
                    decode_console_credential_digest(encoded).ok_or_else(|| {
                        console_claim_error(
                            "SNAPBACK_ADMIN_RELAY_LEASE_STATUS_INVALID",
                            "redeemed console relay status carried an invalid credential binding",
                        )
                    })?;
                if session
                    .credential_digest
                    .is_some_and(|bound| bound != credential_digest)
                {
                    return Err(console_claim_error(
                        "SNAPBACK_ADMIN_RELAY_LEASE_CREDENTIAL_MISMATCH",
                        "console relay lease is bound to another credential",
                    ));
                }
                session.credential_digest = Some(credential_digest);
                status.credential_expires_at_ms
            }
            _ => {
                state.sessions.remove(session_id);
                return Err(console_claim_error(
                    "SNAPBACK_ADMIN_RELAY_LEASE_TERMINAL",
                    "console relay claim or credential is no longer active",
                ));
            }
        }
        .ok_or_else(|| {
            console_claim_error(
                "SNAPBACK_ADMIN_RELAY_LEASE_STATUS_INVALID",
                "console relay status omitted its expiry",
            )
        })?;
        session.lease_expires_at_ms = relay_lease_deadline(now_ms, status_deadline);
        Ok(reachability_lease_response(session_id, session))
    }

    fn bind_redeemed_credential(
        &self,
        claim_code: &str,
        credential: &str,
    ) -> Result<Option<ConsoleReachabilityCredentialBinding>, SnapbackError> {
        let claim_digest = console_credential_digest(claim_code);
        let credential_digest = console_credential_digest(credential);
        let now_ms = now_millis();
        let mut state = self.state.lock().unwrap_or_else(|lock| lock.into_inner());
        prune_console_reachability(&mut state, now_ms);
        let Some(managed) = state.managed_claims.get(&claim_digest) else {
            return Ok(None);
        };
        let session_id = managed.session_id.clone();
        let session = state.sessions.get_mut(&session_id).ok_or_else(|| {
            console_claim_error(
                "SNAPBACK_ADMIN_RELAY_LEASE_TERMINAL",
                "console relay lease expired before claim redemption",
            )
        })?;
        if session.claim_digest != Some(claim_digest) {
            return Err(console_claim_error(
                "SNAPBACK_ADMIN_RELAY_LEASE_CLAIM_MISMATCH",
                "console relay lease no longer matches this claim",
            ));
        }
        if session
            .credential_digest
            .is_some_and(|bound| bound != credential_digest)
        {
            return Err(console_claim_error(
                "SNAPBACK_ADMIN_RELAY_LEASE_CREDENTIAL_MISMATCH",
                "console relay lease is bound to another credential",
            ));
        }
        session.credential_digest = Some(credential_digest);
        Ok(Some(ConsoleReachabilityCredentialBinding {
            session_id,
            instance_id: session.instance_id.clone(),
        }))
    }

    fn binding_for_credential(
        &self,
        credential: &str,
    ) -> Option<ConsoleReachabilityCredentialBinding> {
        let credential_digest = console_credential_digest(credential);
        let now_ms = now_millis();
        let mut state = self.state.lock().unwrap_or_else(|lock| lock.into_inner());
        prune_console_reachability(&mut state, now_ms);
        let (session_id, session) = state
            .sessions
            .iter()
            .find(|(_, session)| session.credential_digest == Some(credential_digest))?;
        Some(ConsoleReachabilityCredentialBinding {
            session_id: session_id.clone(),
            instance_id: session.instance_id.clone(),
        })
    }

    fn drop_session(&self, session_id: &str) -> bool {
        self.state
            .lock()
            .unwrap_or_else(|lock| lock.into_inner())
            .sessions
            .remove(session_id)
            .is_some()
    }

    pub(crate) fn admitted_origin(&self, origin: Option<&HeaderValue>) -> Option<HeaderValue> {
        let origin = origin?.to_str().ok()?;
        let now_ms = now_millis();
        let mut state = self.state.lock().unwrap_or_else(|lock| lock.into_inner());
        prune_console_reachability(&mut state, now_ms);
        state
            .sessions
            .values()
            .any(|session| session.origin == origin)
            .then(|| HeaderValue::from_str(origin).ok())
            .flatten()
    }

    fn identity_for_host(
        &self,
        host: &str,
        requested_session: Option<&str>,
    ) -> Option<ConsoleReachabilityIdentityResponse> {
        let now_ms = now_millis();
        let mut state = self.state.lock().unwrap_or_else(|lock| lock.into_inner());
        prune_console_reachability(&mut state, now_ms);
        let matches_host =
            |session: &&ConsoleReachabilitySession| session.authority.eq_ignore_ascii_case(host);
        if let Some(session_id) = requested_session {
            let session = state.sessions.get(session_id)?;
            if !matches_host(&session) {
                return None;
            }
            return Some(ConsoleReachabilityIdentityResponse {
                instance_id: session.instance_id.clone(),
                session_id: Some(session_id.to_owned()),
            });
        }
        let session = state.sessions.values().find(matches_host)?;
        Some(ConsoleReachabilityIdentityResponse {
            instance_id: session.instance_id.clone(),
            session_id: None,
        })
    }
}

fn reachability_lease_response(
    session_id: &str,
    session: &ConsoleReachabilitySession,
) -> ConsoleReachabilityLeaseResponse {
    ConsoleReachabilityLeaseResponse {
        session_id: session_id.to_owned(),
        instance_id: session.instance_id.clone(),
        lease_expires_at_ms: session.lease_expires_at_ms,
        lease_interval_ms: CONSOLE_RELAY_LEASE_INTERVAL.as_millis() as u64,
    }
}

fn relay_lease_deadline(now_ms: u64, status_deadline_ms: u64) -> u64 {
    now_ms
        .saturating_add(CONSOLE_RELAY_LEASE_INTERVAL.as_millis() as u64)
        .min(status_deadline_ms)
}

fn prune_console_reachability(state: &mut ConsoleReachabilityState, now_ms: u64) {
    // @ref LLP 0017#security-defaults — origin admission and the managed
    // relay's fail-closed lifetime are the same short server-issued lease;
    // observation loss cannot leave a reusable browser origin admitted.
    state
        .sessions
        .retain(|_, session| session.lease_expires_at_ms > now_ms);
    state
        .managed_claims
        .retain(|_, claim| claim.retain_until_ms > now_ms);
}

fn validated_reachability_origin(origin: &str) -> Result<(String, String), SnapbackError> {
    let uri = origin.parse::<axum::http::Uri>().map_err(|_| {
        console_claim_error(
            "SNAPBACK_ADMIN_REACHABILITY_ORIGIN_INVALID",
            "console reachability origin must be an absolute HTTP(S) origin",
        )
    })?;
    let scheme = uri.scheme_str().unwrap_or_default();
    let authority = uri.authority().ok_or_else(|| {
        console_claim_error(
            "SNAPBACK_ADMIN_REACHABILITY_ORIGIN_INVALID",
            "console reachability origin must include a host",
        )
    })?;
    let host = authority.host();
    let host_ip = host
        .strip_prefix('[')
        .and_then(|host| host.strip_suffix(']'))
        .unwrap_or(host)
        .parse::<std::net::IpAddr>()
        .ok();
    if !matches!(scheme, "http" | "https")
        || authority.as_str().contains('@')
        || host.is_empty()
        || host.eq_ignore_ascii_case("localhost")
        || host_ip.is_some_and(|ip| ip.is_loopback() || ip.is_unspecified())
        || !matches!(uri.path(), "" | "/")
        || uri.query().is_some()
    {
        return Err(console_claim_error(
            "SNAPBACK_ADMIN_REACHABILITY_ORIGIN_INVALID",
            "console reachability origin must be a non-loopback HTTP(S) origin without credentials, path, query, or fragment",
        ));
    }
    Ok((
        format!("{scheme}://{authority}"),
        authority.as_str().to_owned(),
    ))
}

fn constant_time_matching_digest<T>(
    entries: &HashMap<[u8; 32], T>,
    candidate: &[u8; 32],
) -> Option<[u8; 32]> {
    let mut matched = None;
    // @ref LLP 0017#security-defaults — even though only digests are retained,
    // claim selection scans every fixed-width digest with a constant-time
    // comparison instead of exposing HashMap equality as the bearer oracle.
    for digest in entries.keys() {
        if bool::from(digest.ct_eq(candidate)) {
            matched = Some(*digest);
        }
    }
    matched
}

fn prune_console_claims(state: &mut ConsoleClaimState, now_ms: u64) {
    state
        .entries
        .retain(|_, entry| entry.retain_until_ms > now_ms);
}

fn console_claim_invalid() -> SnapbackError {
    console_claim_error(
        "SNAPBACK_ADMIN_CLAIM_INVALID",
        "console claim is invalid, expired, or already used",
    )
}

fn console_claim_status_invalid() -> SnapbackError {
    console_claim_error(
        "SNAPBACK_ADMIN_CLAIM_STATUS_INVALID",
        "console claim status is unavailable",
    )
}

fn console_claim_error(code: &'static str, message: &'static str) -> SnapbackError {
    SnapbackError::error(code, "admin", message)
}

/// Server-runtime facts that live outside `LocalSnapback` (it does not know the
/// socket it is served on) and the admin authorization configuration.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ListenerTransportPosture {
    Unknown,
    Loopback,
    NonLoopback,
}

#[derive(Clone)]
pub struct ServerContext {
    pub host: String,
    pub port: u16,
    pub loopback: bool,
    // Kept private so an embedder cannot turn an assertion into transport
    // authority. Only a bound-listener path may resolve this posture.
    pub(crate) listener_transport: ListenerTransportPosture,
    /// Exact loopback browser origins permitted to exercise legacy Dev-mode
    /// body impersonation across origins. No-Origin clients and the listener's
    /// own origin are handled separately by the request gate.
    pub(crate) dev_auth_origins: BTreeSet<String>,
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
    /// Short-lived RFC-8628-shaped requests that let a token-holding terminal
    /// approve one browser credential without exposing the master token.
    pub console_approvals: ConsoleApprovalRegistry,
    /// Process-ephemeral one-time links minted only by a master-proven
    /// terminal. Raw claim codes never enter this registry or durable storage.
    pub console_claims: ConsoleClaimRegistry,
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
            .field("listener_transport", &self.listener_transport)
            .field("dev_auth_origins", &self.dev_auth_origins)
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
            .field("console_approvals", &self.console_approvals)
            .field("console_claims", &self.console_claims)
            .field("admin_dist_configured", &self.admin_dist.is_some())
            .finish()
    }
}

impl ServerContext {
    /// Build a context from a listener for direct request-service composition.
    /// Network embedders must still pass their serving listener through
    /// `server::app(state).bind(listener)`, which overwrites this posture from
    /// the consumed socket. The detached and caller-described constructors
    /// intentionally carry unknown posture.
    pub fn from_bound_listener(listener: &std::net::TcpListener) -> std::io::Result<Self> {
        let address = listener.local_addr()?;
        let mut context = Self::new(
            address.ip().to_string(),
            address.port(),
            address.ip().is_loopback(),
        );
        context.record_bound_address(address);
        Ok(context)
    }

    /// Build a context for a bound listener. The admin token is read once from
    /// `SNAPBACK_ADMIN_TOKEN`; an empty value is treated as unset. This legacy
    /// caller-described form does not establish listener transport authority;
    /// network session embedders use `server::app(state).bind(listener)`.
    pub fn new(host: impl Into<String>, port: u16, loopback: bool) -> Self {
        Self {
            host: host.into(),
            port,
            loopback,
            listener_transport: ListenerTransportPosture::Unknown,
            dev_auth_origins: env_dev_auth_origins(),
            profile: env_profile(loopback),
            auth_deployment: crate::auth::deployment::AuthDeploymentTarget::Local,
            pid: std::process::id(),
            started: Instant::now(),
            started_at_ms: now_millis(),
            admin_token: env_admin_token(),
            admin_token_minted: false,
            admin_token_file: None,
            console_credentials: ConsoleCredentialRegistry::default(),
            console_approvals: ConsoleApprovalRegistry::default(),
            console_claims: ConsoleClaimRegistry::default(),
            admin_dist: env_admin_dist(),
        }
    }

    /// A context for embedded or test use where the bind address is unknown.
    /// Legacy dev tooling retains loopback-open defaults, but the independent
    /// listener posture stays unknown and therefore cannot carry sessions.
    pub fn detached() -> Self {
        Self {
            host: "127.0.0.1".to_owned(),
            port: 0,
            loopback: true,
            listener_transport: ListenerTransportPosture::Unknown,
            dev_auth_origins: env_dev_auth_origins(),
            profile: env_profile(true),
            auth_deployment: crate::auth::deployment::AuthDeploymentTarget::Local,
            pid: std::process::id(),
            started: Instant::now(),
            started_at_ms: now_millis(),
            admin_token: env_admin_token(),
            admin_token_minted: false,
            admin_token_file: None,
            console_credentials: ConsoleCredentialRegistry::default(),
            console_approvals: ConsoleApprovalRegistry::default(),
            console_claims: ConsoleClaimRegistry::default(),
            admin_dist: env_admin_dist(),
        }
    }

    /// Record the socket address returned by the listener that will serve this
    /// exact context. This is deliberately crate-private: callers that merely
    /// construct a Router never receive the authority to assert where it was
    /// bound.
    // @ref LLP 0060#d1-plaintext-listener-fence — session transport posture is
    // listener-owned, never a caller-supplied loopback boolean.
    pub(crate) fn record_bound_address(&mut self, address: std::net::SocketAddr) {
        self.host = address.ip().to_string();
        self.port = address.port();
        self.loopback = address.ip().is_loopback();
        self.listener_transport = if self.loopback {
            ListenerTransportPosture::Loopback
        } else {
            ListenerTransportPosture::NonLoopback
        };
    }

    pub(crate) fn listener_transport_loopback(&self) -> Option<bool> {
        match self.listener_transport {
            ListenerTransportPosture::Unknown => None,
            ListenerTransportPosture::Loopback => Some(true),
            ListenerTransportPosture::NonLoopback => Some(false),
        }
    }

    /// The HTTP origin owned by the listener configuration. `bind` refreshes
    /// these fields from the consumed socket before any network request can be
    /// served, so request headers never participate in advertised authority.
    pub(crate) fn listener_http_origin(&self) -> Option<String> {
        let authority = match self.host.parse::<std::net::IpAddr>() {
            Ok(address) => std::net::SocketAddr::new(address, self.port).to_string(),
            Err(_) => format!("{}:{}", self.host, self.port)
                .parse::<axum::http::uri::Authority>()
                .ok()?
                .to_string(),
        };
        Some(format!("http://{authority}"))
    }

    pub(crate) fn permits_dev_body_origin(&self, origin: &HeaderValue) -> bool {
        let Some(origin) = origin
            .to_str()
            .ok()
            .and_then(canonical_loopback_http_origin)
        else {
            return false;
        };
        self.listener_http_origin().as_deref() == Some(origin.as_str())
            || self.dev_auth_origins.contains(&origin)
    }

    #[cfg(test)]
    pub(crate) fn allow_dev_auth_origin_for_test(&mut self, origin: &str) {
        let origin = canonical_loopback_http_origin(origin)
            .expect("test Dev auth origin must be an exact loopback HTTP(S) origin");
        self.dev_auth_origins.insert(origin);
    }

    /// Install a serve-time resolved admin token (ENG-23443): the serve path
    /// calls this when `SNAPBACK_ADMIN_TOKEN` is unset on a loopback bind, so
    /// a served instance is never tokenless for writes.
    pub fn install_minted_token(&mut self, resolved: &ResolvedAdminToken) {
        self.admin_token = Some(resolved.token.clone());
        self.admin_token_minted = resolved.minted;
        self.admin_token_file = resolved.file.clone();
    }

    /// Reattach the digest-only browser credential store beside a file-backed
    /// database. Memory targets deliberately retain process-local credentials.
    ///
    /// @ref LLP 0017#security-defaults — restart continuity persists only
    /// derived, expiring SHA-256 digests; the master token stays in its
    /// separate capability file and never enters this store.
    pub fn install_console_credential_store(
        &mut self,
        database_path: &FsPath,
    ) -> anyhow::Result<()> {
        self.console_credentials =
            ConsoleCredentialRegistry::persistent(console_credential_sibling(database_path))?;
        Ok(())
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
    /// the value may be printed once on interactive stdout; captured stdout
    /// receives only the owner-only file hand-off (LLP 0036 D3).
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

/// Digest-only console credential persistence beside a file-backed database.
pub fn console_credential_sibling(path: &std::path::Path) -> PathBuf {
    let mut name = path
        .file_name()
        .map(|name| name.to_os_string())
        .unwrap_or_default();
    name.push(".console-credentials");
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
    /// Cloneable loss-tolerant producer for request and detached-runtime
    /// seams. It never lends the app database lock to telemetry.
    pub telemetry: crate::telemetry::Telemetry,
    pub server: Arc<ServerContext>,
    /// Exact published origins and claim/credential-bound leases for the two
    /// managed claim-link fronts. This state is process-local by design: a
    /// startup-nonce change invalidates every admission without recovery.
    pub(crate) console_reachability: ConsoleReachabilityRegistry,
    /// Process-local network condition selection shared by HTTP egress and
    /// Local's post-commit live preparation.
    pub(crate) network_profiles: crate::network_profile::NetworkProfileState,
    /// Present only when the serving process installed the off-turn live
    /// scheduler. Request mutation paths clone this gate before entering the
    /// staged write wrapper; detached and embedded callers keep legacy mutex
    /// behavior by leaving it absent.
    pub(crate) live_fanout_coalescer: Option<Arc<crate::live_coalesce::LiveFanoutCoalescer>>,
    /// Per-attempt serialization across the TUS durable-append/offset-CAS
    /// window. This is independent of the global Local writer, so one slow
    /// staging sync does not stall unrelated database work.
    pub(crate) asset_tus_patch_gates: crate::assets_store::AssetTusPatchGates,
    /// Per-connection capability grants (ENG-23442): connection-scoped routes
    /// demand the token minted by `POST /connection/open`.
    pub connections: ConnectionRegistry,
    /// Shared advisory connectivity witnesses for this exact app process.
    pub(crate) connected_clients: crate::connected_clients::ConnectedClientRegistry,
    /// Pending-registration owners for bundle register mode plus the
    /// per-authority bundle rate limiter (LLP 0031 dated LLP 0090 amendment;
    /// LLP 0092 §0D.4 bounds and reaping). Public for the acceptance suite;
    /// handlers and the maintenance sweep are the only production writers.
    pub bundle_pending: crate::bundle::PendingBundleRegistry,
    /// Terminal invalidation shares the exact registry and delivery notifier
    /// installed in this app state. The pre-bind expiry worker receives a
    /// clone, so readiness cannot accidentally describe a different graph.
    pub(crate) auth_terminal_lifecycle: AuthTerminalLifecycle,
    /// Exact process-local publication/effect fences for finite scoped-token
    /// authority. The same registry is installed on the protected auth store
    /// so terminal SQLite commits premark matching request/connection leaves.
    pub(crate) service_authority_fences: crate::auth::service_fence::ServiceAuthorityFenceRegistry,
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
    /// Launcher-declared activation target for the server-owned operational
    /// predicate. Process-local by design: every fresh process begins
    /// undeclared and therefore fails readiness closed.
    expected_activation_target:
        Arc<StdRwLock<Option<Arc<crate::operational_readiness::ExpectedActivationTargetV1>>>>,
    /// Single process-local registry shared by every router clone. Raw apply
    /// tokens never leave this registry except in the one preview response.
    pub(crate) data_patch_tokens: crate::data_patch::DataPatchTokenStore,
    /// CLI-only, process-local opt-in for exposing dev body authority on a
    /// non-loopback bind. Production profiles never honor this bit.
    pub(crate) allow_insecure_dev_auth: bool,
    /// Digest-only registry for reset-bounded administrative data leases.
    pub secret_reads: SecretReadLeaseRegistry,
    /// Process-local HMAC root for immutable telemetry export continuations.
    /// A restart deliberately invalidates outstanding agent-page tokens.
    pub(crate) telemetry_export_continuation_key: Arc<[u8; 32]>,
    /// Bounded most-recent-first ring of recent function runs and artifact
    /// loads, projected by `app.inspect` as `data.recentInvocations`.
    ///
    /// @ref LLP 0042#diagnostics-reading--an-appinspect-extension-not-a-new-operation —
    ///   the SC-1a non-deferrable diagnostics minimum; identical over HTTP and MCP.
    pub(crate) recent_invocations: crate::host_ops::RecentInvocationRing,
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
    /// Digest-only request-side half of the per-boot developer-identity
    /// capability. The raw operator half is consumed by CLI custody before
    /// readiness and never enters router state.
    pub(crate) dev_identity_capabilities:
        Option<crate::dev_identity::DevIdentityCapabilityRegistry>,
    /// Independent digest-only request half for production integration
    /// retirement. It is never a browser-console credential.
    pub(crate) agent_destroy_capabilities:
        Option<crate::admin_agent_destroy::AgentDestroyCapabilityRegistry>,
    /// Optional email-code provider projection. Startup activation is owned by
    /// the staged-mode composition lane; embeddings and tests may install an
    /// already-activated provider through the builder below.
    pub(crate) auth_provider: Option<Arc<AuthProvider>>,
    /// Process-local capability projection for live grants minted by this
    /// boot. Restart invalidates every durable grant, while revoke and expiry
    /// remove entries without erasing protected rehearsal history.
    pub(crate) auth_rehearsal_live_grants: crate::auth::rehearsal::RehearsalLiveAuthorityRegistry,
    /// Item-5 process authority. Production construction publishes this only
    /// after the durable stream migration and complete pre-bind rebuild.
    pub(crate) auth_coordinator: Option<Arc<crate::auth::coordinator::AuthCoordinator>>,
    /// Provider-authenticated hosted origin/admission authority. It is absent
    /// on every local target and cannot be synthesized from request headers.
    pub(crate) hosted_serving: Option<crate::auth::deployment::HostedServingHandle>,
    /// LLP 0158 identity captured from the instance's boot-validated database
    /// lineage and mint receipt while the trusted AppState builder owns it.
    /// Primary instances carry `None`; no request or selector can assert this.
    pub(crate) derived_instance_identity: Option<crate::instance_fork::DerivedForkLineageV1>,
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
    /// Fallibly wrap the exact shared write/read/ephemeral graph.
    ///
    /// Busy mutex ownership, wrapping an already-owned graph, and system
    /// entropy failure are typed embedding errors; none unwind through this
    /// supported low-level path.
    pub fn try_new(
        snapback: SharedSnapback,
        read: ReadLane,
        ephemeral: EphemeralApi,
        server: ServerContext,
    ) -> SnapbackResult<Self> {
        Ok(Self::try_new_with_secret_read_operator(snapback, read, ephemeral, server)?.0)
    }

    /// Infallible compatibility wrapper for pre-0.1 embedding callers.
    ///
    /// Panics if [`Self::try_new`] returns an embedding diagnostic. New code
    /// should use the fallible constructor.
    #[deprecated(note = "use AppState::try_new to handle embedding construction failures")]
    pub fn new(
        snapback: SharedSnapback,
        read: ReadLane,
        ephemeral: EphemeralApi,
        server: ServerContext,
    ) -> Self {
        Self::try_new(snapback, read, ephemeral, server)
            .expect("AppState::new compatibility wrapper failed; use AppState::try_new")
    }

    /// Trusted embedding seam for operator-plane lease minting. The returned
    /// capability is never placed in router state or accepted by a handler.
    pub(crate) fn try_new_with_secret_read_operator(
        snapback: SharedSnapback,
        read: ReadLane,
        ephemeral: EphemeralApi,
        server: ServerContext,
    ) -> SnapbackResult<(Self, SecretReadOperator)> {
        let (secret_reads, operator) =
            SecretReadLeaseRegistry::new(read.secret_read_reset_generation());
        let telemetry_export_continuation_key = telemetry_export_continuation_key()?;
        let auth_admission = read.admission_controller();
        let connections = ConnectionRegistry::default();
        let network_profiles = crate::network_profile::NetworkProfileState::new();
        let (
            service_authority_fences,
            telemetry,
            derived_instance_identity,
            auth_rehearsal_live_grants,
            connected_clients,
        ) = {
            let mut instance = snapback.try_lock().map_err(|_| {
                SnapbackError::error(
                    "SNAPBACK_EMBED_APP_STATE_BUSY",
                    "embed",
                    "the SharedSnapback graph is busy; release its write lock before constructing AppState",
                )
            })?;
            let telemetry = instance.telemetry();
            let derived_instance_identity = instance.derived_fork_identity().cloned();
            let auth_rehearsal_live_grants = instance.auth_rehearsal_live_registry();
            let connected_clients = instance.connected_client_registry();
            let service_authority_fences = {
                let database = instance.auth_database_mut();
                if !database.claim_app_state_graph() {
                    return Err(SnapbackError::error(
                        "SNAPBACK_EMBED_APP_STATE_ALREADY_OWNED",
                        "embed",
                        "one SharedSnapback graph already belongs to an AppState; clone that AppState for additional routers",
                    ));
                }
                database.service_authority_fence_registry()
            };
            instance.install_network_profile_state(network_profiles.clone());
            (
                service_authority_fences,
                telemetry,
                derived_instance_identity,
                auth_rehearsal_live_grants,
                connected_clients,
            )
        };
        let auth_terminal_lifecycle = AuthTerminalLifecycle::new(
            connections.clone(),
            connected_clients.clone(),
            &ephemeral,
            snapback.clone(),
        );
        Ok((
            Self {
                snapback,
                read,
                ephemeral,
                telemetry,
                server: Arc::new(server),
                console_reachability: ConsoleReachabilityRegistry::default(),
                network_profiles,
                live_fanout_coalescer: None,
                asset_tus_patch_gates: crate::assets_store::AssetTusPatchGates::default(),
                connections,
                connected_clients,
                bundle_pending: crate::bundle::PendingBundleRegistry::default(),
                auth_terminal_lifecycle,
                service_authority_fences,
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
                expected_activation_target: Arc::new(StdRwLock::new(None)),
                data_patch_tokens: crate::data_patch::DataPatchTokenStore::default(),
                allow_insecure_dev_auth: false,
                secret_reads,
                telemetry_export_continuation_key: Arc::new(telemetry_export_continuation_key),
                recent_invocations: crate::host_ops::RecentInvocationRing::default(),
                secret_read_mint: None,
                impersonation_capabilities: None,
                dev_identity_capabilities: None,
                agent_destroy_capabilities: None,
                auth_provider: None,
                auth_rehearsal_live_grants,
                auth_coordinator: None,
                hosted_serving: None,
                derived_instance_identity,
                auth_catalog_ready: false,
                auth_invalidation: Arc::new(StdRwLock::new(None)),
                authorized_lease_config: AuthorizedLeaseConfig::default(),
                #[cfg(test)]
                fail_auth_mode_publication: Arc::new(std::sync::atomic::AtomicBool::new(false)),
                #[cfg(test)]
                projection_handoff_limit_for_test: crate::ephemeral::MAX_OUTBOX_HANDOFF_BYTES,
            },
            operator,
        ))
    }

    // Source-test boundary for the fallible construction core below.
    // FALLIBLE_CONSTRUCTION_CORE_END

    fn network_profile_authority(&self) -> crate::network_profile::NetworkProfileAuthority {
        crate::network_profile::NetworkProfileAuthority::classified(
            self.server.profile,
            self.server.auth_deployment,
            self.hosted_serving.is_some(),
            self.derived_instance_identity.is_some(),
        )
    }

    /// LLP 0184 §B's (and, when it lands, §A's) *local-non-production-only*
    /// target rule for operator debug perturbations more dangerous than a
    /// network-profile activation. This deliberately does NOT reuse
    /// [`Self::network_profile_authority`]'s `permits` predicate: that gate
    /// extends an explicit hosted-derived exception LLP 0158 grants "solely
    /// for network-profile activation" (its own text) — a different,
    /// narrower grant than the one these perturbations would need. Until
    /// LLP 0158's owner makes that grant for this purpose, every derived
    /// instance (local or hosted) and every hosted/production target is
    /// refused; only a local, non-production, non-derived instance is
    /// eligible.
    ///
    /// @ref LLP 0184#b-forced-live-resync--add-now — "Target rule matches
    ///   §A's: local non-production instances in v1; refused on a primary
    ///   hosted/production target; refused on a derived instance too until
    ///   LLP 0158 grants recognition for this purpose."
    pub(crate) fn debug_perturbation_target_authority(&self) -> Result<(), SnapbackError> {
        let authority = self.network_profile_authority();
        let allowed = matches!(
            authority.server_profile,
            Some(ServerProfile::Dev | ServerProfile::Demo | ServerProfile::Test)
        ) && matches!(
            authority.deployment,
            Some(crate::auth::deployment::AuthDeploymentTarget::Local)
        ) && authority.derived_instance_present == Some(false);
        if allowed {
            return Ok(());
        }
        Err(SnapbackError::error(
            "SNAPBACK_DEBUG_PERTURBATION_TARGET_REFUSED",
            "debug",
            "this operator debug perturbation is local-non-production-only in v1; refused on a primary hosted/production target and on any derived instance until LLP 0158 grants recognition for this purpose",
        )
        .with_details(serde_json::json!({
            "serverProfile": authority.server_profile.map(ServerProfile::as_str),
            "deployment": authority.deployment.map(|deployment| match deployment {
                crate::auth::deployment::AuthDeploymentTarget::Local => "local",
                crate::auth::deployment::AuthDeploymentTarget::Hosted => "hosted",
            }),
            "hostedServingPresent": authority.hosted_serving_present,
            "derivedInstancePresent": authority.derived_instance_present,
        })))
    }

    /// Both startup and runtime surfaces terminate at this one state-changing
    /// gate; callers may parse different transport representations but cannot
    /// select around classification or provenance capture.
    ///
    /// @ref LLP 0167#authority-one-activation-chokepoint — ServerProfile,
    ///   hosted-serving authority, and boot-validated derived identity are
    ///   checked together, fail closed.
    pub(crate) fn activate_network_profile(
        &self,
        profile: crate::network_profile::NetworkConditionProfile,
        source: crate::network_profile::NetworkProfileSource,
        principal: Option<String>,
    ) -> Result<Arc<crate::network_profile::ActiveNetworkProfile>, SnapbackError> {
        self.network_profiles
            .activate(profile, self.network_profile_authority(), source, principal)
    }

    pub(crate) fn activate_network_profile_env(
        &self,
        raw: Option<&str>,
    ) -> Result<Arc<crate::network_profile::ActiveNetworkProfile>, SnapbackError> {
        let profile = raw.map_or_else(
            || Ok(crate::network_profile::NetworkConditionProfile::normal()),
            crate::network_profile::NetworkConditionProfile::parse_env,
        )?;
        self.activate_network_profile(
            profile,
            crate::network_profile::NetworkProfileSource::Env,
            None,
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

    pub fn with_dev_identity_capabilities(
        mut self,
        registry: crate::dev_identity::DevIdentityCapabilityRegistry,
    ) -> Self {
        self.dev_identity_capabilities = Some(registry);
        self
    }

    pub fn with_agent_destroy_capabilities(
        mut self,
        registry: crate::admin_agent_destroy::AgentDestroyCapabilityRegistry,
    ) -> Self {
        self.agent_destroy_capabilities = Some(registry);
        self
    }

    /// Deterministic integration-test seam for expiry without waiting. The
    /// production constructor always uses the fixed one-minute TTL.
    #[doc(hidden)]
    pub fn with_data_patch_token_ttl_ms(mut self, ttl_ms: u64) -> Self {
        self.data_patch_tokens = crate::data_patch::DataPatchTokenStore::new(
            ttl_ms,
            crate::data_patch::DATA_PATCH_TOKEN_CAPACITY,
        );
        self
    }

    pub(crate) fn with_live_fanout_coalescer(
        mut self,
        coalescer: Arc<crate::live_coalesce::LiveFanoutCoalescer>,
    ) -> Self {
        self.live_fanout_coalescer = Some(coalescer);
        self
    }

    /// Install an already-constructed provider without changing auth-mode
    /// posture or performing catalog activation.
    pub fn try_with_auth_provider(mut self, provider: Arc<AuthProvider>) -> SnapbackResult<Self> {
        let (coordinator, catalog_ready) = {
            let mut snapback = self.snapback.try_lock().map_err(|_| {
                SnapbackError::error(
                    "SNAPBACK_EMBED_APP_STATE_BUSY",
                    "embed",
                    "the SharedSnapback graph is busy; release its write lock before installing the auth provider",
                )
            })?;
            let database = snapback.auth_database_mut();
            let incarnation = database.ensure_authorization_stream_incarnation()?;
            let catalog_ready = match database.inspect_auth_catalog() {
                Ok(state) => state.is_ready(),
                Err(error) if error.diagnostic.code == "SNAPBACK_AUTH_TABLE_COLLISION" => false,
                Err(error) => return Err(error),
            };
            let source = if catalog_ready {
                database.session_projection_source()?
            } else {
                crate::auth::session_projection::ProjectionSource {
                    authorization_stream_value:
                        crate::auth::session_projection::AuthorizationStreamRecord::new(incarnation)
                            .encode_bytes()?,
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
                )?;
            (
                Arc::new(crate::auth::coordinator::AuthCoordinator::new(projection)?),
                catalog_ready,
            )
        };
        self.auth_provider = Some(provider);
        self.auth_coordinator = Some(coordinator);
        self.auth_catalog_ready = catalog_ready;
        Ok(self)
    }

    /// Infallible compatibility wrapper. Prefer [`Self::try_with_auth_provider`]
    /// in embedding code so caller and storage failures remain typed.
    #[deprecated(note = "use AppState::try_with_auth_provider")]
    pub fn with_auth_provider(self, provider: Arc<AuthProvider>) -> Self {
        self.try_with_auth_provider(provider).expect(
            "AppState::with_auth_provider compatibility wrapper failed; use try_with_auth_provider",
        )
    }

    /// The capability tuple carried by a verified hosted admission, if one is
    /// installed. `None` for every local deployment.
    ///
    /// @ref LLP 0098#41-composition — the published descriptor comes from the
    /// verified attestation, never from a build constant.
    pub(crate) fn hosted_serving_capabilities(
        &self,
    ) -> Option<crate::auth::deployment::HostedAuthCapabilities> {
        self.hosted_serving
            .as_ref()
            .and_then(|handle| handle.current())
            .map(|authority| authority.capabilities())
    }

    /// The hot-swap slot, for the renewal loop. `None` on every local target.
    pub(crate) fn hosted_serving_handle(
        &self,
    ) -> Option<crate::auth::deployment::HostedServingHandle> {
        self.hosted_serving.clone()
    }

    /// Install the target-authenticated hosted serving authority and create
    /// its replay/nonce tables before any request can observe hosted posture.
    #[allow(dead_code)] // First concrete adapter composition is the next LLP 0072 tranche.
    pub(crate) fn with_hosted_serving_authority(
        mut self,
        authority: crate::auth::deployment::HostedServingAuthority,
    ) -> Result<Self, SnapbackError> {
        if self.server.auth_deployment != crate::auth::deployment::AuthDeploymentTarget::Hosted {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_HOSTED_ADMISSION_INVALID",
                "auth-deployment",
                "hosted serving authority requires a hosted target context",
            ));
        }
        {
            let mut snapback = self.snapback.try_lock().map_err(|_| {
                SnapbackError::error(
                    "SNAPBACK_AUTH_SENDER_PROOF_AUTHORITY_UNAVAILABLE",
                    "auth",
                    "sender proof authority could not be initialized",
                )
            })?;
            snapback
                .auth_database_mut()
                .initialize_sender_proof_after_hosted_preflight()?;
            snapback
                .auth_database_mut()
                .initialize_authentication_throttle_after_hosted_preflight()
                .map_err(|_| {
                    SnapbackError::error(
                        "SNAPBACK_AUTH_THROTTLE_UNAVAILABLE",
                        "auth",
                        "shared authentication throttle could not be initialized",
                    )
                })?;
            // @ref LLP 0077#author-decisions--2026-07-23 — decision 1: the
            // control-plane monotone floor is applied before any request can
            // observe hosted posture, so a raw backup rollback of the durable
            // set cannot resurrect an accepted proof or nonce.
            snapback
                .auth_database_mut()
                .apply_sender_replay_epoch_floor(authority.sender_replay_epoch_floor())?;
        }
        self.hosted_serving = Some(crate::auth::deployment::HostedServingHandle::new(authority));
        Ok(self)
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

    pub(crate) fn expected_activation_target(
        &self,
    ) -> Option<Arc<crate::operational_readiness::ExpectedActivationTargetV1>> {
        self.expected_activation_target
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    pub(crate) fn declare_expected_activation_target(
        &self,
        target: crate::operational_readiness::ExpectedActivationTargetV1,
    ) -> Arc<crate::operational_readiness::ExpectedActivationTargetV1> {
        let target = Arc::new(target);
        *self
            .expected_activation_target
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(target.clone());
        target
    }

    /// Pre-bind transport validation used by the CLI composition lane. The
    /// request middleware repeats the same policy as defense in depth.
    ///
    /// @ref LLP 0060#d1-plaintext-listener-fence — this local listener check
    /// does not attest a public reverse proxy or any hosted edge capability.
    pub fn validate_auth_transport(&self) -> Result<(), SnapbackError> {
        if self.server.auth_deployment == crate::auth::deployment::AuthDeploymentTarget::Hosted {
            return self
                .hosted_serving
                .as_ref()
                .and_then(|handle| handle.current())
                .ok_or_else(|| {
                    crate::auth::deployment::deployment_unsupported(
                        crate::auth::deployment::HostedAuthCapabilities::local_target(),
                    )
                })?
                .admission_epoch_at(now_millis())
                .map(|_| ());
        }
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
    pub fn try_from_snapback(
        snapback: LocalSnapback,
        server: ServerContext,
    ) -> SnapbackResult<Self> {
        let read = snapback.read_lane();
        let ephemeral = snapback.ephemeral_api();
        Self::try_new(Arc::new(Mutex::new(snapback)), read, ephemeral, server)
    }

    /// Infallible compatibility wrapper. Prefer [`Self::try_from_snapback`].
    #[deprecated(note = "use AppState::try_from_snapback")]
    pub fn from_snapback(snapback: LocalSnapback, server: ServerContext) -> Self {
        Self::try_from_snapback(snapback, server)
            .expect("AppState::from_snapback compatibility wrapper failed; use try_from_snapback")
    }

    /// Trusted embedding variant that retains the non-network minting seam.
    pub fn try_from_snapback_with_secret_read_operator(
        snapback: LocalSnapback,
        server: ServerContext,
    ) -> SnapbackResult<(Self, SecretReadOperator)> {
        let read = snapback.read_lane();
        let ephemeral = snapback.ephemeral_api();
        Self::try_new_with_secret_read_operator(
            Arc::new(Mutex::new(snapback)),
            read,
            ephemeral,
            server,
        )
    }

    /// Infallible compatibility wrapper. Prefer
    /// [`Self::try_from_snapback_with_secret_read_operator`].
    #[deprecated(note = "use AppState::try_from_snapback_with_secret_read_operator")]
    pub fn from_snapback_with_secret_read_operator(
        snapback: LocalSnapback,
        server: ServerContext,
    ) -> (Self, SecretReadOperator) {
        Self::try_from_snapback_with_secret_read_operator(snapback, server).expect(
            "AppState::from_snapback_with_secret_read_operator compatibility wrapper failed; use the fallible constructor",
        )
    }

    pub fn try_detached(snapback: LocalSnapback) -> SnapbackResult<Self> {
        Self::try_from_snapback(snapback, ServerContext::detached())
    }

    /// Infallible compatibility wrapper. Prefer [`Self::try_detached`].
    #[deprecated(note = "use AppState::try_detached")]
    pub fn detached(snapback: LocalSnapback) -> Self {
        Self::try_detached(snapback)
            .expect("AppState::detached compatibility wrapper failed; use try_detached")
    }
}

fn telemetry_export_continuation_key() -> SnapbackResult<[u8; 32]> {
    telemetry_export_continuation_key_with(|key| getrandom::fill(key).map_err(|_| ()))
}

fn telemetry_export_continuation_key_with(
    fill: impl FnOnce(&mut [u8; 32]) -> Result<(), ()>,
) -> SnapbackResult<[u8; 32]> {
    let mut key = [0_u8; 32];
    fill(&mut key).map_err(|()| {
        SnapbackError::error(
            "SNAPBACK_EMBED_ENTROPY_UNAVAILABLE",
            "embed",
            "system entropy is unavailable for AppState construction",
        )
    })?;
    Ok(key)
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

impl FromRef<AppState> for ConsoleReachabilityRegistry {
    fn from_ref(state: &AppState) -> Self {
        state.console_reachability.clone()
    }
}

#[derive(Clone)]
struct ConsoleServerInstanceId(Arc<str>);

impl FromRef<AppState> for ConsoleServerInstanceId {
    fn from_ref(state: &AppState) -> Self {
        Self(state.server_startup_nonce.clone())
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

fn reserve_secret_read_bytes(
    secret_reads: &SecretReadLeaseRegistry,
    headers: &HeaderMap,
    scopes: &BTreeSet<SecretReadScope>,
    rows: usize,
    bytes: usize,
) -> Result<(), ApiError> {
    let bearer = headers
        .get(SECRET_READ_LEASE_HEADER)
        .and_then(|value| value.to_str().ok());
    let permit = secret_reads.authorize(bearer)?;
    secret_reads.reserve(
        &permit,
        scopes,
        u64::try_from(rows).unwrap_or(u64::MAX),
        u64::try_from(bytes).unwrap_or(u64::MAX),
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

/// Bearer-free identity of the concrete credential that satisfied this
/// protected-erasure AdminWrite request. The raw token never leaves this
/// resolver and cannot enter a receipt or diagnostic.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ProtectedErasureAdminCredentialBinding {
    credential_class: &'static str,
    credential_digest_sha256: String,
}

impl ProtectedErasureAdminCredentialBinding {
    pub(crate) fn credential_class(&self) -> &'static str {
        self.credential_class
    }

    pub(crate) fn credential_digest_sha256(&self) -> &str {
        &self.credential_digest_sha256
    }

    #[cfg(test)]
    pub(crate) fn for_test(credential_class: &'static str, credential: &str) -> Self {
        Self {
            credential_class,
            credential_digest_sha256: encode_console_credential_digest(&console_credential_digest(
                credential,
            )),
        }
    }
}

pub(crate) fn resolve_protected_erasure_admin_credential(
    ctx: &ServerContext,
    headers: &HeaderMap,
    mode: PolicyAuthMode,
) -> Result<ProtectedErasureAdminCredentialBinding, ApiError> {
    authorize_for_mode(ctx, headers, true, mode)?;
    if let Some(credential) = provided_console_credential(headers)
        && ctx.console_credentials.allows(Some(credential))
    {
        return Ok(ProtectedErasureAdminCredentialBinding {
            credential_class: "console",
            credential_digest_sha256: encode_console_credential_digest(&console_credential_digest(
                credential,
            )),
        });
    }
    let credential = provided_token(headers, mode == PolicyAuthMode::Dev).ok_or_else(|| {
        ApiError::from(SnapbackError::error(
            "SNAPBACK_PROTECTED_ERASURE_AUTHORITY_INVALID",
            "admin",
            "protected-record erasure requires a concrete validated admin credential",
        ))
    })?;
    Ok(ProtectedErasureAdminCredentialBinding {
        credential_class: "master-admin",
        credential_digest_sha256: encode_console_credential_digest(&console_credential_digest(
            &credential,
        )),
    })
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
        AdminAccess::TokenRequired => {
            Err(admin_token_required(ctx, provided.is_some(), "this admin write").into())
        }
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
        _ => Err(
            admin_token_required(ctx, provided.is_some(), "minting a console credential").into(),
        ),
    }
}

fn admin_token_required(ctx: &ServerContext, presented: bool, purpose: &str) -> SnapbackError {
    let acquisition = "send x-snapback-admin-token, set SNAPBACK_ADMIN_TOKEN for the CLI, or read the owner-only <ready-file>.admin-token sibling";
    let message = if presented {
        format!(
            "the admin token presented for {purpose} did not match the configured token; {acquisition}"
        )
    } else {
        format!("no admin token was presented for {purpose}; {acquisition}")
    };
    SnapbackError::error("SNAPBACK_ADMIN_TOKEN_REQUIRED", "admin", message).with_details(json!({
        "presented": presented,
        "header": "x-snapback-admin-token",
        "envVar": "SNAPBACK_ADMIN_TOKEN",
        "tokenFile": ctx.admin_token_file.as_ref().map(|path| path.display().to_string()),
        "tokenFileConvention": "<ready-file>.admin-token",
    }))
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
    let secret_read = |path| {
        RouteSpec::new(
            "GET",
            path,
            RouteClass::SystemApi,
            RoutePolicy::AdminSecretRead,
            CredentialResolution::AdminSecretReadLease,
            InvocationAuthority::Operator,
            LegacyBodyPolicy::NotApplicable,
            ResponseSensitivity::SensitiveApplicationData,
        )
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
            system_static_route("GET", "/_snapback/admin/reachability/identity"),
            get(console_reachability_identity),
        ),
        RegisteredRoute::new(
            read(
                "/_snapback/api/health",
                ResponseSensitivity::OperatorMetadata,
            ),
            get(admin_health),
        ),
        // @ref LLP 0184#1-controlcatalogv1 — the build catalog and instance
        // availability projection carry distinct, digest-bound identities;
        // these reads do not participate in invocation admission.
        // @ref LLP 0031#independent-policy-axes — operator discovery metadata
        // uses the ordinary AdminRead/AdminCredential/OperatorMetadata tuple.
        RegisteredRoute::new(
            read(
                "/_snapback/api/control-catalog",
                ResponseSensitivity::OperatorMetadata,
            ),
            get(admin_control_catalog),
        ),
        RegisteredRoute::new(
            read(
                "/_snapback/api/control-catalog/instance",
                ResponseSensitivity::OperatorMetadata,
            ),
            get(admin_control_catalog_instance),
        ),
        RegisteredRoute::new(
            read(
                "/_snapback/api/control-catalog/operations/{operation}",
                ResponseSensitivity::OperatorMetadata,
            ),
            get(admin_control_catalog_operation),
        ),
        // @ref LLP 0167#authority-one-activation-chokepoint — route policy
        //   authenticates read/write separately; PUT still terminates at the
        //   shared environment activation gate below.
        RegisteredRoute::new(
            read(
                "/_snapback/api/debug/network-profile",
                ResponseSensitivity::OperatorMetadata,
            ),
            get(admin_network_profile_get),
        ),
        RegisteredRoute::new(
            write(
                "PUT",
                "/_snapback/api/debug/network-profile",
                ResponseSensitivity::OperatorMetadata,
            ),
            put(admin_network_profile_put),
        ),
        // @ref LLP 0154#d5--the-query-contract-typed-operations-projected-everywhere —
        //   closed aggregates use ordinary admin authority; raw rows and
        //   snapshot exports use fixed, budgeted secret-read scopes.
        // @ref LLP 0031#enforcement — each telemetry carrier is installed
        //   from the same route metadata that drives authorization/no-store.
        RegisteredRoute::new(
            read(
                "/_snapback/api/telemetry/stats",
                ResponseSensitivity::OperatorMetadata,
            ),
            get(admin_telemetry_stats),
        ),
        RegisteredRoute::new(
            secret_read("/_snapback/api/telemetry/events"),
            get(admin_telemetry_events),
        ),
        RegisteredRoute::new(
            secret_read("/_snapback/api/telemetry/export"),
            get(admin_telemetry_export),
        ),
        // @ref LLP 0156#e14--surface-typed-operations-projected-everywhere-d5-discipline —
        //   the list is structural OperatorMetadata; only the detail route can
        //   reveal retained templates/stacks and therefore requires a bounded
        //   secret-read lease and inherits no-store.
        RegisteredRoute::new(
            read(
                "/_snapback/api/errors/issues",
                ResponseSensitivity::OperatorMetadata,
            ),
            get(admin_error_issues),
        ),
        RegisteredRoute::new(
            secret_read("/_snapback/api/errors/issue"),
            get(admin_error_issue),
        ),
        RegisteredRoute::new(
            write(
                "POST",
                "/_snapback/api/errors/transition",
                ResponseSensitivity::OperatorMetadata,
            ),
            post(admin_errors_transition),
        ),
        RegisteredRoute::new(
            write(
                "POST",
                "/_snapback/api/console/credential",
                ResponseSensitivity::CredentialSecret,
            ),
            post(mint_console_credential),
        ),
        // @ref LLP 0017#security-defaults — the claim is accepted only in a
        // POST body and is consumed under the process-local registry lock;
        // no route path or query component ever carries the bearer.
        RegisteredRoute::new(
            write(
                "POST",
                "/_snapback/api/console/claim",
                ResponseSensitivity::CredentialSecret,
            ),
            post(mint_console_claim),
        ),
        RegisteredRoute::new(
            system_api_route(
                "POST",
                "/_snapback/api/console/claim/exchange",
                RoutePolicy::AdminRead,
                ResponseSensitivity::CredentialSecret,
            ),
            post(exchange_console_claim),
        ),
        RegisteredRoute::new(
            write(
                "POST",
                "/_snapback/api/console/claim/status",
                ResponseSensitivity::CredentialSecret,
            ),
            post(status_console_claim),
        ),
        RegisteredRoute::new(
            write(
                "POST",
                "/_snapback/api/console/claim/revoke",
                ResponseSensitivity::CredentialSecret,
            ),
            post(revoke_console_claim),
        ),
        RegisteredRoute::new(
            write(
                "POST",
                "/_snapback/api/console/reachability/register",
                ResponseSensitivity::CredentialSecret,
            ),
            post(register_console_reachability),
        ),
        RegisteredRoute::new(
            write(
                "POST",
                "/_snapback/api/console/reachability/bind",
                ResponseSensitivity::CredentialSecret,
            ),
            post(bind_console_reachability),
        ),
        RegisteredRoute::new(
            write(
                "POST",
                "/_snapback/api/console/reachability/renew",
                ResponseSensitivity::CredentialSecret,
            ),
            post(renew_console_reachability),
        ),
        RegisteredRoute::new(
            write(
                "POST",
                "/_snapback/api/console/reachability/drop",
                ResponseSensitivity::CredentialSecret,
            ),
            post(drop_console_reachability),
        ),
        // @ref LLP 0017#security-defaults — the browser may create and poll a
        // bounded device request, but only a token-holding local terminal can
        // approve it and cause a derived credential to exist.
        RegisteredRoute::new(
            system_api_route(
                "POST",
                "/_snapback/api/console/approval/request",
                RoutePolicy::AdminRead,
                ResponseSensitivity::CredentialSecret,
            ),
            post(request_console_approval),
        ),
        RegisteredRoute::new(
            system_api_route(
                "POST",
                "/_snapback/api/console/approval/poll",
                RoutePolicy::AdminRead,
                ResponseSensitivity::CredentialSecret,
            ),
            post(poll_console_approval),
        ),
        RegisteredRoute::new(
            write(
                "POST",
                "/_snapback/api/console/approval/approve",
                ResponseSensitivity::CredentialSecret,
            ),
            post(approve_console_approval),
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
        // @ref LLP 0165#protected-deletion-authority-audit--2026-08-04 —
        // authority is derived from the registered AdminWrite invocation;
        // the body carries only retry identity and the exact row target.
        RegisteredRoute::new(
            write(
                "POST",
                "/_snapback/api/storage/protected-erasure",
                ResponseSensitivity::SensitiveApplicationData,
            ),
            post(admin_protected_record_erasure),
        ),
        // @ref LLP 0162#acceptance — row 4 publication is an explicit
        //   target-exact AdminWrite command; database open and range issuance
        //   never activate a coverage manifest.
        RegisteredRoute::new(
            write(
                "POST",
                "/_snapback/api/storage/operation-coverage/activate",
                ResponseSensitivity::OperatorMetadata,
            ),
            post(admin_operation_coverage_activate),
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
            read("/_snapback/api/cron", ResponseSensitivity::OperatorMetadata),
            get(admin_cron_list),
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
        // The injected-clock jobs drain (LLP 0070 first slice; LLP 0115
        // CV-9's deterministic seam) — the set-based sibling of the cron
        // forced tick. The body's optional `nowMs` is the injected clock;
        // acceptance never sleeps.
        RegisteredRoute::new(
            write(
                "POST",
                "/_snapback/api/jobs/drain",
                ResponseSensitivity::SensitiveApplicationData,
            )
            .with_invocation_authority(InvocationAuthority::System),
            post(admin_jobs_drain),
        ),
        // LLP 0143 OQ7's deterministic fixture driver. An injected clock is
        // accepted only while the provider endpoint is a local/test loopback
        // override; the production Expo endpoint can be driven only at wall
        // clock, so an admin credential cannot poll real receipts early.
        RegisteredRoute::new(
            write(
                "POST",
                "/_snapback/api/push/maintenance",
                ResponseSensitivity::SensitiveApplicationData,
            )
            .with_invocation_authority(InvocationAuthority::System),
            post(admin_push_maintenance),
        ),
        RegisteredRoute::new(
            read(
                "/_snapback/api/jobs",
                ResponseSensitivity::SensitiveApplicationData,
            )
            .with_session_overlay(SessionModeOverlay::secret_read()),
            get(admin_jobs_list),
        ),
        RegisteredRoute::new(
            read(
                "/_snapback/api/jobs/{id}",
                ResponseSensitivity::SensitiveApplicationData,
            )
            .with_session_overlay(SessionModeOverlay::secret_read()),
            get(admin_job_show),
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

async fn admin_telemetry_stats(
    State(runtime): State<AppState>,
    Query(request): Query<crate::telemetry_query::TelemetryStatsRequestV1>,
) -> Result<Json<crate::telemetry_query::TelemetryStatsResponseV1>, ApiError> {
    Ok(Json(runtime.telemetry.query_stats(&request)?))
}

async fn admin_control_catalog() -> Response {
    let mut response = Response::new(Body::from(crate::control_catalog::BUILD_CATALOG_BYTES));
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json; charset=utf-8"),
    );
    if let Some(digest) =
        crate::control_catalog::catalog_digest(crate::control_catalog::build_catalog())
        && let Ok(value) = HeaderValue::from_str(digest)
    {
        response.headers_mut().insert(
            HeaderName::from_static(crate::control_catalog::CATALOG_DIGEST_HEADER),
            value,
        );
    }
    response
}

async fn admin_control_catalog_instance(
    State(runtime): State<AppState>,
) -> Json<serde_json::Value> {
    Json(crate::control_catalog::instance_projection(&runtime))
}

async fn admin_control_catalog_operation(Path(operation): Path<String>) -> Response {
    let Some(entry) = crate::control_catalog::operation(&operation) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    Json(serde_json::json!({
        "schemaVersion": crate::control_catalog::CATALOG_SCHEMA_VERSION,
        "catalogDigest": crate::control_catalog::catalog_digest(crate::control_catalog::build_catalog()),
        "entry": entry,
    }))
    .into_response()
}

async fn admin_network_profile_get(
    State(runtime): State<AppState>,
) -> Json<crate::network_profile::ActiveNetworkProfile> {
    Json((*runtime.network_profiles.active()).clone())
}

async fn admin_network_profile_put(
    State(runtime): State<AppState>,
    headers: HeaderMap,
    Json(selection): Json<serde_json::Value>,
) -> Result<Json<crate::network_profile::ActiveNetworkProfile>, ApiError> {
    let profile = crate::network_profile::NetworkConditionProfile::parse_value(selection)?;
    // @ref LLP 0167#authority-one-activation-chokepoint — the browser console
    //   identifies its surface, while an unhinted headless PUT remains `api`;
    //   neither hint supplies authority or an operator principal.
    let source = if headers
        .get(crate::network_profile::NETWORK_PROFILE_SOURCE_HEADER)
        .and_then(|value| value.to_str().ok())
        == Some("console")
    {
        crate::network_profile::NetworkProfileSource::Console
    } else {
        crate::network_profile::NetworkProfileSource::Api
    };
    let active = runtime.activate_network_profile(profile, source, None)?;
    Ok(Json((*active).clone()))
}

async fn admin_telemetry_events(
    State(runtime): State<AppState>,
    State(secret_reads): State<SecretReadLeaseRegistry>,
    headers: HeaderMap,
    Query(request): Query<crate::telemetry_query::TelemetryEventsRequestV1>,
) -> Result<Json<crate::telemetry_query::TelemetryEventsResponseV1>, ApiError> {
    let scopes = BTreeSet::from([SecretReadScope::TelemetryEvents]);
    preflight_secret_read(&secret_reads, &headers, scopes.clone())?;
    let response = runtime.telemetry.query_events(&request)?;
    reserve_secret_read_json(
        &secret_reads,
        &headers,
        scopes,
        response.events.len(),
        &response,
    )?;
    Ok(Json(response))
}

async fn admin_error_issues(
    State(runtime): State<AppState>,
    Query(request): Query<crate::errors_query::ErrorsIssuesRequestV1>,
) -> Result<Json<crate::errors_query::ErrorsIssuesResponseV1>, ApiError> {
    Ok(Json(runtime.telemetry.query_error_issues(&request)?))
}

async fn admin_error_issue(
    State(runtime): State<AppState>,
    State(secret_reads): State<SecretReadLeaseRegistry>,
    headers: HeaderMap,
    Query(request): Query<crate::errors_query::ErrorsIssueRequestV1>,
) -> Result<Json<crate::errors_query::ErrorsIssueResponseV1>, ApiError> {
    let scopes = BTreeSet::from([SecretReadScope::ErrorsIssue]);
    preflight_secret_read(&secret_reads, &headers, scopes.clone())?;
    let response = runtime.telemetry.query_error_issue(&request)?;
    let rows = 1usize
        .saturating_add(response.exemplars.len())
        .saturating_add(response.transitions.len());
    reserve_secret_read_json(&secret_reads, &headers, scopes, rows, &response)?;
    Ok(Json(response))
}

async fn admin_errors_transition(
    State(runtime): State<AppState>,
    Json(request): Json<crate::errors_query::ErrorsTransitionRequestV1>,
) -> Result<Json<crate::errors_query::ErrorsTransitionResponseV1>, ApiError> {
    Ok(Json(runtime.telemetry.transition_errors(&request)?))
}

fn append_ndjson<T: Serialize>(target: &mut Vec<u8>, value: &T) -> Result<(), ApiError> {
    serde_json::to_writer(&mut *target, value).map_err(|error| {
        ApiError::from(SnapbackError::error(
            "SNAPBACK_TELEMETRY_EXPORT_SERIALIZATION_FAILED",
            "telemetry",
            format!("failed to serialize telemetry export record: {error}"),
        ))
    })?;
    target.push(b'\n');
    Ok(())
}

struct TelemetryExportStreamState {
    telemetry: crate::telemetry::Telemetry,
    request: crate::telemetry_query::TelemetryExportRequestV1,
    header: crate::telemetry_query::TelemetryExportHeaderV1,
    cursor: Option<crate::telemetry_query::TelemetryCursorV1>,
    secret_reads: SecretReadLeaseRegistry,
    headers: HeaderMap,
    scopes: BTreeSet<SecretReadScope>,
}

fn export_page_chunk(
    telemetry: &crate::telemetry::Telemetry,
    request: &crate::telemetry_query::TelemetryExportRequestV1,
    header: &crate::telemetry_query::TelemetryExportHeaderV1,
    cursor: Option<&crate::telemetry_query::TelemetryCursorV1>,
) -> Result<
    (
        Vec<u8>,
        usize,
        Option<crate::telemetry_query::TelemetryCursorV1>,
    ),
    ApiError,
> {
    let page = telemetry.export_page(
        request,
        header,
        cursor,
        crate::telemetry_query::MAX_EVENT_LIMIT,
    )?;
    let rows = page.records.len();
    let mut bytes = Vec::new();
    for record in page.records {
        append_ndjson(&mut bytes, &record)?;
    }
    Ok((bytes, rows, page.next_cursor))
}

async fn admin_telemetry_export(
    State(runtime): State<AppState>,
    State(secret_reads): State<SecretReadLeaseRegistry>,
    headers: HeaderMap,
    Query(request): Query<crate::telemetry_query::TelemetryExportRequestV1>,
) -> Result<Response, ApiError> {
    // @ref LLP 0158#the-runtime-plane--where-the-real-design-is — the direct
    // streaming carrier is the same data-egress family as telemetry.export
    // through host ops and must refuse before reading export rows.
    crate::server::with_snapback(&runtime.snapback, |snapback| {
        snapback.deny_derived_fork_egress(
            crate::instance_fork::EgressFamily::TelemetryExport,
            now_millis(),
        )
    })
    .await?;
    let scopes = BTreeSet::from([SecretReadScope::TelemetryExport]);
    preflight_secret_read(&secret_reads, &headers, scopes.clone())?;

    // Freeze the header exactly once, then unfold only bounded pages below
    // that snapshot. New rows can never enter a long-running export.
    let header = runtime.telemetry.begin_export(&request)?;
    let (first_page, first_rows, cursor) =
        export_page_chunk(&runtime.telemetry, &request, &header, None)?;
    let mut first_chunk = Vec::new();
    append_ndjson(&mut first_chunk, &header)?;
    first_chunk.extend(first_page);
    reserve_secret_read_bytes(
        &secret_reads,
        &headers,
        &scopes,
        first_rows,
        first_chunk.len(),
    )?;

    let state = cursor.map(|cursor| TelemetryExportStreamState {
        telemetry: runtime.telemetry,
        request,
        header,
        cursor: Some(cursor),
        secret_reads,
        headers,
        scopes,
    });
    let tail = futures_util::stream::try_unfold(state, |state| async move {
        let Some(mut state) = state else {
            return Ok::<_, std::io::Error>(None);
        };
        let (bytes, rows, cursor) = export_page_chunk(
            &state.telemetry,
            &state.request,
            &state.header,
            state.cursor.as_ref(),
        )
        .map_err(|error| std::io::Error::other(format!("{error:?}")))?;
        reserve_secret_read_bytes(
            &state.secret_reads,
            &state.headers,
            &state.scopes,
            rows,
            bytes.len(),
        )
        .map_err(|error| std::io::Error::other(format!("{error:?}")))?;
        state.cursor = cursor;
        let next = state.cursor.is_some().then_some(state);
        Ok(Some((Bytes::from(bytes), next)))
    });
    let body = Body::from_stream(
        futures_util::stream::once(
            async move { Ok::<_, std::io::Error>(Bytes::from(first_chunk)) },
        )
        .chain(tail),
    );
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/x-ndjson")
        .header(
            header::CONTENT_DISPOSITION,
            "attachment; filename=telemetry.ndjson",
        )
        .body(body)
        .map_err(|error| {
            SnapbackError::error(
                "SNAPBACK_TELEMETRY_EXPORT_RESPONSE_FAILED",
                "telemetry",
                format!("failed to construct telemetry export response: {error}"),
            )
            .into()
        })
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
            format_version: crate::server::ErrorResponseFormatVersion::V1,
            diagnostic: error.diagnostic,
            receipt: None,
            attribution: None,
            ephemeral_authority_instance: None,
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
    let inspect = crate::server::inspect_snapback(&snapback).await?;
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
/// persist, or slide an active derived credential within its absolute cap.
/// Initial minting remains master-only. Renewal is narrower still: loopback,
/// local deployment, dev profile, and dev auth policy only.
async fn mint_console_credential(
    State(ctx): State<Arc<ServerContext>>,
    State(reachability): State<ConsoleReachabilityRegistry>,
    State(policy_mode): State<PolicyAuthMode>,
    headers: HeaderMap,
) -> Result<Json<ConsoleCredentialResponse>, ApiError> {
    require_console_mint_posture(&ctx)?;
    if let Some(credential) = provided_console_credential(&headers) {
        require_console_renewal_posture(&ctx, policy_mode)?;
        let mut renewed = ctx.console_credentials.renew(credential)?.ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_ADMIN_TOKEN_REQUIRED",
                "admin",
                "renewing a console credential requires an active derived credential",
            )
        })?;
        renewed.reachability = reachability.binding_for_credential(credential);
        return Ok(Json(renewed));
    }
    authorize_master(&ctx, &headers, policy_mode)?;
    Ok(Json(ctx.console_credentials.mint()?))
}

async fn mint_console_claim(
    State(ctx): State<Arc<ServerContext>>,
    State(policy_mode): State<PolicyAuthMode>,
    headers: HeaderMap,
) -> Result<Json<ConsoleClaimMintResponse>, ApiError> {
    require_console_claim_posture(&ctx, policy_mode)?;
    authorize_master(&ctx, &headers, policy_mode)?;
    Ok(Json(ctx.console_claims.mint()?))
}

async fn exchange_console_claim(
    State(ctx): State<Arc<ServerContext>>,
    State(reachability): State<ConsoleReachabilityRegistry>,
    State(policy_mode): State<PolicyAuthMode>,
    peer: Option<Extension<ConnectInfo<SocketAddr>>>,
    Json(request): Json<ConsoleClaimCodeRequest>,
) -> Result<Json<ConsoleCredentialResponse>, ApiError> {
    require_console_claim_posture(&ctx, policy_mode)?;
    let transport_peer = peer
        .map(|Extension(ConnectInfo(address))| address.to_string())
        .ok_or_else(|| {
            console_claim_error(
                "SNAPBACK_ADMIN_CLAIM_UNAVAILABLE",
                "console claim exchange requires direct transport-peer metadata",
            )
        })?;
    let mut response = ctx.console_claims.exchange(
        &request.claim_code,
        transport_peer,
        &ctx.console_credentials,
    )?;
    response.reachability =
        match reachability.bind_redeemed_credential(&request.claim_code, &response.credential) {
            Ok(binding) => binding,
            Err(_) => {
                // The claim was consumed concurrently with loss of its managed
                // front. Revoke the just-issued credential before returning the
                // ordinary opaque claim refusal; it must never escape without its
                // tab/session binding.
                let _ = ctx
                    .console_claims
                    .revoke(&request.claim_code, &ctx.console_credentials);
                return Err(console_claim_invalid().into());
            }
        };
    Ok(Json(response))
}

async fn status_console_claim(
    State(ctx): State<Arc<ServerContext>>,
    State(policy_mode): State<PolicyAuthMode>,
    headers: HeaderMap,
    Json(request): Json<ConsoleClaimCodeRequest>,
) -> Result<Json<ConsoleClaimStatusResponse>, ApiError> {
    require_console_claim_posture(&ctx, policy_mode)?;
    authorize_master(&ctx, &headers, policy_mode)?;
    Ok(Json(
        ctx.console_claims
            .status(&request.claim_code, &ctx.console_credentials)?,
    ))
}

async fn revoke_console_claim(
    State(ctx): State<Arc<ServerContext>>,
    State(policy_mode): State<PolicyAuthMode>,
    headers: HeaderMap,
    Json(request): Json<ConsoleClaimCodeRequest>,
) -> Result<Json<ConsoleClaimStatusResponse>, ApiError> {
    require_console_claim_posture(&ctx, policy_mode)?;
    authorize_master(&ctx, &headers, policy_mode)?;
    Ok(Json(
        ctx.console_claims
            .revoke(&request.claim_code, &ctx.console_credentials)?,
    ))
}

async fn register_console_reachability(
    State(ctx): State<Arc<ServerContext>>,
    State(reachability): State<ConsoleReachabilityRegistry>,
    State(instance_id): State<ConsoleServerInstanceId>,
    State(policy_mode): State<PolicyAuthMode>,
    headers: HeaderMap,
    Json(request): Json<ConsoleReachabilityRegisterRequest>,
) -> Result<Json<ConsoleReachabilityLeaseResponse>, ApiError> {
    require_console_claim_posture(&ctx, policy_mode)?;
    authorize_master(&ctx, &headers, policy_mode)?;
    Ok(Json(
        reachability.register(&request.origin, &instance_id.0)?,
    ))
}

async fn bind_console_reachability(
    State(ctx): State<Arc<ServerContext>>,
    State(reachability): State<ConsoleReachabilityRegistry>,
    State(policy_mode): State<PolicyAuthMode>,
    headers: HeaderMap,
    Json(request): Json<ConsoleReachabilityClaimRequest>,
) -> Result<Json<ConsoleReachabilityLeaseResponse>, ApiError> {
    require_console_claim_posture(&ctx, policy_mode)?;
    authorize_master(&ctx, &headers, policy_mode)?;
    let claim_digest = ctx
        .console_claims
        .pending_claim_digest(&request.claim_code)?;
    let status = ctx
        .console_claims
        .status(&request.claim_code, &ctx.console_credentials)?;
    let claim_expires_at_ms = status.claim_expires_at_ms.ok_or_else(|| {
        console_claim_error(
            "SNAPBACK_ADMIN_RELAY_LEASE_STATUS_INVALID",
            "pending console claim omitted its expiry",
        )
    })?;
    Ok(Json(reachability.bind_claim(
        &request.session_id,
        claim_digest,
        claim_expires_at_ms,
    )?))
}

async fn renew_console_reachability(
    State(ctx): State<Arc<ServerContext>>,
    State(reachability): State<ConsoleReachabilityRegistry>,
    State(policy_mode): State<PolicyAuthMode>,
    headers: HeaderMap,
    Json(request): Json<ConsoleReachabilityClaimRequest>,
) -> Result<Json<ConsoleReachabilityObservationResponse>, ApiError> {
    require_console_claim_posture(&ctx, policy_mode)?;
    authorize_master(&ctx, &headers, policy_mode)?;
    let claim = ctx
        .console_claims
        .status(&request.claim_code, &ctx.console_credentials)?;
    let lease = if matches!(claim.status, "pending" | "redeemed") {
        Some(reachability.renew(&request.session_id, &request.claim_code, &claim)?)
    } else {
        reachability.drop_session(&request.session_id);
        None
    };
    Ok(Json(ConsoleReachabilityObservationResponse {
        claim,
        lease,
    }))
}

async fn drop_console_reachability(
    State(ctx): State<Arc<ServerContext>>,
    State(reachability): State<ConsoleReachabilityRegistry>,
    State(policy_mode): State<PolicyAuthMode>,
    headers: HeaderMap,
    Json(request): Json<ConsoleReachabilityDropRequest>,
) -> Result<Json<ConsoleReachabilityDropResponse>, ApiError> {
    require_console_claim_posture(&ctx, policy_mode)?;
    authorize_master(&ctx, &headers, policy_mode)?;
    Ok(Json(ConsoleReachabilityDropResponse {
        dropped: reachability.drop_session(&request.session_id),
    }))
}

async fn console_reachability_identity(
    State(reachability): State<ConsoleReachabilityRegistry>,
    headers: HeaderMap,
    Query(query): Query<ConsoleReachabilityIdentityQuery>,
) -> Response {
    let host = headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    let Some(identity) = reachability.identity_for_host(host, query.session.as_deref()) else {
        return diagnostic_response(
            StatusCode::NOT_FOUND,
            console_claim_error(
                "SNAPBACK_ADMIN_REACHABILITY_SESSION_INVALID",
                "console reachability session is unavailable",
            ),
        );
    };
    let mut response = Json(identity).into_response();
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-store, private"),
    );
    response
}

async fn request_console_approval(
    State(ctx): State<Arc<ServerContext>>,
    State(policy_mode): State<PolicyAuthMode>,
) -> Result<Json<ConsoleApprovalRequestResponse>, ApiError> {
    require_console_approval_posture(&ctx, policy_mode)?;
    let host = if ctx.host.contains(':') {
        format!("[{}]", ctx.host)
    } else {
        ctx.host.clone()
    };
    Ok(Json(ctx.console_approvals.request(format!(
        "http://{host}:{}/_snapback/admin/",
        ctx.port
    ))?))
}

async fn poll_console_approval(
    State(ctx): State<Arc<ServerContext>>,
    State(policy_mode): State<PolicyAuthMode>,
    Json(request): Json<ConsoleApprovalPollRequest>,
) -> Result<Json<ConsoleApprovalPollResponse>, ApiError> {
    require_console_approval_posture(&ctx, policy_mode)?;
    Ok(Json(ctx.console_approvals.poll(&request.device_code)?))
}

async fn approve_console_approval(
    State(ctx): State<Arc<ServerContext>>,
    State(policy_mode): State<PolicyAuthMode>,
    headers: HeaderMap,
    Json(request): Json<ConsoleApprovalApproveRequest>,
) -> Result<Json<ConsoleApprovalApproveResponse>, ApiError> {
    require_console_approval_posture(&ctx, policy_mode)?;
    authorize_master(&ctx, &headers, policy_mode)?;
    ctx.console_approvals
        .approve(&request.user_code, &ctx.console_credentials)?;
    Ok(Json(ConsoleApprovalApproveResponse { approved: true }))
}

fn require_console_mint_posture(ctx: &ServerContext) -> Result<(), ApiError> {
    #[cfg(windows)]
    return Err(console_approval_error(
        "SNAPBACK_ADMIN_CONSOLE_MINT_UNAVAILABLE",
        "console credential custody is unavailable on this host",
    )
    .into());

    #[cfg(not(windows))]
    if !ctx.loopback || ctx.auth_deployment != crate::auth::deployment::AuthDeploymentTarget::Local
    {
        return Err(console_approval_error(
            "SNAPBACK_ADMIN_CONSOLE_MINT_UNAVAILABLE",
            "console credentials can be minted only by a loopback local target",
        )
        .into());
    }
    #[cfg(not(windows))]
    Ok(())
}

fn require_console_renewal_posture(
    ctx: &ServerContext,
    policy_mode: PolicyAuthMode,
) -> Result<(), ApiError> {
    require_console_mint_posture(ctx)?;
    if ctx.profile != ServerProfile::Dev || policy_mode != PolicyAuthMode::Dev {
        return Err(console_approval_error(
            "SNAPBACK_ADMIN_CONSOLE_RENEWAL_UNAVAILABLE",
            "console credential renewal is available only in the dev profile",
        )
        .into());
    }
    Ok(())
}

fn require_console_claim_posture(
    ctx: &ServerContext,
    policy_mode: PolicyAuthMode,
) -> Result<(), ApiError> {
    #[cfg(windows)]
    return Err(console_claim_error(
        "SNAPBACK_ADMIN_CLAIM_UNAVAILABLE",
        "console claims are unavailable on this host",
    )
    .into());

    #[cfg(not(windows))]
    if !ctx.loopback
        || ctx.auth_deployment != crate::auth::deployment::AuthDeploymentTarget::Local
        || ctx.profile != ServerProfile::Dev
        || policy_mode != PolicyAuthMode::Dev
    {
        return Err(console_claim_error(
            "SNAPBACK_ADMIN_CLAIM_UNAVAILABLE",
            "console claims are available only on a loopback local dev target",
        )
        .into());
    }
    #[cfg(not(windows))]
    Ok(())
}

fn require_console_approval_posture(
    ctx: &ServerContext,
    policy_mode: PolicyAuthMode,
) -> Result<(), ApiError> {
    require_console_mint_posture(ctx)?;
    if ctx.profile != ServerProfile::Dev || policy_mode != PolicyAuthMode::Dev {
        return Err(console_approval_error(
            "SNAPBACK_ADMIN_APPROVAL_UNAVAILABLE",
            "console device approval is available only in the local dev profile",
        )
        .into());
    }
    Ok(())
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
    let mut inspect = crate::server::inspect_snapback(&snapback).await?;
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
    let body = crate::server::with_snapback_then(
        &state,
        move |snapback| {
            (
                snapback.receipts_snapshot(connection_filter.as_deref()),
                snapback.ephemeral_api(),
            )
        },
        |(mut body, ephemeral)| {
            // Delivered-rate observability (LLP 0034 §3.2 / Exact 0284 §2.5.1):
            // the coalescing diagnostics ride the receipts surface as
            // receipt-visible facts so conformance can measure delivered rate
            // against the budget.
            if let Some(object) = body.as_object_mut() {
                object.insert(
                    "ephemeralDelivery".to_owned(),
                    serde_json::to_value(ephemeral.diagnostics()).unwrap_or_default(),
                );
            }
            body
        },
    )
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

async fn admin_protected_record_erasure(
    State(state): State<AppState>,
    Extension(authority): Extension<PreparedAuthority>,
    headers: HeaderMap,
    Json(wire): Json<crate::proof_checkpoint::ProtectedRecordErasureWireRequestV1>,
) -> Result<Json<crate::proof_checkpoint::ProtectedRecordErasureReceiptV1>, ApiError> {
    let snapback = state.snapback.clone();
    let ctx = state.server.clone();
    let mode = state.active_policy_auth_mode();
    let receipt = crate::server::with_snapback(&snapback, move |snapback| {
        // Re-resolve the exact concrete credential after the await and inside
        // the synchronous database window; console expiry/revocation cannot
        // ride an earlier middleware success into this mutation.
        let credential = resolve_protected_erasure_admin_credential(&ctx, &headers, mode)?;
        let internal_authority =
            crate::proof_checkpoint::ProtectedRecordErasureAuthorityV1::from_prepared(
                &authority,
                &credential,
            )?;
        let now_ms = now_millis();
        let request = crate::proof_checkpoint::ProtectedRecordErasureRequestV1 {
            operation_id: wire.operation_id,
            authority: internal_authority,
            qualified_table: wire.qualified_table,
            row_id: wire.row_id,
            now_ms,
        };
        authority
            .try_fenced_publication(now_ms, Instant::now(), || {
                let _mode_publication =
                    authority.effect_guard("protected-record erasure canonical publication")?;
                snapback.erase_protected_record(&request)
            })?
            .ok_or_else(|| {
                ApiError::from(SnapbackError::error(
                    "SNAPBACK_PROTECTED_ERASURE_AUTHORITY_INVALID",
                    "admin",
                    "protected-record erasure authority was revoked before publication",
                ))
            })
    })
    .await?;
    Ok(Json(receipt))
}

async fn admin_operation_coverage_activate(
    State(state): State<AppState>,
    Extension(authority): Extension<PreparedAuthority>,
    headers: HeaderMap,
    Json(request): Json<crate::commit_envelope::OperationCoverageActivationRequestV1>,
) -> Result<Json<crate::commit_envelope::OperationCoverageActivationResponseV1>, ApiError> {
    if authority.source() != crate::auth::invocation::InvocationSource::OperationCoverageActivation
    {
        return Err(SnapbackError::error(
            "SNAPBACK_INVOCATION_SOURCE_INVALID",
            "auth",
            "operation coverage activation requires its registered authority source",
        )
        .into());
    }
    authorize_for_mode(
        &state.server,
        &headers,
        true,
        state.active_policy_auth_mode(),
    )?;
    if request.schema_version
        != crate::commit_envelope::operation_coverage_activation_schema_version()
    {
        return Err(SnapbackError::error(
            "SNAPBACK_OPERATION_COVERAGE_ACTIVATION_VERSION_UNSUPPORTED",
            "storage",
            "operation coverage activation request schema version is unsupported",
        )
        .into());
    }
    let target_profile_id = request.target_profile_id;
    let coverage_profile = request.coverage_profile;
    let now_ms = now_millis();
    let manifest = crate::server::with_snapback(&state.snapback, move |snapback| {
        authority
            .try_fenced_publication(now_ms, Instant::now(), || {
                let _mode_publication =
                    authority.effect_guard("operation coverage activation publication")?;
                snapback.activate_agent_safe_operation_coverage(now_ms)
            })?
            .ok_or_else(|| {
                ApiError::from(SnapbackError::error(
                    "SNAPBACK_OPERATION_COVERAGE_ACTIVATION_AUTHORITY_INVALID",
                    "storage",
                    "operation coverage activation authority was revoked before publication",
                ))
            })
    })
    .await?;
    Ok(Json(
        crate::commit_envelope::OperationCoverageActivationResponseV1 {
            schema_version: crate::commit_envelope::operation_coverage_activation_schema_version(),
            target_profile_id,
            coverage_profile,
            manifest,
        },
    ))
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

async fn admin_cron_list(
    State(snapback): State<SharedSnapback>,
    State(ctx): State<Arc<ServerContext>>,
    headers: HeaderMap,
) -> Result<Json<crate::cron::CronListState>, ApiError> {
    authorize(&ctx, &headers, false)?;
    let cron = crate::server::with_snapback(&snapback, |snapback| {
        snapback
            .inspect_core()
            .map(|state| crate::cron::CronListState::from(state.cron))
    })
    .await?;
    Ok(Json(cron))
}

#[derive(Debug, Default, serde::Deserialize)]
struct JobsDrainRequest {
    /// The injected drain clock. Absent means wall clock — the sibling of
    /// cron's forced tick; supplying it makes due-ness and retry scheduling a
    /// pure function of this value (LLP 0115 CV-9's deterministic seam).
    #[serde(rename = "nowMs")]
    now_ms: Option<u64>,
    /// Bounded cascade waves (default 1, capped at the paved maximum).
    #[serde(rename = "maxWaves")]
    max_waves: Option<usize>,
}

#[derive(Debug, Default, serde::Deserialize)]
struct PushMaintenanceRequest {
    #[serde(rename = "nowMs")]
    now_ms: Option<u64>,
}

async fn admin_push_maintenance(
    State(state): State<AppState>,
    State(ctx): State<Arc<ServerContext>>,
    headers: HeaderMap,
    body: Option<Json<PushMaintenanceRequest>>,
) -> Result<Json<serde_json::Value>, ApiError> {
    authorize(&ctx, &headers, true)?;
    let request = body.map(|Json(request)| request).unwrap_or_default();
    if request.now_ms.is_some()
        && !crate::server::expo_push_fixture_clock_allowed(state.server.profile)
    {
        return Err(SnapbackError::error(
            "SNAPBACK_PUSH_FIXTURE_CLOCK_REFUSED",
            "push",
            "an injected push-maintenance clock requires a local/test loopback Expo endpoint",
        )
        .into());
    }
    let now_ms = request.now_ms.unwrap_or_else(crate::server::now_millis);
    crate::server::drive_push_maintenance_once(&state.snapback, state.server.profile, now_ms)
        .await?;
    Ok(Json(serde_json::json!({
        "artifactKind": "snapback.push-maintenance/v1",
        "nowMs": now_ms,
    })))
}

async fn admin_jobs_drain(
    State(snapback): State<SharedSnapback>,
    State(ctx): State<Arc<ServerContext>>,
    headers: HeaderMap,
    body: Option<Json<JobsDrainRequest>>,
) -> Result<Json<serde_json::Value>, ApiError> {
    authorize(&ctx, &headers, true)?;
    let request = body.map(|Json(request)| request).unwrap_or_default();
    let now = request.now_ms.unwrap_or_else(now_millis);
    let waves = request.max_waves.unwrap_or(1);
    let drained = crate::server::jobs_drain_detached(
        &snapback,
        now,
        waves,
        crate::local::DiagnosticBoundary::Attached,
    )
    .await?;
    Ok(Json(serde_json::json!({
        "artifactKind": "snapback.jobs-drain/v0",
        "nowMs": now,
        "drained": drained,
    })))
}

async fn admin_jobs_list(
    State(snapback): State<SharedSnapback>,
    State(ctx): State<Arc<ServerContext>>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    authorize(&ctx, &headers, false)?;
    let inspect =
        crate::server::with_snapback(&snapback, |snapback| snapback.jobs_inspect(200)).await?;
    Ok(Json(inspect))
}

async fn admin_job_show(
    State(snapback): State<SharedSnapback>,
    State(ctx): State<Arc<ServerContext>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    authorize(&ctx, &headers, false)?;
    let shown = {
        let id = id.clone();
        crate::server::with_snapback(&snapback, move |snapback| snapback.job_show(&id)).await?
    };
    match shown {
        Some(value) => Ok(Json(value)),
        None => Err(ApiError::from(SnapbackError::error(
            "SNAPBACK_JOB_UNKNOWN",
            "jobs",
            format!("no job {id:?} exists"),
        ))),
    }
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
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, ApiError> {
    // @ref LLP 0184#p2-controlled-mutations — this named, receipt-bearing
    // maintenance operation retains the route's privileged AdminWrite gate.
    authorize(&state.server, &headers, true)?;
    let request: EphemeralCleanupRequest = serde_json::from_value(body).map_err(|_| {
        SnapbackError::error(
            "SNAPBACK_EPHEMERAL_CLEANUP_REQUEST_INVALID",
            "ephemeral",
            "cleanup requires startupNonce, dryRun, maxEntries, and exactly one cutoff",
        )
    })?;
    if request.startup_nonce != state.server_startup_nonce() {
        return Err(SnapbackError::error(
            "SNAPBACK_EPHEMERAL_CLEANUP_STARTUP_MISMATCH",
            "ephemeral",
            "cleanup target startup identity does not match the running server",
        )
        .into());
    }
    const MAX_EPHEMERAL_CLEANUP_ENTRIES: usize = 10_000;
    if request.max_entries == 0 || request.max_entries > MAX_EPHEMERAL_CLEANUP_ENTRIES {
        return Err(SnapbackError::error(
            "SNAPBACK_EPHEMERAL_CLEANUP_BOUND_INVALID",
            "ephemeral",
            format!("maxEntries must be between 1 and {MAX_EPHEMERAL_CLEANUP_ENTRIES}"),
        )
        .into());
    }
    let evaluated_at_ms = now_millis();
    let (cutoff_kind, requested_ms, cutoff_timestamp_ms) = match (
        request.cutoff_timestamp_ms,
        request.older_than_ms,
    ) {
        (Some(timestamp), None) if timestamp <= evaluated_at_ms => {
            ("timestamp", timestamp, timestamp)
        }
        (None, Some(age)) => (
            "expiredForAtLeast",
            age,
            evaluated_at_ms.saturating_sub(age),
        ),
        _ => {
            return Err(SnapbackError::error(
                    "SNAPBACK_EPHEMERAL_CLEANUP_CUTOFF_INVALID",
                    "ephemeral",
                    "provide exactly one of cutoffTimestampMs or olderThanMs; timestamps cannot be in the future",
                )
                .into());
        }
    };
    // Room authority is off the global mutex (LLP 0032 L9): cleanup reaches
    // the store directly and cannot queue behind a busy write.
    let report = state.ephemeral.cleanup_expired_bounded(
        cutoff_timestamp_ms,
        request.max_entries,
        request.dry_run,
    );
    Ok(Json(serde_json::json!({
        "artifactKind": "snapback.ephemeral-cleanup-receipt/v1",
        "schemaVersion": 1,
        "operation": "ephemeral.cleanup",
        "dryRun": request.dry_run,
        "startupNonce": request.startup_nonce,
        "evaluatedAtMs": evaluated_at_ms,
        "cutoff": {
            "kind": cutoff_kind,
            "requestedMs": requested_ms,
            "resolvedTimestampMs": cutoff_timestamp_ms,
        },
        "bounds": {
            "maxEntries": request.max_entries,
            "truncated": report.truncated,
        },
        "counts": report.counts,
        "collections": report.collections,
        "complete": report.complete,
        "blockedRooms": report.blocked_rooms,
        "consistency": "room-linearized",
    })))
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EphemeralCleanupRequest {
    cutoff_timestamp_ms: Option<u64>,
    older_than_ms: Option<u64>,
    dry_run: bool,
    max_entries: usize,
    startup_nonce: String,
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
    use std::collections::BTreeMap;

    #[test]
    fn dev_auth_origins_are_exact_normalized_loopback_origins() {
        assert_eq!(
            canonical_loopback_http_origin("http://LOCALHOST:8081"),
            Some("http://localhost:8081".to_owned())
        );
        assert_eq!(
            canonical_loopback_http_origin("https://[::1]:8081"),
            Some("https://[::1]:8081".to_owned())
        );
        assert!(canonical_loopback_http_origin("http://localhost").is_none());
        assert!(canonical_loopback_http_origin("http://localhost:8081/path").is_none());
        assert!(canonical_loopback_http_origin("https://192.0.2.1:8081").is_none());
    }

    #[test]
    fn fallible_app_state_construction_returns_typed_busy_and_owned_errors() {
        let snapback = LocalSnapback::memory().expect("memory app");
        let read = snapback.read_lane();
        let ephemeral = snapback.ephemeral_api();
        let shared = Arc::new(Mutex::new(snapback));

        let guard = shared.try_lock().expect("hold shared graph lock");
        let busy = match AppState::try_new(
            shared.clone(),
            read.clone(),
            ephemeral.clone(),
            ServerContext::detached(),
        ) {
            Ok(_) => panic!("a caller-held graph lock must not construct AppState"),
            Err(error) => error,
        };
        assert_eq!(busy.diagnostic.code, "SNAPBACK_EMBED_APP_STATE_BUSY");
        drop(guard);

        let _state = AppState::try_new(
            shared.clone(),
            read.clone(),
            ephemeral.clone(),
            ServerContext::detached(),
        )
        .expect("first graph owner");
        let owned = match AppState::try_new(shared, read, ephemeral, ServerContext::detached()) {
            Ok(_) => panic!("wrapping one graph twice must fail"),
            Err(error) => error,
        };
        assert_eq!(
            owned.diagnostic.code,
            "SNAPBACK_EMBED_APP_STATE_ALREADY_OWNED"
        );
    }

    #[test]
    fn fallible_app_state_entropy_failure_has_stable_diagnostic() {
        let error = telemetry_export_continuation_key_with(|_| Err(()))
            .expect_err("entropy failure must remain typed");
        assert_eq!(error.diagnostic.code, "SNAPBACK_EMBED_ENTROPY_UNAVAILABLE");
    }

    #[test]
    fn fallible_embedding_construction_core_contains_no_panic_sites() {
        let source = include_str!("admin.rs");
        let embed_source = include_str!("embed.rs");
        let public_facade = &embed_source[..embed_source
            .find("#[cfg(test)]")
            .expect("embed test-module marker")];
        let construction = &source[source
            .find("pub(crate) fn try_new_with_secret_read_operator(")
            .expect("fallible constructor marker")
            ..source
                .find("    // FALLIBLE_CONSTRUCTION_CORE_END")
                .expect("constructor end marker")];
        let provider = &source[source
            .find("    pub fn try_with_auth_provider(")
            .expect("fallible provider marker")
            ..source
                .find("    /// Infallible compatibility wrapper. Prefer [`Self::try_with_auth_provider`]")
                .expect("provider end marker")];
        for (name, body) in [
            ("constructor", construction),
            ("provider", provider),
            ("public facade", public_facade),
        ] {
            for forbidden in [
                ".expect(",
                "assert!(",
                "panic!(",
                ".unwrap(",
                "todo!(",
                "unimplemented!(",
            ] {
                assert!(
                    !body.contains(forbidden),
                    "fallible embedding {name} gained caller-triggerable panic site {forbidden}"
                );
            }
        }
    }

    #[test]
    fn protected_erasure_route_is_admin_write_and_revalidates_concrete_credential() {
        let route = crate::server::route_registry()
            .into_iter()
            .find(|route| route.path == "/_snapback/api/storage/protected-erasure")
            .expect("registered protected-erasure route");
        assert_eq!(route.path_policy, RoutePolicy::AdminWrite);
        assert_eq!(
            route.credential_resolution,
            CredentialResolution::AdminCredential
        );
        assert_eq!(route.invocation_authority, InvocationAuthority::Operator);

        let context = ServerContext::detached();
        let first = context
            .console_credentials
            .mint_at(now_millis())
            .expect("mint first console credential");
        let second = context
            .console_credentials
            .mint_at(now_millis())
            .expect("mint second console credential");
        let headers_for = |credential: &str| {
            let mut headers = HeaderMap::new();
            headers.insert(
                "x-snapback-console-credential",
                credential.parse().expect("credential header"),
            );
            headers
        };
        let first_headers = headers_for(&first.credential);
        let second_headers = headers_for(&second.credential);
        let first_binding = resolve_protected_erasure_admin_credential(
            &context,
            &first_headers,
            PolicyAuthMode::Dev,
        )
        .expect("resolve first validated credential");
        let second_binding = resolve_protected_erasure_admin_credential(
            &context,
            &second_headers,
            PolicyAuthMode::Dev,
        )
        .expect("resolve second validated credential");
        assert_eq!(first_binding.credential_class(), "console");
        assert_ne!(
            first_binding.credential_digest_sha256(),
            second_binding.credential_digest_sha256()
        );
        assert!(
            !first_binding
                .credential_digest_sha256()
                .contains(&first.credential)
        );

        assert!(
            authorize_for_mode(&context, &first_headers, true, PolicyAuthMode::Dev).is_ok(),
            "middleware-time validation initially succeeds"
        );
        context
            .console_credentials
            .state
            .lock()
            .unwrap_or_else(|lock| lock.into_inner())
            .entries
            .remove(&console_credential_digest(&first.credential));
        assert!(
            resolve_protected_erasure_admin_credential(
                &context,
                &first_headers,
                PolicyAuthMode::Dev,
            )
            .is_err(),
            "publication-boundary re-resolution refuses a revoked credential"
        );
    }

    #[tokio::test]
    async fn protected_erasure_transport_refuses_unauthorized_and_wire_authority_inputs() {
        use crate::manifest::{FieldManifest, FieldType, SchemaManifest, SeedData, TableManifest};
        use axum::http::Request;
        use tower::ServiceExt as _;

        let mut snapback = LocalSnapback::memory().expect("memory app");
        snapback
            .apply_schema(SchemaManifest {
                schema_hash: Some("sha256:protected-erasure-http-test".to_owned()),
                tables: vec![TableManifest {
                    name: "items".to_owned(),
                    fields: vec![FieldManifest {
                        name: "value".to_owned(),
                        field_type: FieldType::String,
                        optional: false,
                    }],
                    indexes: Vec::new(),
                    search_indexes: Vec::new(),
                    vector_indexes: Vec::new(),
                    search_live_limits: None,
                    syncable: true,
                    permission_backing: false,
                    permission_fields: None,
                    membership: None,
                    authority_profile: None,
                    asset_sharing: None,
                    visibility: None,
                    history: None,
                }],
                ..SchemaManifest::default()
            })
            .expect("apply protected-erasure schema");
        snapback
            .seed(SeedData {
                tables: BTreeMap::from([(
                    "items".to_owned(),
                    vec![serde_json::Map::from_iter([
                        ("_id".to_owned(), serde_json::json!("row-a")),
                        ("value".to_owned(), serde_json::json!("protected")),
                    ])],
                )]),
            })
            .expect("seed protected row");
        let mut context = ServerContext::detached();
        context.admin_token = Some("protected-erasure-admin".to_owned());
        let state =
            AppState::try_from_snapback(snapback, context).expect("protected erasure app state");
        let shared = state.snapback.clone();
        let router = crate::server::app(state);
        let body = serde_json::json!({
            "operationId": "operation-v1:protected-erasure-transport",
            "qualifiedTable": "items",
            "rowId": "row-a",
        });
        let unauthorized = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/_snapback/api/storage/protected-erasure")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(serde_json::to_vec(&body).expect("request JSON")))
                    .expect("request"),
            )
            .await
            .expect("unauthorized response");
        assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);

        let mut forged = body.clone();
        forged["authority"] = serde_json::json!({
            "principalId": "forged",
            "authorityInstanceId": "forged",
            "authorityFingerprint": "sha256:forged",
        });
        let rejected = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/_snapback/api/storage/protected-erasure")
                    .header(header::CONTENT_TYPE, "application/json")
                    .header(header::AUTHORIZATION, "Bearer protected-erasure-admin")
                    .body(Body::from(
                        serde_json::to_vec(&forged).expect("forged request JSON"),
                    ))
                    .expect("request"),
            )
            .await
            .expect("forged authority response");
        assert!(!rejected.status().is_success());

        let accepted = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/_snapback/api/storage/protected-erasure")
                    .header(header::CONTENT_TYPE, "application/json")
                    .header(header::AUTHORIZATION, "Bearer protected-erasure-admin")
                    .body(Body::from(
                        serde_json::to_vec(&body).expect("protected-erasure request JSON"),
                    ))
                    .expect("request"),
            )
            .await
            .expect("protected-erasure response");
        assert_eq!(accepted.status(), StatusCode::OK);
        let receipt =
            serde_json::from_slice::<crate::proof_checkpoint::ProtectedRecordErasureReceiptV1>(
                &axum::body::to_bytes(accepted.into_body(), 1_000_000)
                    .await
                    .expect("receipt body"),
            )
            .expect("protected-erasure receipt");
        assert_eq!(
            receipt.state,
            crate::proof_checkpoint::ProtectedRecordErasureStateV1::Complete
        );
        let remaining =
            crate::server::with_snapback(&shared, |snapback| snapback.scan_table("items", 10, 0))
                .await
                .expect("scan canonical rows after erasure");
        assert!(remaining.rows.is_empty());
    }

    #[test]
    fn operation_coverage_activation_route_is_exact_admin_write_metadata() {
        let route = crate::server::route_registry()
            .into_iter()
            .find(|route| {
                route.path == "/_snapback/api/storage/operation-coverage/activate"
                    && route.method == "POST"
            })
            .expect("registered operation-coverage activation route");
        assert_eq!(route.class, RouteClass::SystemApi);
        assert_eq!(route.path_policy, RoutePolicy::AdminWrite);
        assert_eq!(
            route.credential_resolution,
            CredentialResolution::AdminCredential
        );
        assert_eq!(route.invocation_authority, InvocationAuthority::Operator);
        assert_eq!(
            route.response_sensitivity,
            ResponseSensitivity::OperatorMetadata
        );
    }

    #[tokio::test]
    async fn operation_coverage_activation_is_authenticated_exact_and_idempotent_in_prod() {
        use crate::commit_envelope::{
            OperationCoverageActivationProfileV1, OperationCoverageActivationResponseV1,
            OperationCoverageActivationTargetV1,
        };
        use crate::manifest::{FieldManifest, FieldType, SchemaManifest, TableManifest};
        use axum::http::Request;
        use tower::ServiceExt as _;

        let mut snapback = LocalSnapback::memory().expect("memory app");
        snapback
            .apply_schema(SchemaManifest {
                schema_hash: Some("sha256:coverage-activation-http-test".to_owned()),
                tables: vec![TableManifest {
                    name: "items".to_owned(),
                    fields: vec![FieldManifest {
                        name: "value".to_owned(),
                        field_type: FieldType::String,
                        optional: false,
                    }],
                    indexes: Vec::new(),
                    search_indexes: Vec::new(),
                    vector_indexes: Vec::new(),
                    search_live_limits: None,
                    syncable: true,
                    permission_backing: false,
                    permission_fields: None,
                    membership: None,
                    authority_profile: None,
                    asset_sharing: None,
                    visibility: None,
                    history: None,
                }],
                ..SchemaManifest::default()
            })
            .expect("apply coverage activation schema");
        let mut context = ServerContext::detached();
        context.profile = ServerProfile::Prod;
        context.admin_token = Some("coverage-activation-admin".to_owned());
        let state =
            AppState::try_from_snapback(snapback, context).expect("coverage activation app state");
        let shared = state.snapback.clone();
        let router = crate::server::app(state);
        let exact_body = serde_json::json!({
            "schemaVersion": 1,
            "targetProfileId": "local-dev-sqlite-ibex",
            "coverageProfile": "local-envelope-mapped-writers.v1",
        });
        let request = |body: &serde_json::Value, authenticated: bool| {
            let mut builder = Request::builder()
                .method("POST")
                .uri("/_snapback/api/storage/operation-coverage/activate")
                .header(header::CONTENT_TYPE, "application/json");
            if authenticated {
                builder = builder.header(header::AUTHORIZATION, "Bearer coverage-activation-admin");
            }
            builder
                .body(Body::from(
                    serde_json::to_vec(body).expect("coverage activation request JSON"),
                ))
                .expect("coverage activation request")
        };

        let unauthorized = router
            .clone()
            .oneshot(request(&exact_body, false))
            .await
            .expect("unauthorized response");
        assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);

        let wrong_target = router
            .clone()
            .oneshot(request(
                &serde_json::json!({
                    "schemaVersion": 1,
                    "targetProfileId": "remote-service-sqlite-ibex",
                    "coverageProfile": "local-envelope-mapped-writers.v1",
                }),
                true,
            ))
            .await
            .expect("wrong-target response");
        assert!(!wrong_target.status().is_success());

        let wrong_version = router
            .clone()
            .oneshot(request(
                &serde_json::json!({
                    "schemaVersion": 2,
                    "targetProfileId": "local-dev-sqlite-ibex",
                    "coverageProfile": "local-envelope-mapped-writers.v1",
                }),
                true,
            ))
            .await
            .expect("wrong-version response");
        assert!(!wrong_version.status().is_success());

        let covered_before_success = crate::server::with_snapback(&shared, |snapback| {
            snapback
                .auth_database_mut()
                .operation_lane_covered(crate::operation_ledger::ORDINARY_MUTATION_LANE_V1)
        })
        .await
        .expect("read coverage after refused requests");
        assert!(!covered_before_success);

        let activate = router
            .clone()
            .oneshot(request(&exact_body, true))
            .await
            .expect("activation response");
        assert_eq!(activate.status(), StatusCode::OK);
        let first = serde_json::from_slice::<OperationCoverageActivationResponseV1>(
            &axum::body::to_bytes(activate.into_body(), 1_000_000)
                .await
                .expect("activation response body"),
        )
        .expect("activation response JSON");
        assert_eq!(first.schema_version, 1);
        assert_eq!(
            first.target_profile_id,
            OperationCoverageActivationTargetV1::LocalDevSqliteIbex
        );
        assert_eq!(
            first.coverage_profile,
            OperationCoverageActivationProfileV1::LocalEnvelopeMappedWritersV1
        );
        assert_eq!(
            first.manifest.covered_lanes,
            vec![
                crate::operation_ledger::HOST_CHILD_MUTATION_LANE_V1.to_owned(),
                crate::operation_ledger::ORDINARY_MUTATION_LANE_V1.to_owned(),
            ]
        );
        assert_eq!(
            first.manifest.writer_choke_points,
            crate::operation_ledger::ORDINARY_MUTATION_WRITERS_V1
                .into_iter()
                .chain(crate::operation_ledger::HOST_CHILD_MUTATION_WRITERS_V1)
                .map(str::to_owned)
                .collect::<std::collections::BTreeSet<_>>()
                .into_iter()
                .collect::<Vec<_>>()
        );

        let retry = router
            .oneshot(request(&exact_body, true))
            .await
            .expect("idempotent activation response");
        assert_eq!(retry.status(), StatusCode::OK);
        let second = serde_json::from_slice::<OperationCoverageActivationResponseV1>(
            &axum::body::to_bytes(retry.into_body(), 1_000_000)
                .await
                .expect("idempotent response body"),
        )
        .expect("idempotent response JSON");
        assert_eq!(second, first, "retry must return the exact active manifest");
    }

    #[test]
    fn network_profile_routes_pin_read_and_write_authority() {
        let mut routes = crate::server::route_registry()
            .into_iter()
            .filter(|route| route.path == "/_snapback/api/debug/network-profile")
            .collect::<Vec<_>>();
        routes.sort_by_key(|route| route.method);
        assert_eq!(routes.len(), 2);
        let get = routes.iter().find(|route| route.method == "GET").unwrap();
        let put = routes.iter().find(|route| route.method == "PUT").unwrap();
        assert_eq!(get.path_policy, RoutePolicy::AdminRead);
        assert_eq!(put.path_policy, RoutePolicy::AdminWrite);
        assert_eq!(
            get.credential_resolution,
            CredentialResolution::AdminCredential
        );
        assert_eq!(
            put.credential_resolution,
            CredentialResolution::AdminCredential
        );
    }

    /// @ref LLP 0184#b-forced-live-resync--add-now — v1's local-non-
    /// production-only target rule for §B (and, when it lands, §A):
    /// allowed only on a local, non-production, non-derived instance;
    /// refused on production and on a derived instance even though that
    /// same derived instance IS extended debug.networkProfileSet's
    /// separate, narrower hosted-derived exception (proving the two gates
    /// are genuinely independent, not accidentally identical).
    #[test]
    fn debug_perturbation_target_authority_is_local_non_production_only() {
        let mut local_dev_context = ServerContext::new("127.0.0.1", 0, true);
        local_dev_context.profile = ServerProfile::Dev;
        let local_dev =
            AppState::try_from_snapback(LocalSnapback::memory().unwrap(), local_dev_context)
                .expect("local dev app state");
        assert!(local_dev.debug_perturbation_target_authority().is_ok());

        let mut local_prod_context = ServerContext::new("127.0.0.1", 0, true);
        local_prod_context.profile = ServerProfile::Prod;
        let local_prod =
            AppState::try_from_snapback(LocalSnapback::memory().unwrap(), local_prod_context)
                .expect("local prod app state");
        let refusal = local_prod
            .debug_perturbation_target_authority()
            .expect_err("a production profile must refuse this perturbation");
        assert_eq!(
            refusal.diagnostic.code,
            "SNAPBACK_DEBUG_PERTURBATION_TARGET_REFUSED",
        );

        // A derived instance stays refused even though it is local and
        // even though the SAME instance already qualifies for
        // debug.networkProfileSet's distinct hosted-derived exception —
        // the two gates must not accidentally collapse into one.
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("parent.sqlite3");
        drop(crate::storage::LocalDatabase::open(&source).unwrap());
        let destination = directory.path().join("fork");
        let receipt =
            crate::instance_fork::publish(&source, &destination, "app-a", "parent-a", 42, None)
                .unwrap();
        let mut derived_context = ServerContext::new("127.0.0.1", 0, true);
        derived_context.profile = ServerProfile::Dev;
        let derived = AppState::try_from_snapback(
            LocalSnapback::open(destination.join(&receipt.database_file)).unwrap(),
            derived_context,
        )
        .expect("derived app state");
        assert!(derived.derived_instance_identity.is_some());
        // The distinct, narrower grant this gate deliberately does NOT
        // inherit: the same derived instance already passes the
        // network-profile activation gate (see
        // `network_profile_authority_captures_boot_validated_derived_identity`
        // above, which proves `derived_instance_present: Some(true)` is
        // exactly the fact that gate's `permits()` treats as eligible).
        let derived_refusal = derived.debug_perturbation_target_authority().expect_err(
            "a derived instance must refuse this perturbation until LLP 0158 grants recognition",
        );
        assert_eq!(
            derived_refusal.diagnostic.code,
            "SNAPBACK_DEBUG_PERTURBATION_TARGET_REFUSED",
        );
    }

    #[test]
    fn network_profile_authority_captures_boot_validated_derived_identity() {
        // @ref LLP 0158#design-sketch — a fork is identified by the matching
        // permanent database lineage and fork-local mint receipt/sidecars, not
        // by its path or shared appId.
        // @ref LLP 0167#authority-one-activation-chokepoint — AppState carries
        // that already-validated fact into every env/runtime activation.
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("parent.sqlite3");
        drop(crate::storage::LocalDatabase::open(&source).unwrap());
        let destination = directory.path().join("fork");
        let receipt =
            crate::instance_fork::publish(&source, &destination, "app-a", "parent-a", 42, None)
                .unwrap();
        let state = AppState::try_from_snapback(
            LocalSnapback::open(destination.join(&receipt.database_file)).unwrap(),
            ServerContext::new("127.0.0.1", 0, true),
        )
        .expect("derived profile app state");
        assert_eq!(
            state
                .derived_instance_identity
                .as_ref()
                .map(|identity| identity.fork_id.as_str()),
            Some(receipt.lineage.fork_id.as_str())
        );
        assert_eq!(
            state.network_profile_authority().derived_instance_present,
            Some(true)
        );

        let primary = AppState::try_from_snapback(
            LocalSnapback::memory().unwrap(),
            ServerContext::new("127.0.0.1", 0, true),
        )
        .expect("primary profile app state");
        assert!(primary.derived_instance_identity.is_none());
        assert_eq!(
            primary.network_profile_authority().derived_instance_present,
            Some(false)
        );
    }

    #[test]
    fn telemetry_routes_pin_authority_sensitivity_and_no_sql_carrier() {
        let routes = crate::server::route_registry()
            .into_iter()
            .filter(|route| route.path.starts_with("/_snapback/api/telemetry/"))
            .map(|route| (route.path, route))
            .collect::<BTreeMap<_, _>>();
        assert_eq!(
            routes.keys().copied().collect::<BTreeSet<_>>(),
            BTreeSet::from([
                "/_snapback/api/telemetry/events",
                "/_snapback/api/telemetry/export",
                "/_snapback/api/telemetry/stats",
            ]),
            "SQL is deliberately absent from the network route family"
        );
        let stats = routes["/_snapback/api/telemetry/stats"];
        assert_eq!(stats.path_policy, RoutePolicy::AdminRead);
        assert_eq!(
            stats.credential_resolution,
            CredentialResolution::AdminCredential
        );
        assert_eq!(
            stats.response_sensitivity,
            ResponseSensitivity::OperatorMetadata
        );
        for path in [
            "/_snapback/api/telemetry/events",
            "/_snapback/api/telemetry/export",
        ] {
            let route = routes[path];
            assert_eq!(route.path_policy, RoutePolicy::AdminSecretRead, "{path}");
            assert_eq!(
                route.credential_resolution,
                CredentialResolution::AdminSecretReadLease,
                "{path}"
            );
            assert_eq!(
                route.response_sensitivity,
                ResponseSensitivity::SensitiveApplicationData,
                "{path}"
            );
        }
    }

    #[test]
    fn errors_routes_pin_structural_raw_and_transition_authority() {
        let routes = crate::server::route_registry()
            .into_iter()
            .filter(|route| route.path.starts_with("/_snapback/api/errors/"))
            .map(|route| (route.path, route))
            .collect::<BTreeMap<_, _>>();
        assert_eq!(
            routes.keys().copied().collect::<BTreeSet<_>>(),
            BTreeSet::from([
                "/_snapback/api/errors/issue",
                "/_snapback/api/errors/issues",
                "/_snapback/api/errors/transition",
            ])
        );
        let issues = routes["/_snapback/api/errors/issues"];
        assert_eq!(issues.path_policy, RoutePolicy::AdminRead);
        assert_eq!(
            issues.response_sensitivity,
            ResponseSensitivity::OperatorMetadata
        );
        let issue = routes["/_snapback/api/errors/issue"];
        assert_eq!(issue.path_policy, RoutePolicy::AdminSecretRead);
        assert_eq!(
            issue.credential_resolution,
            CredentialResolution::AdminSecretReadLease
        );
        assert_eq!(
            issue.response_sensitivity,
            ResponseSensitivity::SensitiveApplicationData
        );
        let transition = routes["/_snapback/api/errors/transition"];
        assert_eq!(transition.method, "POST");
        assert_eq!(transition.path_policy, RoutePolicy::AdminWrite);
        assert_eq!(
            transition.response_sensitivity,
            ResponseSensitivity::OperatorMetadata
        );
    }

    #[tokio::test]
    async fn telemetry_routes_enforce_scopes_budgets_no_store_and_frozen_paged_export() {
        use crate::admin_secret_read::SecretReadLeaseRequest;
        use crate::telemetry::{Priority, TelemetryConfig, TelemetryStoreIdentity};
        use axum::body::{Body, to_bytes};
        use axum::http::Request;
        use tower::ServiceExt as _;

        let mut context = ServerContext::detached();
        context.admin_token = Some("ordinary-admin".to_owned());
        let (mut state, operator) = AppState::try_from_snapback_with_secret_read_operator(
            LocalSnapback::memory().unwrap(),
            context,
        )
        .expect("secret read app state");
        let telemetry = crate::telemetry::Telemetry::in_memory_with_identity(
            "01900000-0000-7000-8000-000000000099",
            TelemetryStoreIdentity::new("app-route-proof", "environment-route-proof").unwrap(),
            TelemetryConfig::default(),
        )
        .unwrap();
        for index in 0..1_101 {
            telemetry.point(
                "log",
                &format!("export-row-{index:04}"),
                None,
                None,
                None,
                Some(serde_json::json!({ "index": index })),
                Priority::Normal,
            );
        }
        state.telemetry = telemetry.clone();
        let router = crate::server::app(state);

        let stats = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/_snapback/api/telemetry/stats?kind=log")
                    .header(header::AUTHORIZATION, "Bearer ordinary-admin")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(stats.status(), StatusCode::OK);
        assert_eq!(stats.headers()[header::CACHE_CONTROL], "no-store, private");

        let ordinary_admin_is_not_raw_authority = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/_snapback/api/telemetry/events?kind=log&limit=5")
                    .header(header::AUTHORIZATION, "Bearer ordinary-admin")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            ordinary_admin_is_not_raw_authority.status(),
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            ordinary_admin_is_not_raw_authority.headers()[header::CACHE_CONTROL],
            "no-store, private"
        );

        let wrong_scope = operator
            .mint(SecretReadLeaseRequest {
                scopes: BTreeSet::from([SecretReadScope::TelemetryExport]),
                ttl: Duration::from_secs(60),
                row_budget: 10,
                byte_budget: 1_000_000,
            })
            .unwrap();
        let wrong_scope = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/_snapback/api/telemetry/events?kind=log&limit=5")
                    .header(SECRET_READ_LEASE_HEADER, wrong_scope.bearer())
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(wrong_scope.status(), StatusCode::FORBIDDEN);

        let events_lease = operator
            .mint(SecretReadLeaseRequest {
                scopes: BTreeSet::from([SecretReadScope::TelemetryEvents]),
                ttl: Duration::from_secs(60),
                row_budget: 5,
                byte_budget: 1_000_000,
            })
            .unwrap();
        let events = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/_snapback/api/telemetry/events?kind=log&limit=5")
                    .header(SECRET_READ_LEASE_HEADER, events_lease.bearer())
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(events.status(), StatusCode::OK);
        assert_eq!(events.headers()[header::CACHE_CONTROL], "no-store, private");
        let events_body = to_bytes(events.into_body(), 1_000_000).await.unwrap();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&events_body).unwrap()["events"]
                .as_array()
                .unwrap()
                .len(),
            5
        );

        let undersized_export = operator
            .mint(SecretReadLeaseRequest {
                scopes: BTreeSet::from([SecretReadScope::TelemetryExport]),
                ttl: Duration::from_secs(60),
                row_budget: 10,
                byte_budget: 1_000_000,
            })
            .unwrap();
        let refused = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/_snapback/api/telemetry/export?kind=log")
                    .header(SECRET_READ_LEASE_HEADER, undersized_export.bearer())
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(refused.status(), StatusCode::TOO_MANY_REQUESTS);

        let export_lease = operator
            .mint(SecretReadLeaseRequest {
                scopes: BTreeSet::from([SecretReadScope::TelemetryExport]),
                ttl: Duration::from_secs(60),
                row_budget: 2_000,
                byte_budget: 64 * 1024 * 1024,
            })
            .unwrap();
        let export = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/_snapback/api/telemetry/export?kind=log")
                    .header(SECRET_READ_LEASE_HEADER, export_lease.bearer())
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(export.status(), StatusCode::OK);
        assert_eq!(export.headers()[header::CACHE_CONTROL], "no-store, private");
        assert_eq!(
            export.headers()[header::CONTENT_TYPE],
            "application/x-ndjson"
        );

        // The response already froze its upper cursor and prefetched page 1.
        // A row admitted before later pages are polled must remain outside it.
        telemetry.point(
            "log",
            "after-export-snapshot",
            None,
            None,
            None,
            None,
            Priority::Normal,
        );
        telemetry.force_flush().unwrap();
        let export_body = to_bytes(export.into_body(), 64 * 1024 * 1024)
            .await
            .unwrap();
        let lines = export_body
            .split(|byte| *byte == b'\n')
            .filter(|line| !line.is_empty())
            .map(|line| serde_json::from_slice::<serde_json::Value>(line).unwrap())
            .collect::<Vec<_>>();
        assert_eq!(lines.len(), 1 + 1_101, "header plus every frozen event");
        assert_eq!(lines[0]["recordType"], "header");
        assert!(
            lines[1..]
                .iter()
                .all(|line| line["name"] != "after-export-snapshot")
        );

        let host_stats = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/_snapback/api/host-ops")
                    .header(header::CONTENT_TYPE, "application/json")
                    .header(header::AUTHORIZATION, "Bearer ordinary-admin")
                    .body(Body::from(
                        r#"{"operation":"telemetry.stats","input":{"kind":"log"}}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(host_stats.status(), StatusCode::OK);
        let host_stats = serde_json::from_slice::<serde_json::Value>(
            &to_bytes(host_stats.into_body(), 2_000_000).await.unwrap(),
        )
        .unwrap();
        assert_eq!(host_stats["operation"], "telemetry.stats");
        assert_eq!(host_stats["ok"], true);
        assert_eq!(
            host_stats["data"]["schemaVersion"],
            "snapback.telemetry.stats.v1"
        );

        let host_events_lease = operator
            .mint(SecretReadLeaseRequest {
                scopes: BTreeSet::from([SecretReadScope::TelemetryEvents]),
                ttl: Duration::from_secs(60),
                row_budget: 3,
                byte_budget: 1_000_000,
            })
            .unwrap();
        let host_events = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/_snapback/api/host-ops")
                    .header(header::CONTENT_TYPE, "application/json")
                    .header(SECRET_READ_LEASE_HEADER, host_events_lease.bearer())
                    .body(Body::from(
                        r#"{"operation":"telemetry.events","input":{"kind":"log","limit":3}}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(host_events.status(), StatusCode::OK);
        assert_eq!(
            host_events.headers()[header::CACHE_CONTROL],
            "no-store, private"
        );
        let host_events = serde_json::from_slice::<serde_json::Value>(
            &to_bytes(host_events.into_body(), 2_000_000).await.unwrap(),
        )
        .unwrap();
        assert_eq!(host_events["operation"], "telemetry.events");
        assert_eq!(host_events["ok"], true);
        assert_eq!(host_events["data"]["events"].as_array().unwrap().len(), 3);

        let export_page_bytes = 32 * 1024;
        let export_lease = operator
            .mint(SecretReadLeaseRequest {
                scopes: BTreeSet::from([SecretReadScope::TelemetryExport]),
                ttl: Duration::from_secs(60),
                row_budget: 2,
                byte_budget: (export_page_bytes
                    + crate::host_ops::TELEMETRY_EXPORT_HOST_ENVELOPE_ALLOWANCE)
                    as u64,
            })
            .unwrap();
        let host_export = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/_snapback/api/host-ops")
                    .header(header::CONTENT_TYPE, "application/json")
                    .header(SECRET_READ_LEASE_HEADER, export_lease.bearer())
                    .body(Body::from(
                        serde_json::to_vec(&serde_json::json!({
                            "operation": "telemetry.export",
                            "input": {
                                "kind": "log",
                                "maxRows": 2,
                                "maxBytes": export_page_bytes,
                            }
                        }))
                        .unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(host_export.status(), StatusCode::OK);
        assert_eq!(
            host_export.headers()[header::CACHE_CONTROL],
            "no-store, private"
        );
        let host_export = serde_json::from_slice::<serde_json::Value>(
            &to_bytes(host_export.into_body(), 2_000_000).await.unwrap(),
        )
        .unwrap();
        assert_eq!(host_export["operation"], "telemetry.export");
        assert_eq!(host_export["ok"], true);
        assert_eq!(host_export["authority"]["scope"], "telemetry.export");
        assert_eq!(host_export["data"]["pageRows"], 2);
        assert_eq!(host_export["data"]["truncated"], true);
        assert_eq!(
            serde_json::to_vec(&host_export["data"]).unwrap().len(),
            host_export["data"]["pageBytes"].as_u64().unwrap() as usize,
        );
        let outer_overhead = serde_json::to_vec(&host_export).unwrap().len()
            - serde_json::to_vec(&host_export["data"]).unwrap().len();
        assert!(
            outer_overhead <= crate::host_ops::TELEMETRY_EXPORT_HOST_ENVELOPE_ALLOWANCE,
            "MCP's explicit lease allowance must cover the complete host envelope"
        );
        let first_snapshot = host_export["data"]["header"]["snapshot"].clone();
        let continuation = host_export["data"]["continuationToken"]
            .as_str()
            .unwrap()
            .to_owned();

        let continuation_lease = operator
            .mint(SecretReadLeaseRequest {
                scopes: BTreeSet::from([SecretReadScope::TelemetryExport]),
                ttl: Duration::from_secs(60),
                row_budget: 2,
                byte_budget: (export_page_bytes
                    + crate::host_ops::TELEMETRY_EXPORT_HOST_ENVELOPE_ALLOWANCE)
                    as u64,
            })
            .unwrap();
        let continued_export = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/_snapback/api/host-ops")
                    .header(header::CONTENT_TYPE, "application/json")
                    .header(SECRET_READ_LEASE_HEADER, continuation_lease.bearer())
                    .body(Body::from(
                        serde_json::to_vec(&serde_json::json!({
                            "operation": "telemetry.export",
                            "input": {
                                "continuationToken": continuation,
                                "maxRows": 2,
                                "maxBytes": export_page_bytes,
                            }
                        }))
                        .unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(continued_export.status(), StatusCode::OK);
        let continued_export = serde_json::from_slice::<serde_json::Value>(
            &to_bytes(continued_export.into_body(), 2_000_000)
                .await
                .unwrap(),
        )
        .unwrap();
        assert_eq!(continued_export["ok"], true);
        assert_eq!(
            continued_export["data"]["header"]["snapshot"],
            first_snapshot
        );
    }

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
                    search_indexes: Vec::new(),
                    vector_indexes: Vec::new(),
                    search_live_limits: None,
                    membership: None,
                    authority_profile: None,
                    asset_sharing: None,
                    visibility: None,
                    history: None,
                }],
                ..SchemaManifest::default()
            })
            .unwrap();
        snapback.load_functions(FunctionManifest {
            functions: vec![FunctionDefinition::new(
                "preflightExecutionSentinel",
                FunctionKind::Query,
                FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
                    table_visibility: None,
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
            AppState::try_from_snapback_with_secret_read_operator(snapback, context)
                .expect("secret read lease app state");
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
    fn console_credentials_slide_past_base_ttl_but_stop_at_absolute_cap() {
        let registry = ConsoleCredentialRegistry::default();
        let issued_at_ms = 1_000_000;
        let minted = registry.mint_at(issued_at_ms).unwrap();
        let base_expiry = minted.expires_at_ms;
        let mut now_ms = issued_at_ms + 9 * 60_000;
        let mut expiry = base_expiry;
        while now_ms < issued_at_ms + CONSOLE_CREDENTIAL_MAX_LIFETIME.as_millis() as u64 {
            expiry = registry
                .renew_at(&minted.credential, now_ms)
                .unwrap()
                .expect("credential remains active while renewed inside the window")
                .expires_at_ms;
            now_ms = now_ms.saturating_add(9 * 60_000);
            if expiry == issued_at_ms + CONSOLE_CREDENTIAL_MAX_LIFETIME.as_millis() as u64 {
                break;
            }
        }
        assert!(
            expiry > base_expiry,
            "renewal crosses the original ten-minute TTL"
        );
        assert_eq!(
            expiry,
            issued_at_ms + CONSOLE_CREDENTIAL_MAX_LIFETIME.as_millis() as u64
        );
        assert!(!registry.allows_at(&minted.credential, expiry));
    }

    #[test]
    fn console_credential_digests_persist_without_raw_bearers() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("dev.sqlite3.console-credentials");
        let registry = ConsoleCredentialRegistry::persistent(path.clone()).unwrap();
        let minted = registry.mint().unwrap();
        let bytes = crate::secure_file::read_owner_only(&path).unwrap();
        let encoded = String::from_utf8(bytes).unwrap();
        assert!(!encoded.contains(&minted.credential));
        assert!(!encoded.contains("sbat_"));
        drop(registry);

        let reattached = ConsoleCredentialRegistry::persistent(path).unwrap();
        assert!(reattached.allows(Some(&minted.credential)));
    }

    #[cfg(unix)]
    #[test]
    fn console_credential_publication_replaces_a_raced_symlink_without_following_it() {
        use std::os::unix::fs::symlink;

        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("dev.sqlite3.console-credentials");
        let victim = directory.path().join("victim");
        std::fs::write(&victim, b"unchanged").unwrap();
        let registry = ConsoleCredentialRegistry::persistent(path.clone()).unwrap();
        registry.mint().unwrap();

        std::fs::remove_file(&path).unwrap();
        symlink(&victim, &path).unwrap();
        let minted_after_swap = registry.mint().unwrap();

        assert_eq!(std::fs::read(&victim).unwrap(), b"unchanged");
        assert!(
            std::fs::symlink_metadata(&path)
                .unwrap()
                .file_type()
                .is_file()
        );
        assert!(
            ConsoleCredentialRegistry::persistent(path)
                .unwrap()
                .allows(Some(&minted_after_swap.credential))
        );
    }

    #[test]
    fn console_approval_codes_are_short_lived_and_single_use() {
        let approvals = ConsoleApprovalRegistry::default();
        let credentials = ConsoleCredentialRegistry::default();
        let requested = approvals
            .request_at("http://127.0.0.1/admin".to_owned(), 1_000)
            .unwrap();
        assert_eq!(requested.user_code.len(), 9);
        approvals
            .approve_at(&requested.user_code, &credentials, 2_000)
            .unwrap();
        assert!(
            approvals
                .approve_at(&requested.user_code, &credentials, 2_001)
                .unwrap_err()
                .diagnostic
                .code
                .contains("APPROVAL_INVALID")
        );
        let delivered = approvals.poll_at(&requested.device_code, 3_000).unwrap();
        assert_eq!(delivered.status, "approved");
        assert!(delivered.credential.unwrap().starts_with("sbcc_"));
        assert!(approvals.poll_at(&requested.device_code, 5_001).is_err());

        let expired = approvals
            .request_at("http://127.0.0.1/admin".to_owned(), 70_000)
            .unwrap();
        assert!(
            approvals
                .poll_at(
                    &expired.device_code,
                    70_000 + CONSOLE_APPROVAL_TTL.as_millis() as u64,
                )
                .is_err()
        );
    }

    #[test]
    fn console_approval_rate_limit_counts_malformed_attempts() {
        let approvals = ConsoleApprovalRegistry::default();
        let credentials = ConsoleCredentialRegistry::default();
        for attempt in 0..CONSOLE_APPROVAL_ATTEMPTS_PER_MINUTE {
            assert_eq!(
                approvals
                    .approve_at("not-a-code", &credentials, 1_000 + u64::from(attempt))
                    .unwrap_err()
                    .diagnostic
                    .code,
                "SNAPBACK_ADMIN_APPROVAL_INVALID"
            );
        }
        assert_eq!(
            approvals
                .approve_at("not-a-code", &credentials, 2_000)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_ADMIN_APPROVAL_RATE_LIMITED"
        );
    }

    #[test]
    fn console_claim_invalid_expired_and_consumed_refuse_uniformly() {
        let credentials = ConsoleCredentialRegistry::default();

        let consumed_registry = ConsoleClaimRegistry::default();
        let consumed = consumed_registry.mint_at(1_000).unwrap();
        consumed_registry
            .exchange_at(
                &consumed.claim_code,
                "127.0.0.1:4000".to_owned(),
                &credentials,
                2_000,
            )
            .unwrap();
        let consumed_error = consumed_registry
            .exchange_at(
                &consumed.claim_code,
                "127.0.0.1:4001".to_owned(),
                &credentials,
                2_001,
            )
            .unwrap_err();

        let expired_registry = ConsoleClaimRegistry::default();
        let expired = expired_registry.mint_at(10_000).unwrap();
        let expired_error = expired_registry
            .exchange_at(
                &expired.claim_code,
                "127.0.0.1:4002".to_owned(),
                &credentials,
                expired.expires_at_ms,
            )
            .unwrap_err();

        let invalid_error = ConsoleClaimRegistry::default()
            .exchange_at(
                "sbcl_00000000000000000000000000000000",
                "127.0.0.1:4003".to_owned(),
                &credentials,
                20_000,
            )
            .unwrap_err();
        for error in [consumed_error, expired_error, invalid_error] {
            assert_eq!(error.diagnostic.code, "SNAPBACK_ADMIN_CLAIM_INVALID");
            assert_eq!(
                error.diagnostic.message,
                "console claim is invalid, expired, or already used"
            );
        }
        assert_eq!(
            consumed.expires_at_ms,
            1_000 + CONSOLE_CLAIM_TTL.as_millis() as u64
        );
    }

    #[test]
    fn console_claim_concurrent_exchange_has_exactly_one_winner() {
        let claims = ConsoleClaimRegistry::default();
        let credentials = ConsoleCredentialRegistry::default();
        let claim = claims.mint().unwrap().claim_code;
        let barrier = Arc::new(std::sync::Barrier::new(3));
        let handles = (0..2)
            .map(|index| {
                let claims = claims.clone();
                let credentials = credentials.clone();
                let claim = claim.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    claims.exchange(&claim, format!("127.0.0.1:{}", 4100 + index), &credentials)
                })
            })
            .collect::<Vec<_>>();
        barrier.wait();
        let results = handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(
            results
                .iter()
                .filter_map(|result| result.as_ref().err())
                .filter(|error| error.diagnostic.code == "SNAPBACK_ADMIN_CLAIM_INVALID")
                .count(),
            1
        );
    }

    #[test]
    fn claim_credential_renews_only_within_its_provenance_cap() {
        let claims = ConsoleClaimRegistry::default();
        let credentials = ConsoleCredentialRegistry::default();
        let issued_at_ms = 1_000_000;
        let claim = claims.mint_at(issued_at_ms - 1).unwrap();
        let credential = claims
            .exchange_at(
                &claim.claim_code,
                "127.0.0.1:4200".to_owned(),
                &credentials,
                issued_at_ms,
            )
            .unwrap();
        assert_eq!(
            credential.provenance,
            Some(ConsoleCredentialProvenance::OperatorClaim)
        );
        let absolute = issued_at_ms + CONSOLE_CLAIM_CREDENTIAL_MAX_LIFETIME.as_millis() as u64;
        let mut now_ms = issued_at_ms + 9 * 60_000;
        let mut expiry = credential.expires_at_ms;
        while now_ms < absolute {
            expiry = credentials
                .renew_at(&credential.credential, now_ms)
                .unwrap()
                .expect("active claim credential renews inside its absolute window")
                .expires_at_ms;
            if expiry == absolute {
                break;
            }
            now_ms += 9 * 60_000;
        }
        assert_eq!(expiry, absolute);
        assert!(
            absolute < issued_at_ms + CONSOLE_CREDENTIAL_MAX_LIFETIME.as_millis() as u64,
            "claim provenance never inherits the ordinary eight-hour cap"
        );
        assert!(
            credentials
                .renew_at(&credential.credential, absolute)
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn claim_redemption_binding_persists_digest_only_and_master_revoke_reattaches() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("dev.sqlite3.console-credentials");
        let credentials = ConsoleCredentialRegistry::persistent(path.clone()).unwrap();
        let claims = ConsoleClaimRegistry::default();
        let claim = claims.mint().unwrap();
        let issued = claims
            .exchange(&claim.claim_code, "127.0.0.1:4300".to_owned(), &credentials)
            .unwrap();
        let stored =
            String::from_utf8(crate::secure_file::read_owner_only(&path).unwrap()).unwrap();
        assert!(!stored.contains(&claim.claim_code));
        assert!(!stored.contains(&issued.credential));
        assert!(stored.contains("operatorClaim"));

        drop(credentials);
        let reattached = ConsoleCredentialRegistry::persistent(path).unwrap();
        let restarted_claim_registry = ConsoleClaimRegistry::default();
        let status = restarted_claim_registry
            .status(&claim.claim_code, &reattached)
            .unwrap();
        assert_eq!(status.status, "redeemed");
        assert_eq!(status.transport_peer.as_deref(), Some("127.0.0.1:4300"));
        let revoked = restarted_claim_registry
            .revoke(&claim.claim_code, &reattached)
            .unwrap();
        assert_eq!(revoked.status, "revoked");
        assert!(!reattached.allows(Some(&issued.credential)));
    }

    #[test]
    fn claim_mint_budget_is_isolated_and_unredeemed_claims_are_process_ephemeral() {
        let approvals = ConsoleApprovalRegistry::default();
        for attempt in 0..CONSOLE_APPROVAL_REQUESTS_PER_MINUTE {
            approvals
                .request_at(
                    "http://127.0.0.1/admin".to_owned(),
                    1_000 + u64::from(attempt),
                )
                .unwrap();
        }
        assert_eq!(
            approvals
                .request_at("http://127.0.0.1/admin".to_owned(), 2_000)
                .err()
                .unwrap()
                .diagnostic
                .code,
            "SNAPBACK_ADMIN_APPROVAL_RATE_LIMITED"
        );
        let claims = ConsoleClaimRegistry::default();
        let claim = claims.mint_at(2_000).unwrap();
        assert_eq!(
            ConsoleClaimRegistry::default()
                .exchange_at(
                    &claim.claim_code,
                    "127.0.0.1:4400".to_owned(),
                    &ConsoleCredentialRegistry::default(),
                    2_001,
                )
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_ADMIN_CLAIM_INVALID",
            "a fresh process cannot redeem an unredeemed predecessor claim"
        );
    }

    #[test]
    fn claim_creation_exchange_and_pending_state_are_bounded() {
        let claims = ConsoleClaimRegistry::default();
        let mut last = None;
        for batch in 0..4_u64 {
            let now_ms = 1_000 + batch * 60_000;
            for _ in 0..CONSOLE_CLAIM_MINTS_PER_MINUTE {
                match claims.mint_at(now_ms) {
                    Ok(claim) => last = Some(claim),
                    Err(error) => {
                        assert_eq!(error.diagnostic.code, "SNAPBACK_ADMIN_CLAIM_RATE_LIMITED");
                        break;
                    }
                }
            }
        }
        let state = claims.state.lock().unwrap();
        assert_eq!(
            state
                .entries
                .values()
                .filter(|entry| entry.consumed_at_ms.is_none())
                .count(),
            MAX_PENDING_CONSOLE_CLAIMS
        );
        assert!(state.entries.len() <= MAX_CONSOLE_CLAIM_RECORDS);
        drop(state);
        assert!(last.is_some());

        let exchange_limited = ConsoleClaimRegistry::default();
        let credentials = ConsoleCredentialRegistry::default();
        for attempt in 0..CONSOLE_CLAIM_EXCHANGES_PER_MINUTE {
            assert_eq!(
                exchange_limited
                    .exchange_at(
                        "not-a-claim",
                        "127.0.0.1:4500".to_owned(),
                        &credentials,
                        1_000 + u64::from(attempt),
                    )
                    .unwrap_err()
                    .diagnostic
                    .code,
                "SNAPBACK_ADMIN_CLAIM_INVALID"
            );
        }
        assert_eq!(
            exchange_limited
                .exchange_at(
                    "not-a-claim",
                    "127.0.0.1:4501".to_owned(),
                    &credentials,
                    2_000,
                )
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_ADMIN_CLAIM_RATE_LIMITED"
        );
    }

    #[test]
    fn reachability_lease_tracks_claim_then_credential_and_fails_closed() {
        let claims = ConsoleClaimRegistry::default();
        let credentials = ConsoleCredentialRegistry::default();
        let reachability = ConsoleReachabilityRegistry::default();
        let origin = "http://192.0.2.10:43123";
        let lease = reachability.register(origin, "startup-nonce-a").unwrap();
        assert_eq!(
            reachability
                .admitted_origin(Some(&HeaderValue::from_static(origin)))
                .unwrap(),
            origin
        );
        assert_eq!(
            reachability
                .identity_for_host("192.0.2.10:43123", None)
                .unwrap()
                .instance_id,
            "startup-nonce-a"
        );

        let claim = claims.mint().unwrap();
        let claim_digest = claims.pending_claim_digest(&claim.claim_code).unwrap();
        reachability
            .bind_claim(&lease.session_id, claim_digest, claim.expires_at_ms)
            .unwrap();
        let mut exchanged = claims
            .exchange(
                &claim.claim_code,
                "192.0.2.10:55000".to_owned(),
                &credentials,
            )
            .unwrap();
        exchanged.reachability = reachability
            .bind_redeemed_credential(&claim.claim_code, &exchanged.credential)
            .unwrap();
        let binding = exchanged.reachability.expect("credential is relay-bound");
        assert_eq!(binding.session_id, lease.session_id);
        assert_eq!(binding.instance_id, "startup-nonce-a");

        let status = claims.status(&claim.claim_code, &credentials).unwrap();
        assert_eq!(status.status, "redeemed");
        reachability
            .renew(&lease.session_id, &claim.claim_code, &status)
            .unwrap();
        assert!(
            reachability
                .binding_for_credential(&exchanged.credential)
                .is_some()
        );

        claims.revoke(&claim.claim_code, &credentials).unwrap();
        let revoked = claims.status(&claim.claim_code, &credentials).unwrap();
        let error = reachability
            .renew(&lease.session_id, &claim.claim_code, &revoked)
            .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_ADMIN_RELAY_LEASE_TERMINAL");
        assert!(
            reachability
                .admitted_origin(Some(&HeaderValue::from_static(origin)))
                .is_none()
        );
    }

    #[test]
    fn managed_claim_cannot_escape_without_its_live_reachability_binding() {
        let claims = ConsoleClaimRegistry::default();
        let credentials = ConsoleCredentialRegistry::default();
        let reachability = ConsoleReachabilityRegistry::default();
        let lease = reachability
            .register("http://192.0.2.10:43124", "startup-nonce-a")
            .unwrap();
        let claim = claims.mint().unwrap();
        reachability
            .bind_claim(
                &lease.session_id,
                claims.pending_claim_digest(&claim.claim_code).unwrap(),
                claim.expires_at_ms,
            )
            .unwrap();
        assert!(reachability.drop_session(&lease.session_id));
        let exchanged = claims
            .exchange(
                &claim.claim_code,
                "192.0.2.10:55001".to_owned(),
                &credentials,
            )
            .unwrap();
        assert_eq!(
            reachability
                .bind_redeemed_credential(&claim.claim_code, &exchanged.credential)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_ADMIN_RELAY_LEASE_TERMINAL"
        );
        claims.revoke(&claim.claim_code, &credentials).unwrap();
        assert!(!credentials.allows(Some(&exchanged.credential)));
    }

    #[test]
    fn reachability_origin_and_claim_bindings_are_exact() {
        let reachability = ConsoleReachabilityRegistry::default();
        for invalid in [
            "http://127.0.0.1:4000",
            "http://localhost:4000",
            "http://0.0.0.0:4000",
            "http://192.0.2.10:4000/path",
            "http://user@192.0.2.10:4000",
            "https://[::]:4000",
        ] {
            assert_eq!(
                reachability
                    .register(invalid, "startup-nonce")
                    .unwrap_err()
                    .diagnostic
                    .code,
                "SNAPBACK_ADMIN_REACHABILITY_ORIGIN_INVALID",
                "{invalid}"
            );
        }
        let first = reachability
            .register("http://192.0.2.10:4000", "startup-nonce")
            .unwrap();
        let claim_a = console_credential_digest("sbcl_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
        let claim_b = console_credential_digest("sbcl_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
        reachability
            .bind_claim(&first.session_id, claim_a, now_millis() + 60_000)
            .unwrap();
        let second = reachability
            .register("http://192.0.2.10:4001", "startup-nonce")
            .unwrap();
        assert_eq!(
            reachability
                .bind_claim(&second.session_id, claim_a, now_millis() + 60_000)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_ADMIN_RELAY_LEASE_CLAIM_MISMATCH",
            "one claim cannot extend two managed fronts"
        );
        assert_eq!(
            reachability
                .bind_claim(&first.session_id, claim_b, now_millis() + 60_000)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_ADMIN_RELAY_LEASE_CLAIM_MISMATCH"
        );
        assert!(
            reachability
                .identity_for_host("192.0.2.10:4001", Some(&first.session_id))
                .is_none(),
            "a neighboring authority cannot reuse the registered identity"
        );
    }

    #[test]
    fn master_console_exchange_attempts_are_bounded_before_auth() {
        let registry = ConsoleCredentialRegistry::default();
        for _ in 0..CONSOLE_CREDENTIAL_EXCHANGES_PER_MINUTE {
            registry.admit_master_exchange().unwrap();
        }
        assert_eq!(
            registry
                .admit_master_exchange()
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_ADMIN_CONSOLE_CREDENTIAL_RATE_LIMITED"
        );
    }

    #[test]
    fn credential_bearing_debug_surfaces_are_redacted() {
        let registry = ConsoleCredentialRegistry::default();
        let response = registry.mint().unwrap();
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
