use crate::admin::{AppState, ServerContext};
use crate::admin_secret_read::{
    SecretReadMintBridge, SecretReadMintSpec, SecretReadScope, secret_read_root_sibling,
    sign_secret_read_mint,
};
use crate::host_ops::{HOST_OPS_RESULT_KIND, HostOpsArtifacts, HostOpsResult, HostReadyDescriptor};
use crate::instance_lock::DatabaseInstanceLock;
use crate::local::LocalSnapback;
use crate::manifest::SNAPBACK_SCHEMA_VERSION;
use crate::server;
use anyhow::Context;
use clap::Parser;
use serde_json::{Value, json};
use std::ffi::OsString;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::net::TcpListener;
use tokio::sync::Mutex;
use uuid::Uuid;

const DEFAULT_PORT_RANGE_START: u16 = 4287;
const DEFAULT_PORT_RANGE_END: u16 = 4387;

#[derive(Clone, Debug, Eq, Parser, PartialEq)]
#[command(about = "Run the Snapback local development server")]
pub struct Args {
    #[arg(long, default_value = "127.0.0.1")]
    pub host: String,

    /// Pin the listener to an exact port. Without this, Snapback scans 4287-4387.
    #[arg(long)]
    pub port: Option<u16>,

    #[arg(long, default_value = ".snapback/dev.sqlite3")]
    pub db: PathBuf,

    #[arg(long)]
    pub memory: bool,

    /// Write an LLP 0030 readiness descriptor (JSON) once the listener is
    /// bound — the out-of-band handshake managed/attach launchers read.
    #[arg(long)]
    pub ready_file: Option<PathBuf>,

    /// Consume the exact declaration emitted by `snapback auth restore`.
    /// Restore effects run before the listener binds and are idempotent for
    /// one declaration id.
    #[arg(long, conflicts_with = "memory")]
    pub restored_from_backup: Option<String>,
}

impl Default for Args {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".to_owned(),
            port: None,
            db: PathBuf::from(".snapback/dev.sqlite3"),
            memory: false,
            ready_file: None,
            restored_from_backup: None,
        }
    }
}

/// The `snapback` CLI (LLP 0024 first slice, built by LLP 0032 P6): with no
/// subcommand it starts the local dev server (compatibility with the original
/// single-purpose binary); the subcommands project the host operations.
#[derive(Debug, Parser)]
#[command(
    name = "snapback",
    about = "Snapback local server + host operations (LLP 0024 first slice)"
)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Option<HostCommand>,
    #[command(flatten)]
    pub serve: Args,
}

#[derive(clap::Subcommand)]
pub enum HostCommand {
    /// host.start — run the local server in the foreground. Structured
    /// readiness is the --ready-file descriptor, not stdout.
    Start(Args),
    /// host.stop — stop the server named by a readiness descriptor.
    Stop {
        #[arg(long)]
        ready_file: PathBuf,
    },
    /// app.inspect — one hostOpsResult envelope with the runtime state.
    Inspect(TargetArgs),
    /// app.reset — deterministic reset, optionally applying a seed file.
    Reset {
        #[command(flatten)]
        target: TargetArgs,
        #[arg(long)]
        seed: Option<PathBuf>,
    },
    /// schema.load / functions.load from generated manifest files.
    Load {
        #[command(flatten)]
        target: TargetArgs,
        #[arg(long)]
        schema: Option<PathBuf>,
        #[arg(long)]
        functions: Option<PathBuf>,
    },
    /// function.run — run one generated query or mutation by name/id.
    Run {
        #[command(flatten)]
        target: TargetArgs,
        function: String,
        /// JSON object of function args.
        #[arg(long)]
        args: Option<String>,
        /// Run as this app user (devUser authority).
        #[arg(long)]
        user: Option<String>,
    },
    /// Mint one short-lived, scoped administrative data-read lease. This is a
    /// ready-file-only operation because the proof root is local operator
    /// authority and can never be discovered from a URL.
    #[command(name = "secret-read-mint")]
    SecretReadMint {
        #[arg(long)]
        ready_file: PathBuf,
        #[arg(long)]
        token: Option<String>,
        #[arg(long)]
        admin_inspect: bool,
        #[arg(long)]
        receipts: bool,
        #[arg(long)]
        table: Vec<String>,
        #[arg(long)]
        function: Vec<String>,
        #[arg(long)]
        explain_function: Vec<String>,
        #[arg(long, default_value_t = 60)]
        ttl_seconds: u64,
        #[arg(long, default_value_t = 500)]
        row_budget: u64,
        #[arg(long, default_value_t = 1_048_576)]
        byte_budget: u64,
    },
    /// Offline physical auth backup and declared restore operations.
    Auth {
        #[command(subcommand)]
        command: AuthCommand,
    },
}

#[derive(clap::Subcommand)]
pub enum AuthCommand {
    /// Create one quiesced SQLite + exact-keyring backup directory.
    Backup {
        #[arg(long)]
        db: PathBuf,
        #[arg(long)]
        output: PathBuf,
    },
    /// Restore a backup into a new instance directory and emit its declaration.
    Restore {
        #[arg(long = "from")]
        from: PathBuf,
        #[arg(long)]
        db: PathBuf,
    },
}

impl std::fmt::Debug for HostCommand {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // @ref LLP 0039#diagnostics-and-route-registry — capabilities never
        // enter logs or diagnostic/debug projections.
        // Command payloads can include administrator capabilities today and
        // provider/keyring capabilities in later auth slices. Keep this
        // implementation variant-agnostic so newly added commands cannot
        // accidentally regain derived Debug's recursive secret exposure.
        formatter.write_str("HostCommand([REDACTED])")
    }
}

#[derive(clap::Args)]
pub struct TargetArgs {
    /// Server base URL (e.g. http://127.0.0.1:4287).
    #[arg(long, conflicts_with = "ready_file")]
    pub url: Option<String>,
    /// Readiness descriptor to resolve the server from (see `start --ready-file`).
    #[arg(long)]
    pub ready_file: Option<PathBuf>,
    /// Admin token for gated writes (defaults to SNAPBACK_ADMIN_TOKEN).
    #[arg(long)]
    pub token: Option<String>,
}

impl std::fmt::Debug for TargetArgs {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("TargetArgs")
            .field("url", &self.url)
            .field("ready_file", &self.ready_file)
            .field("token", &self.token.as_ref().map(|_| "[REDACTED]"))
            .finish()
    }
}

pub async fn run_from_env() -> anyhow::Result<()> {
    let cli = Cli::parse();
    reject_misdirected_serve_flags(&cli)?;
    match cli.command {
        None => run(cli.serve).await,
        Some(HostCommand::Start(args)) => run(args).await,
        Some(HostCommand::Stop { ready_file }) => host_stop(&ready_file),
        Some(HostCommand::Inspect(target)) => {
            host_op_via_http(&target, json!({ "operation": "app.inspect" }))
        }
        Some(HostCommand::Reset { target, seed }) => {
            let mut request = json!({ "operation": "app.reset" });
            if let Some(seed) = seed {
                request["seed"] = read_json_file(&seed)?;
            }
            host_op_via_http(&target, request)
        }
        Some(HostCommand::Load {
            target,
            schema,
            functions,
        }) => {
            if schema.is_none() && functions.is_none() {
                anyhow::bail!("load requires --schema and/or --functions manifest files");
            }
            let mut failed = false;
            if let Some(schema) = schema {
                let manifest = read_json_file(&schema)?;
                failed |= !print_envelope(&post_host_op(
                    &target,
                    json!({ "operation": "schema.load", "schema": manifest }),
                )?);
            }
            if let Some(functions) = functions {
                let manifest = read_json_file(&functions)?;
                failed |= !print_envelope(&post_host_op(
                    &target,
                    json!({ "operation": "functions.load", "functions": manifest }),
                )?);
            }
            if failed {
                std::process::exit(1);
            }
            Ok(())
        }
        Some(HostCommand::Run {
            target,
            function,
            args,
            user,
        }) => {
            let parsed_args = parse_run_args(args)?;
            host_op_via_http(
                &target,
                json!({
                    "operation": "function.run",
                    "function": function,
                    "args": parsed_args,
                    "userId": user,
                }),
            )
        }
        Some(HostCommand::SecretReadMint {
            ready_file,
            token,
            admin_inspect,
            receipts,
            table,
            function,
            explain_function,
            ttl_seconds,
            row_budget,
            byte_budget,
        }) => {
            let mut scopes = std::collections::BTreeSet::new();
            if admin_inspect {
                scopes.insert(SecretReadScope::AdminInspect);
            }
            if receipts {
                scopes.insert(SecretReadScope::Receipts);
            }
            scopes.extend(table.into_iter().map(SecretReadScope::Table));
            scopes.extend(function.into_iter().map(SecretReadScope::FunctionRun));
            scopes.extend(
                explain_function
                    .into_iter()
                    .map(SecretReadScope::FunctionExplain),
            );
            let ttl_ms = ttl_seconds
                .checked_mul(1_000)
                .context("--ttl-seconds is too large")?;
            let response = mint_secret_read_via_http(
                &ready_file,
                token,
                SecretReadMintSpec {
                    scopes,
                    ttl_ms,
                    row_budget,
                    byte_budget,
                },
            )?;
            println!("{}", serde_json::to_string_pretty(&response)?);
            Ok(())
        }
        Some(HostCommand::Auth { command }) => match command {
            AuthCommand::Backup { db, output } => auth_backup(&db, &output).await,
            AuthCommand::Restore { from, db } => auth_restore(&from, &db),
        },
    }
}

/// Run physical backup only after acquiring the same instance lock a server
/// owns. The process-local maintenance gate is acquired before opening the
/// database, so keyring validation and SQLite backup share one quiesced unit.
// @ref LLP 0054#consistent-backup — the CLI refuses live ownership and publishes SQLite plus exact keyring bytes atomically.
async fn auth_backup(database_path: &Path, output_directory: &Path) -> anyhow::Result<()> {
    let database_path = resolve_database_path(database_path)?;
    anyhow::ensure!(
        database_path.is_file(),
        "SNAPBACK_AUTH_BACKUP_INVALID: source database does not exist"
    );
    let _instance_lock = DatabaseInstanceLock::acquire(&database_path)?;
    let keyring = Arc::new(crate::auth::keyring::AuthKeyringStore::file_for_database(
        &database_path,
    ));
    let provider = Arc::new(
        crate::auth::provider::AuthProvider::new(
            crate::auth::provider::AuthProviderProfile::Test,
            keyring,
        )
        .map_err(crate::auth::provider::ProviderError::into_snapback_error)?,
    );
    let maintenance = provider.exclusive_maintenance().await;
    let mut snapback = LocalSnapback::open(&database_path)?;
    let created_at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis().min(9_007_199_254_740_991) as u64)
        .unwrap_or(0);
    crate::auth::backup::create_backup(
        snapback.auth_database_mut(),
        maintenance.keyring(),
        output_directory,
        created_at_ms,
        &crate::auth::crypto::OsRandom,
    )?;
    println!(
        "{}",
        serde_json::to_string_pretty(&json!({
            "ok": true,
            "operation": "auth.backup",
            "output": output_directory,
        }))?
    );
    Ok(())
}

/// Restore always targets a database inside a wholly absent instance
/// directory. The returned UUIDv7 is deliberately non-secret and is the only
/// value the next startup may consume as destructive restore authority.
// @ref LLP 0054#restore — restore publishes one new directory and requires a matching pre-bind startup declaration.
fn auth_restore(backup_directory: &Path, target_database: &Path) -> anyhow::Result<()> {
    let backup_directory = std::fs::canonicalize(backup_directory).with_context(|| {
        format!(
            "SNAPBACK_AUTH_BACKUP_INVALID: failed to resolve backup directory {}",
            backup_directory.display()
        )
    })?;
    let target_database = resolve_restore_database_path(target_database)?;
    let declaration = crate::auth::backup::restore_backup(
        &backup_directory,
        &target_database,
        &crate::auth::crypto::OsRandom,
    )?;
    println!(
        "{}",
        serde_json::to_string_pretty(&json!({
            "ok": true,
            "operation": "auth.restore",
            "database": target_database,
            "declarationId": declaration.declaration_id(),
            "next": {
                "command": "snapback start",
                "restoredFromBackup": declaration.declaration_id(),
            },
        }))?
    );
    Ok(())
}

fn reject_misdirected_serve_flags(cli: &Cli) -> anyhow::Result<()> {
    if cli.command.is_some() && cli.serve != Args::default() {
        anyhow::bail!(
            "serve flags before a subcommand are ignored; pass them after `start` (for example: `snapback start --memory`)"
        );
    }
    Ok(())
}

fn parse_run_args(args: Option<String>) -> anyhow::Result<Value> {
    let parsed = match args {
        Some(raw) => serde_json::from_str(&raw).context("--args must be a JSON object")?,
        None => Value::Object(Default::default()),
    };
    if !parsed.is_object() {
        anyhow::bail!("--args must be a JSON object");
    }
    Ok(parsed)
}

fn read_json_file(path: &Path) -> anyhow::Result<Value> {
    let raw = std::fs::read_to_string(path)
        .with_context(|| format!("failed to read {}", path.display()))?;
    serde_json::from_str(&raw).with_context(|| format!("{} is not valid JSON", path.display()))
}

fn read_trusted_json_file(path: &Path) -> anyhow::Result<Value> {
    let raw = crate::secure_file::read_owner_only(path)
        .with_context(|| format!("failed to read trusted local file {}", path.display()))?;
    let raw =
        String::from_utf8(raw).with_context(|| format!("{} is not valid UTF-8", path.display()))?;
    serde_json::from_str(&raw).with_context(|| format!("{} is not valid JSON", path.display()))
}

fn emit_impersonation_capability_to_writer(
    operator: crate::admin_impersonation::ImpersonationOperator,
    writer: &mut impl std::io::Write,
) -> std::io::Result<()> {
    operator.emit_once_to_terminal(|bearer| {
        writer.write_all(b"impersonation capability: ")?;
        writer.write_all(bearer.as_bytes())?;
        writer.write_all(b"\n")?;
        writer.flush()
    })
}

/// No-ready-file fallback. Write the process bearer directly to the
/// controlling terminal: never stdout/stderr, tracing, or a generic inherited
/// file descriptor that a launcher may capture into logs.
#[cfg(unix)]
fn emit_impersonation_capability_to_controlling_terminal(
    operator: crate::admin_impersonation::ImpersonationOperator,
) -> std::io::Result<()> {
    use std::os::unix::fs::{FileTypeExt as _, OpenOptionsExt as _};

    let mut terminal = std::fs::OpenOptions::new()
        .write(true)
        .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW)
        .open("/dev/tty")?;
    if !terminal.metadata()?.file_type().is_char_device() {
        return Err(std::io::Error::new(
            ErrorKind::PermissionDenied,
            "controlling-terminal capability is not a character device",
        ));
    }
    emit_impersonation_capability_to_writer(operator, &mut terminal)
}

#[cfg(not(unix))]
fn emit_impersonation_capability_to_controlling_terminal(
    _operator: crate::admin_impersonation::ImpersonationOperator,
) -> std::io::Result<()> {
    Err(std::io::Error::new(
        ErrorKind::Unsupported,
        "direct controlling-terminal capability emission is unavailable on this host",
    ))
}

struct ResolvedHttpTarget {
    server_url: String,
    minted_token: Option<String>,
    impersonation_capability: Option<crate::auth::crypto::ImpersonationBearer>,
}

impl std::fmt::Debug for ResolvedHttpTarget {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ResolvedHttpTarget")
            .field("server_url", &self.server_url)
            .field(
                "minted_token",
                &self.minted_token.as_ref().map(|_| "[REDACTED]"),
            )
            .field(
                "impersonation_capability",
                &self.impersonation_capability.as_ref().map(|_| "[REDACTED]"),
            )
            .finish()
    }
}

#[cfg(test)]
fn resolve_http_target(target: &TargetArgs) -> anyhow::Result<ResolvedHttpTarget> {
    resolve_http_target_for_operation(target, false)
}

fn resolve_http_target_for_operation(
    target: &TargetArgs,
    requires_impersonation: bool,
) -> anyhow::Result<ResolvedHttpTarget> {
    if let Some(url) = &target.url {
        return Ok(ResolvedHttpTarget {
            server_url: url.trim_end_matches('/').to_owned(),
            minted_token: None,
            // A network-supplied URL never selects a local capability file.
            // Impersonation attach authority exists only through a trusted
            // ready-file descriptor naming its mechanical sibling.
            impersonation_capability: None,
        });
    }
    if let Some(path) = &target.ready_file {
        // Pin the existing parent before reading any bytes. The descriptor,
        // token, and impersonation sibling below are all opened relative to
        // this one directory capability, so swapping a symlinked parent after
        // the health check cannot splice a different local secret into the
        // already-validated descriptor snapshot.
        let ready_target = ReadyFileTarget::open_existing(path)?;
        let canonical_ready = ready_target.pinned_path().to_path_buf();
        let descriptor_bytes = ready_target
            .read_owner_only_sibling(&canonical_ready)
            .with_context(|| format!("failed to read trusted ready file {}", path.display()))?;
        let value: Value = serde_json::from_slice(&descriptor_bytes)
            .with_context(|| format!("{} is not valid JSON", path.display()))?;
        let descriptor = HostReadyDescriptor::validate(&value).map_err(|problems| {
            anyhow::anyhow!(
                "{} is not a valid readiness descriptor: {}",
                path.display(),
                problems.join("; ")
            )
        })?;
        let impersonation_capability = if requires_impersonation {
            let health = fetch_health(&descriptor.server_url);
            verify_live_descriptor_identity(&descriptor, &health, "auth impersonation").map_err(
                |diagnostic| anyhow::anyhow!("{}: {}", diagnostic.code, diagnostic.message),
            )?;
            let advertised = descriptor
                .impersonation_capability_file
                .as_deref()
                .map(Path::new)
                .context("readiness descriptor has no impersonationCapabilityFile")?;
            let sidecar = crate::admin_impersonation::validate_impersonation_capability_path(
                &canonical_ready,
                advertised,
            )?;
            let bytes = ready_target
                .read_strict_owner_only_sibling(
                    &sidecar,
                    crate::admin_impersonation::MAX_IMPERSONATION_CAPABILITY_FILE_BYTES,
                )
                .with_context(|| {
                    format!(
                        "failed to read owner-only impersonation capability {}",
                        sidecar.display()
                    )
                })?;
            Some(
                crate::admin_impersonation::parse_impersonation_capability_file(
                    zeroize::Zeroizing::new(bytes),
                )
                .map_err(anyhow::Error::new)?,
            )
        } else {
            None
        };
        // For capability-bearing operations the branch above has verified the
        // live startup nonce before either local sibling is read. Ordinary
        // host operations retain the established ready-file admin-token flow.
        let minted_token =
            discover_minted_token_pinned(&ready_target, &canonical_ready, &descriptor);
        return Ok(ResolvedHttpTarget {
            server_url: descriptor.server_url.trim_end_matches('/').to_owned(),
            minted_token,
            impersonation_capability,
        });
    }
    anyhow::bail!("no target: pass --url or --ready-file")
}

/// Derive capability attachment from the same registered operation metadata
/// the server gate consumes. Merely possessing or advertising the sidecar can
/// never add the header to an ordinary/browser-compatible request.
fn request_requires_impersonation(request: &Value) -> bool {
    let Some(operation) = request.get("operation").and_then(Value::as_str) else {
        return false;
    };
    let impersonated = request
        .get("userId")
        .and_then(Value::as_str)
        .is_some_and(|user_id| !user_id.is_empty());
    crate::server::host_ops_operation_spec(operation, None, impersonated).is_some_and(|spec| {
        spec.effective_for(crate::server::PolicyAuthMode::Dev)
            .effect_policy
            == crate::server::EffectPolicy::ImpersonationCapability
    })
}

/// POST one host operation and project the envelope to stdout + exit code
/// (`ok: false` → exit 1) per LLP 0024's transport-projection rule.
fn host_op_via_http(target: &TargetArgs, request: Value) -> anyhow::Result<()> {
    let envelope = post_host_op(target, request)?;
    if !print_envelope(&envelope) {
        std::process::exit(1);
    }
    Ok(())
}

fn post_host_op(target: &TargetArgs, request: Value) -> anyhow::Result<Value> {
    // Resolve the URL and optional local capability from one validated
    // descriptor snapshot. Reading the path once for the URL and again for the
    // token would let a rename between reads combine an attacker's URL with a
    // trusted descriptor's token handoff (ENG-24338).
    let requires_impersonation = request_requires_impersonation(&request);
    let resolved = resolve_http_target_for_operation(target, requires_impersonation)?;
    let token = target
        .token
        .clone()
        .or_else(|| std::env::var("SNAPBACK_ADMIN_TOKEN").ok())
        .filter(|token| !token.is_empty())
        .or(resolved.minted_token);
    let mut http = ureq::post(&format!("{}/_snapback/api/host-ops", resolved.server_url));
    if let Some(token) = token.filter(|token| !token.is_empty()) {
        http = http.set("x-snapback-admin-token", &token);
    }
    if requires_impersonation && let Some(capability) = resolved.impersonation_capability.as_ref() {
        http = http.set(
            crate::admin_impersonation::IMPERSONATION_CAPABILITY_HEADER,
            capability.expose_secret(),
        );
    }
    match http.send_json(request) {
        Ok(response) => Ok(response
            .into_json()
            .context("host-ops response was not JSON")?),
        // A gated/refused call returns the structured ApiError body — surface
        // it verbatim rather than as a transport error.
        Err(ureq::Error::Status(_status, response)) => Ok(response
            .into_json()
            .context("host-ops error response was not JSON")?),
        Err(error) => Err(error).context("host-ops request failed"),
    }
}

/// Minted-token discovery (ENG-23443): when the caller passed no explicit
/// token, read the auto-minted token file the server points at — via the
/// readiness descriptor's `adminTokenFile`. The path must be the mechanical
/// sibling of the trusted descriptor itself; a remote `--url` target can never
/// name a local path for the CLI to read. Being able to read both owner-only
/// files as this user is what makes the CLI local admin (LLP 0036 D3).
/// Discovery failing just means the request goes out tokenless and surfaces
/// the server's structured refusal.
fn discover_minted_token(ready_file: &Path, descriptor: &HostReadyDescriptor) -> Option<String> {
    let declared = PathBuf::from(descriptor.admin_token_file.as_deref()?);
    let expected = crate::admin::admin_token_sibling(ready_file);
    if declared != expected {
        return None;
    }
    let token = String::from_utf8(crate::secure_file::read_owner_only(&declared).ok()?).ok()?;
    let token = token.trim();
    (!token.is_empty()).then(|| token.to_owned())
}

fn discover_minted_token_pinned(
    target: &ReadyFileTarget,
    ready_file: &Path,
    descriptor: &HostReadyDescriptor,
) -> Option<String> {
    let declared = PathBuf::from(descriptor.admin_token_file.as_deref()?);
    let expected = crate::admin::admin_token_sibling(ready_file);
    if declared != expected {
        return None;
    }
    let token = String::from_utf8(target.read_owner_only_sibling(&declared).ok()?).ok()?;
    let token = token.trim();
    (!token.is_empty()).then(|| token.to_owned())
}

fn mint_secret_read_via_http(
    ready_file: &Path,
    explicit_token: Option<String>,
    lease: SecretReadMintSpec,
) -> anyhow::Result<Value> {
    // Resolve and validate one owner-only descriptor snapshot before reading
    // either sibling capability. URL-only targeting has no code path here.
    let value = read_trusted_json_file(ready_file)?;
    let descriptor = HostReadyDescriptor::validate(&value).map_err(|problems| {
        anyhow::anyhow!(
            "{} is not a valid readiness descriptor: {}",
            ready_file.display(),
            problems.join("; ")
        )
    })?;
    let health = fetch_health(&descriptor.server_url);
    verify_live_descriptor_identity(&descriptor, &health, "admin-secret-read.mint")
        .map_err(|diagnostic| anyhow::anyhow!("{}: {}", diagnostic.code, diagnostic.message))?;
    let canonical_ready = std::fs::canonicalize(ready_file)
        .with_context(|| format!("failed to resolve ready file {}", ready_file.display()))?;
    let declared_root = validated_secret_read_root_path(&canonical_ready, &descriptor)?;
    let root = crate::admin_secret_read::read_secret_read_proof_root(&declared_root)?;

    let startup_nonce = descriptor
        .startup_nonce
        .clone()
        .context("readiness descriptor has no startupNonce")?;
    let issued_at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| u64::try_from(duration.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0);
    let proof = sign_secret_read_mint(
        &root,
        lease,
        startup_nonce,
        issued_at_ms,
        format!("sbrp_{}", Uuid::new_v4().simple()),
    )?;
    let token = explicit_token
        .or_else(|| std::env::var("SNAPBACK_ADMIN_TOKEN").ok())
        .filter(|token| !token.is_empty())
        .or_else(|| discover_minted_token(&canonical_ready, &descriptor));
    let mut request = ureq::post(&format!(
        "{}/_snapback/api/admin-secret-read/mint",
        descriptor.server_url.trim_end_matches('/')
    ));
    if let Some(token) = token {
        request = request.set("x-snapback-admin-token", &token);
    }
    match request.send_json(serde_json::to_value(proof)?) {
        Ok(response) => response
            .into_json()
            .context("secret-read mint response was not JSON"),
        Err(ureq::Error::Status(status, response)) => {
            let body: Value = response
                .into_json()
                .context("secret-read mint error response was not JSON")?;
            anyhow::bail!("secret-read mint failed with HTTP {status}: {body}")
        }
        Err(error) => Err(error).context("secret-read mint request failed"),
    }
}

fn validated_secret_read_root_path(
    canonical_ready: &Path,
    descriptor: &HostReadyDescriptor,
) -> anyhow::Result<PathBuf> {
    let expected_root = secret_read_root_sibling(canonical_ready);
    let declared_root = descriptor
        .secret_read_root_file
        .as_deref()
        .map(PathBuf::from)
        .context("readiness descriptor has no secretReadRootFile")?;
    anyhow::ensure!(
        declared_root == expected_root,
        "SNAPBACK_ADMIN_SECRET_READ_ROOT_PATH_INVALID: secretReadRootFile is not the mechanical ready-file sibling"
    );
    Ok(declared_root)
}

/// Print the envelope; returns envelope `ok` (missing/false → false).
fn print_envelope(envelope: &Value) -> bool {
    println!(
        "{}",
        serde_json::to_string_pretty(envelope).unwrap_or_else(|_| envelope.to_string())
    );
    envelope.get("ok").and_then(Value::as_bool).unwrap_or(false)
}

/// host.stop: validate the readiness descriptor, verify the descriptor still
/// names the live server, signal the process, remove the file, and print a
/// synthesized host.stop envelope (the CLI owns this operation — a server
/// cannot stop itself over its own HTTP surface).
fn host_stop(ready_file: &Path) -> anyhow::Result<()> {
    let value = read_trusted_json_file(ready_file)?;
    let descriptor = HostReadyDescriptor::validate(&value).map_err(|problems| {
        anyhow::anyhow!(
            "{} is not a valid readiness descriptor: {}",
            ready_file.display(),
            problems.join("; ")
        )
    })?;
    // @ref LLP 0030#readiness-and-port-discovery — "a stale ready file must
    // never be accepted as current readiness": confirm the descriptor's server
    // still answers /health as the same process (startupNonce match) before
    // signaling, so a reused PID never receives the signal (ENG-23366).
    let health = fetch_health(&descriptor.server_url);
    let envelope =
        |ok: bool, data: Value, diagnostics: Vec<crate::diagnostic::Diagnostic>| HostOpsResult {
            schema_version: SNAPBACK_SCHEMA_VERSION.to_owned(),
            result_kind: HOST_OPS_RESULT_KIND.to_owned(),
            request_id: format!("hop_{}", Uuid::now_v7().simple()),
            operation: "host.stop".to_owned(),
            ok,
            target: descriptor.target.clone(),
            authority: None,
            artifacts: HostOpsArtifacts::default(),
            data,
            diagnostics,
            next: Vec::new(),
            secret_read_tables: Vec::new(),
            secret_read_rows: 0,
            secret_read_query: false,
            secret_read_provenance_complete: true,
        };
    if let Err(diagnostic) = verify_stop_target(&descriptor, &health) {
        let refused = envelope(
            false,
            json!({
                "pid": descriptor.pid,
                "serverUrl": descriptor.server_url,
                "readyFile": ready_file.display().to_string(),
            }),
            vec![diagnostic],
        );
        print_envelope(&serde_json::to_value(&refused)?);
        std::process::exit(1);
    }
    let stopped = std::process::Command::new("kill")
        .arg(descriptor.pid.to_string())
        .status()
        .context("failed to signal the server process")?
        .success();
    if stopped {
        let _ = std::fs::remove_file(ready_file);
    }
    let envelope = envelope(
        stopped,
        json!({
            "stoppedPid": descriptor.pid,
            "serverUrl": descriptor.server_url,
            "verifiedBy": "startupNonce",
        }),
        Vec::new(),
    );
    let ok = print_envelope(&serde_json::to_value(&envelope)?);
    if !ok {
        std::process::exit(1);
    }
    Ok(())
}

/// GET the descriptor's `/health` and return its JSON payload, or a
/// human-readable reason it could not be fetched.
fn fetch_health(server_url: &str) -> Result<Value, String> {
    let url = format!("{}/health", server_url.trim_end_matches('/'));
    let agent = ureq::AgentBuilder::new()
        .timeout(std::time::Duration::from_secs(2))
        .build();
    match agent.get(&url).call() {
        Ok(response) => response
            .into_json()
            .map_err(|error| format!("{url} did not return JSON: {error}")),
        Err(ureq::Error::Status(status, _)) => Err(format!("{url} answered HTTP {status}")),
        Err(error) => Err(format!("{url} is unreachable: {error}")),
    }
}

/// Decide whether the descriptor's pid may be signaled: only when the live
/// server at `serverUrl` reports the same per-process `startupNonce` the
/// descriptor was written with. Anything else — dead server, different
/// process on the port, a descriptor without a nonce — refuses with a
/// structured diagnostic instead of signaling a possibly reused PID.
fn verify_stop_target(
    descriptor: &HostReadyDescriptor,
    health: &Result<Value, String>,
) -> Result<(), crate::diagnostic::Diagnostic> {
    verify_live_descriptor_identity(descriptor, health, "host.stop")
}

/// Verify that a trusted descriptor still names the process answering its
/// URL. Capability-bearing ready-file operations call this before reading any
/// sibling secret or attaching any administrator credential to a request.
fn verify_live_descriptor_identity(
    descriptor: &HostReadyDescriptor,
    health: &Result<Value, String>,
    operation: &str,
) -> Result<(), crate::diagnostic::Diagnostic> {
    let details = |reason: &str| {
        json!({
            "operation": operation,
            "pid": descriptor.pid,
            "serverUrl": descriptor.server_url,
            "reason": reason,
        })
    };
    let Some(expected_nonce) = descriptor.startup_nonce.as_deref() else {
        return Err(crate::diagnostic::Diagnostic::error(
            "SNAPBACK_HOST_STOP_UNVERIFIABLE",
            "host-ops",
            "the readiness descriptor has no startupNonce, so the target process cannot be verified; the capability-bearing operation was refused",
        )
        .with_details(details("descriptor predates startupNonce identity")));
    };
    let payload = match health {
        Ok(payload) => payload,
        Err(reason) => {
            return Err(crate::diagnostic::Diagnostic::error(
                "SNAPBACK_HOST_STOP_STALE_DESCRIPTOR",
                "host-ops",
                format!(
                    "the descriptor's server no longer answers ({reason}); the ready file is \
                     stale and pid {} may belong to an unrelated process — the operation was refused",
                    descriptor.pid
                ),
            )
            .with_details(details(reason)));
        }
    };
    let live_nonce = payload
        .get("binary")
        .and_then(|binary| binary.get("startupNonce"))
        .and_then(Value::as_str);
    match live_nonce {
        Some(live) if live == expected_nonce => Ok(()),
        Some(_) => Err(crate::diagnostic::Diagnostic::error(
            "SNAPBACK_HOST_STOP_STALE_DESCRIPTOR",
            "host-ops",
            "the server answering the descriptor's URL is a different process than the one that \
             wrote the descriptor (startupNonce mismatch); the operation was refused — remove \
             the stale ready file and target the live server's own ready file",
        )
        .with_details(details("startupNonce mismatch"))),
        None => Err(crate::diagnostic::Diagnostic::error(
            "SNAPBACK_HOST_STOP_UNVERIFIABLE",
            "host-ops",
            "the process answering the descriptor's URL does not report a Snapback identity \
             (/health has no binary.startupNonce); the operation was refused",
        )
        .with_details(details("no binary.startupNonce on /health"))),
    }
}

pub async fn run(args: Args) -> anyhow::Result<()> {
    anyhow::ensure!(
        !(args.memory && args.restored_from_backup.is_some()),
        "SNAPBACK_AUTH_BACKUP_INVALID: in-memory startup cannot consume a restore declaration"
    );
    let prepared_database_path = if args.memory {
        None
    } else {
        Some(prepare_database_path(&args.db)?)
    };
    // Reject lexical/canonical nesting before ReadyFileTarget creates a
    // missing parent. Otherwise a ready path beneath `app.sqlite3-wal/` (or a
    // lock/config/token sibling) could first occupy a managed file path with a
    // directory and fail later with an unrelated SQLite/lock error.
    let provisional_ready_temp = args
        .ready_file
        .as_deref()
        .map(ready_file_temp_path)
        .transpose()?;
    let provisional_impersonation_temp = args
        .ready_file
        .as_deref()
        .map(crate::admin_impersonation::impersonation_capability_sibling)
        .transpose()?
        .as_deref()
        .map(ready_file_temp_path)
        .transpose()?;
    let mut provisional_paths = managed_startup_paths(
        prepared_database_path.as_deref(),
        args.ready_file.as_deref(),
    )?;
    if let Some(path) = provisional_ready_temp {
        provisional_paths.push(ManagedPath {
            label: "ready-file temporary artifact",
            path,
        });
    }
    if let Some(path) = provisional_impersonation_temp {
        provisional_paths.push(ManagedPath {
            label: "impersonation capability temporary artifact",
            path,
        });
    }
    validate_path_disjointness(&provisional_paths)?;
    // Pin the resolved ready-file parent before validating it against any
    // managed database artifact. Publication and cleanup remain relative to
    // this directory capability even if a symlink in the caller's pathname is
    // swapped while the server is running.
    let mut ready_target = args
        .ready_file
        .as_deref()
        .map(ReadyFileTarget::open)
        .transpose()?;
    let ready_path = ready_target.as_ref().map(ReadyFileTarget::pinned_path);
    let ready_temp_path = ready_path.map(ready_file_temp_path).transpose()?;
    let impersonation_capability_file = ready_path
        .map(crate::admin_impersonation::impersonation_capability_sibling)
        .transpose()?;
    let impersonation_temp_path = impersonation_capability_file
        .as_deref()
        .map(ready_file_temp_path)
        .transpose()?;
    let mut managed_paths = managed_startup_paths(prepared_database_path.as_deref(), ready_path)?;
    if let Some(path) = &ready_temp_path {
        managed_paths.push(ManagedPath {
            label: "ready-file temporary artifact",
            path: path.clone(),
        });
    }
    if let Some(path) = &impersonation_temp_path {
        managed_paths.push(ManagedPath {
            label: "impersonation capability temporary artifact",
            path: path.clone(),
        });
    }
    validate_path_disjointness(&managed_paths)?;

    let mut database_lock = None;
    let database_path = prepared_database_path;
    let mut snapback = match database_path.as_ref() {
        None => LocalSnapback::memory()?,
        Some(db_path) => {
            // @ref LLP 0003#decision — one local server process owns the SQLite
            // database and process-local runtime state for this app instance.
            let lock = DatabaseInstanceLock::acquire(db_path)?;
            let snapback = LocalSnapback::open(db_path)?;
            database_lock = Some(lock);
            snapback
        }
    };

    // A restored directory is quarantined until the exact declaration emitted
    // by `auth restore` is consumed. This runs under the instance lock and
    // before listener bind, so no request can observe backed-up sessions.
    // @ref LLP 0054#restore — declared restore is an idempotent pre-bind revocation/purge transaction; omission never silently serves the backup.
    if let Some(db_path) = database_path.as_deref() {
        let declaration_path = crate::auth::lifecycle::restore_declaration_path(db_path)?;
        let declaration_present = match std::fs::symlink_metadata(&declaration_path) {
            Ok(_) => true,
            Err(error) if error.kind() == ErrorKind::NotFound => false,
            Err(_) => {
                return Err(anyhow::Error::new(crate::diagnostic::SnapbackError::error(
                    "SNAPBACK_AUTH_BACKUP_INVALID",
                    "auth-restore",
                    "restore declaration could not be inspected",
                )));
            }
        };
        match args.restored_from_backup.as_deref() {
            Some(declaration_id) => {
                crate::auth::lifecycle::apply_declared_restore(
                    snapback.auth_database_mut(),
                    &crate::auth::mailbox::CaptureMailbox::new(),
                    &declaration_path,
                    declaration_id,
                    SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .map(|elapsed| elapsed.as_millis().min(9_007_199_254_740_991) as u64)
                        .unwrap_or(0),
                )?;
            }
            None if declaration_present => {
                return Err(anyhow::Error::new(crate::diagnostic::SnapbackError::error(
                    "SNAPBACK_AUTH_BACKUP_INVALID",
                    "auth-restore",
                    "a restored instance requires --restored-from-backup before it can bind",
                )));
            }
            None => {}
        }
    }

    let read_lane = snapback.read_lane();
    let ephemeral = snapback.ephemeral_api();
    let missing_config = snapback.required_missing_config();
    let loaded_app_id = snapback.loaded_app_id();
    let state = Arc::new(Mutex::new(snapback));
    let listener = bind_listener(&args.host, args.port).await?;
    let local_addr = listener.local_addr()?;

    // @ref LLP 0017#serving-model — capture the bound address so the admin API
    // reports host/port/uptime and gates by loopback vs non-loopback.
    let loopback = local_addr.ip().is_loopback();
    let mut server_context =
        ServerContext::new(local_addr.ip().to_string(), local_addr.port(), loopback);
    // @ref LLP 0017#security-defaults — a served loopback instance is never
    // tokenless (ENG-23443): with the reflected localhost CORS, tokenless
    // writes would be drivable by any local web page. Without
    // SNAPBACK_ADMIN_TOKEN we mint a local token, persisted 0600 next to the
    // database (or the ready file for in-memory instances). Non-loopback
    // binds keep admin disabled until an explicit token is set.
    let mut minted_token = None;
    if loopback && server_context.admin_token.is_none() {
        let token_file = database_path
            .as_deref()
            .or(ready_path)
            .map(crate::admin::admin_token_sibling);
        let resolved = if database_path.is_none() {
            if let (Some(target), Some(token_file)) = (ready_target.as_ref(), token_file.as_ref()) {
                crate::admin::resolve_serve_admin_token_with_io(
                    None,
                    Some(token_file.clone()),
                    |path| target.read_owner_only_sibling(path),
                    |path, bytes| target.write_owner_only_sibling(path, bytes),
                )?
            } else {
                crate::admin::resolve_serve_admin_token(None, token_file)?
            }
        } else {
            crate::admin::resolve_serve_admin_token(None, token_file)?
        };
        server_context.install_minted_token(&resolved);
        minted_token = Some(resolved);
    }
    let token_configured = server_context.admin_token.is_some();
    let ready_sibling_token_file = if database_path.is_none() {
        server_context.admin_token_file.clone()
    } else {
        None
    };
    let ready_sibling_token_identity = ready_sibling_token_file
        .as_deref()
        .and_then(existing_file_identity);
    let admin_token_file_display = server_context
        .admin_token_file
        .as_ref()
        .map(|path| path.display().to_string());
    let startup_nonce = crate::identity::binary_identity().startup_nonce;
    let (impersonation_capabilities, impersonation_operator) =
        if server_context.profile.allows_provisioning()
            && server::impersonation_registry_enabled(crate::server::PolicyAuthMode::Dev)
        {
            let (registry, operator) =
                crate::admin_impersonation::ImpersonationCapabilityRegistry::generate(
                    startup_nonce.clone(),
                    &crate::auth::crypto::OsRandom,
                )
                .context("failed to generate the process-bound impersonation capability")?;
            (Some(registry), Some(operator))
        } else {
            (None, None)
        };
    let secret_read_root_file = ready_path.map(secret_read_root_sibling);
    let secret_read_proof_root = match (ready_target.as_ref(), secret_read_root_file.as_ref()) {
        (Some(target), Some(path)) => Some(
            crate::admin_secret_read::resolve_secret_read_proof_root_with_io(
                path,
                |path| target.read_owner_only_sibling(path),
                |path, bytes| target.write_owner_only_sibling(path, bytes),
            )?,
        ),
        _ => None,
    };
    let cron_scheduler = server::spawn_cron_scheduler(state.clone());
    let maintenance_worker = server::spawn_maintenance_worker(state.clone(), ephemeral.clone());
    let (app_state, secret_read_operator) =
        AppState::new_with_secret_read_operator(state, read_lane, ephemeral, server_context);
    let app_state = match secret_read_proof_root {
        Some(root) => app_state.with_secret_read_mint_bridge(SecretReadMintBridge::new(
            secret_read_operator,
            root,
            startup_nonce.clone(),
        )),
        None => app_state,
    };
    let app_state = match impersonation_capabilities {
        Some(registry) => app_state.with_impersonation_capabilities(registry),
        None => app_state,
    };
    let app = server::app(app_state);
    if let Some(lock) = database_lock.as_mut() {
        lock.record_server(&local_addr.ip().to_string(), local_addr.port())?;
    }

    let mut impersonation_capability_file_display = None;
    if let Some(operator) = impersonation_operator {
        if let Some(target) = ready_target.as_mut() {
            let ready_file = target.pinned_path().to_path_buf();
            let temporary = impersonation_temp_path
                .as_deref()
                .context("impersonation sidecar temporary path was not allocated")?;
            let path = operator
                .publish_with(&ready_file, |path, bytes| {
                    target.publish_owner_only_sibling_atomic(path, temporary, bytes)
                })
                .with_context(|| {
                    format!(
                        "failed to publish owner-only impersonation capability for {}",
                        ready_file.display()
                    )
                })?;
            anyhow::ensure!(
                impersonation_capability_file.as_deref() == Some(path.as_path()),
                "impersonation publisher returned a non-mechanical sidecar path"
            );
            impersonation_capability_file_display = Some(path.display().to_string());
        } else {
            emit_impersonation_capability_to_controlling_terminal(operator)
                .context("failed to emit impersonation capability to the controlling terminal")?;
        }
    }

    // @ref LLP 0030#readiness-and-port-discovery — the readiness file is
    // the structured handshake: out-of-band so launcher stdout (cargo build
    // noise) cannot corrupt it; aligned with the LLP 0024 target shape.
    if let Some(target) = ready_target.as_mut() {
        let path = target.pinned_path().to_path_buf();
        let descriptor = crate::host_ops::HostReadyDescriptor {
            schema_version: SNAPBACK_SCHEMA_VERSION.to_owned(),
            descriptor_kind: crate::host_ops::HOST_READY_DESCRIPTOR_KIND.to_owned(),
            startup_id: format!("srt_{}", Uuid::now_v7().simple()),
            ready: true,
            server_url: format!("http://{local_addr}"),
            host: local_addr.ip().to_string(),
            port: local_addr.port(),
            pid: std::process::id(),
            // The identity handshake `snapback stop` verifies before it
            // signals this pid: the same per-process nonce /health reports.
            startup_nonce: Some(startup_nonce.clone()),
            target: crate::host_ops::HostOpsTarget {
                app_id: loaded_app_id.clone(),
                app_root: None,
                target_profile: crate::manifest::TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX.to_owned(),
                server_url: Some(format!("http://{local_addr}")),
            },
            database: crate::host_ops::HostReadyDatabase {
                mode: if args.memory { "memory" } else { "file" }.to_owned(),
                path: database_path
                    .as_ref()
                    .map(|path| path.display().to_string()),
            },
            started_at_ms: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|elapsed| elapsed.as_millis() as u64)
                .unwrap_or(0),
            admin_gated: token_configured || !loopback,
            admin_token_file: admin_token_file_display.clone(),
            secret_read_root_file: secret_read_root_file
                .as_ref()
                .map(|path| path.display().to_string()),
            impersonation_capability_file: impersonation_capability_file_display.clone(),
            diagnostics: Vec::new(),
        };
        target
            .write_atomic_protected(
                &format!("{}\n", serde_json::to_string_pretty(&descriptor)?),
                &managed_paths,
                ready_temp_path
                    .as_deref()
                    .context("ready-file temporary path was not allocated")?,
            )
            .with_context(|| format!("failed to write ready file {}", path.display()))?;
        println!(
            "ready file: {}",
            args.ready_file.as_deref().unwrap_or(&path).display()
        );
    }

    println!("snapback listening on http://{local_addr}");
    println!("admin console: http://{local_addr}/_snapback/admin");
    if let Some(db_path) = database_path {
        println!("sqlite database: {}", db_path.display());
    }
    // @ref LLP 0017#security-defaults — be explicit about how admin is gated.
    if !loopback && !token_configured {
        println!(
            "admin: DISABLED on this non-loopback bind — set SNAPBACK_ADMIN_TOKEN to enable it"
        );
    } else if let Some(minted) = &minted_token {
        // The minted-token surfacing (ENG-23443): the value is printed on the
        // start that minted it; afterwards the 0600 file is the capability
        // hand-off — reading it as this user is what local admin means.
        println!("admin: writes require the minted local admin token (SNAPBACK_ADMIN_TOKEN unset)");
        if minted.fresh {
            println!("admin token: {}", minted.token);
        }
        if let Some(file) = &minted.file {
            println!("admin token file: {}", file.display());
        }
    } else {
        println!("admin: writes require SNAPBACK_ADMIN_TOKEN");
    }
    // @ref LLP 0036#the-setup-wizard-d3 — the printed setup line is the
    // install instruction. Artifacts usually load after boot (the same line
    // then prints from the functions/load handler); this covers a boot that
    // already has declarations in hand.
    if !missing_config.is_empty() {
        println!(
            "config: {} required entr{} missing ({}) → http://{local_addr}/_snapback/admin/setup",
            missing_config.len(),
            if missing_config.len() == 1 {
                "y"
            } else {
                "ies"
            },
            missing_config.join(", "),
        );
    }

    let server_result = axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await;
    cron_scheduler.abort();
    maintenance_worker.abort();
    drop(database_lock);
    if let Some(target) = ready_target.as_ref() {
        let _ = target.remove_impersonation_capability();
        let _ = target.remove_published();
    }
    // An in-memory instance's minted token dies with the process; remove the
    // ready-file-sibling token file it was handed off through (ENG-23443).
    // File-backed instances keep their token file across restarts.
    if let (Some(target), Some(path), Some(identity)) = (
        ready_target.as_ref(),
        ready_sibling_token_file.as_deref(),
        ready_sibling_token_identity,
    ) {
        let _ = target.remove_sibling_if_identity(path, identity);
    }
    server_result?;
    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };

    #[cfg(unix)]
    {
        let terminate = async {
            if let Ok(mut signal) =
                tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            {
                signal.recv().await;
            } else {
                std::future::pending::<()>().await;
            }
        };
        tokio::select! {
            _ = ctrl_c => {}
            _ = terminate => {}
        }
    }

    #[cfg(not(unix))]
    ctrl_c.await;
}

#[derive(Clone, Debug)]
struct ManagedPath {
    label: &'static str,
    path: PathBuf,
}

fn managed_startup_paths(
    database: Option<&Path>,
    ready_file: Option<&Path>,
) -> anyhow::Result<Vec<ManagedPath>> {
    let mut paths = Vec::new();
    if let Some(database) = database {
        paths.push(ManagedPath {
            label: "database",
            path: database.to_path_buf(),
        });
        paths.push(ManagedPath {
            label: "database lock",
            path: crate::instance_lock::lock_path_for_database(database)?,
        });
        paths.push(ManagedPath {
            label: "config store",
            path: crate::config::ConfigStore::path_for_database(database),
        });
        paths.push(ManagedPath {
            label: "admin token",
            path: crate::admin::admin_token_sibling(database),
        });
        for (label, suffix) in [
            ("SQLite WAL", "-wal"),
            ("SQLite shared memory", "-shm"),
            ("SQLite journal", "-journal"),
        ] {
            paths.push(ManagedPath {
                label,
                path: path_with_filename_suffix(database, suffix)?,
            });
        }
    }
    if let Some(ready_file) = ready_file {
        paths.push(ManagedPath {
            label: "ready file",
            path: ready_file.to_path_buf(),
        });
        if database.is_none() {
            paths.push(ManagedPath {
                label: "admin token",
                path: crate::admin::admin_token_sibling(ready_file),
            });
        }
        paths.push(ManagedPath {
            label: "secret-read root",
            path: secret_read_root_sibling(ready_file),
        });
        paths.push(ManagedPath {
            label: "impersonation capability",
            path: crate::admin_impersonation::impersonation_capability_sibling(ready_file)?,
        });
    }
    Ok(paths)
}

fn path_with_filename_suffix(path: &Path, suffix: &str) -> anyhow::Result<PathBuf> {
    let mut name = path
        .file_name()
        .context("managed path must include a file name")?
        .to_os_string();
    name.push(suffix);
    Ok(path.with_file_name(name))
}

fn resolve_candidate_path(path: &Path) -> anyhow::Result<PathBuf> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()?.join(path)
    };
    if let Ok(canonical) = std::fs::canonicalize(&absolute) {
        return Ok(canonical);
    }

    // Resolve the deepest existing ancestor, then append the missing suffix.
    // This normalizes `..` and catches a symlinked parent even before the final
    // artifact exists.
    let mut ancestor = absolute.as_path();
    let mut suffix: Vec<OsString> = Vec::new();
    loop {
        if let Ok(canonical) = std::fs::canonicalize(ancestor) {
            let mut resolved = canonical;
            for component in suffix.iter().rev() {
                resolved.push(component);
            }
            return Ok(normalize_lexically(&resolved));
        }
        let Some(name) = ancestor.file_name() else {
            // `Path::file_name` is intentionally empty for a trailing `..`.
            // Normalize that lexical spelling and restart the existing-prefix
            // walk; a root path itself would already have canonicalized.
            let normalized = normalize_lexically(&absolute);
            if normalized != absolute {
                return resolve_candidate_path(&normalized);
            }
            anyhow::bail!(
                "managed path has no resolvable ancestor: {}",
                path.display()
            );
        };
        suffix.push(name.to_os_string());
        ancestor = ancestor.parent().with_context(|| {
            format!("managed path has no resolvable parent: {}", path.display())
        })?;
    }
}

fn normalize_lexically(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                normalized.pop();
            }
            component => normalized.push(component.as_os_str()),
        }
    }
    normalized
}

#[cfg(unix)]
fn existing_file_identity(path: &Path) -> Option<(u64, u64)> {
    use std::os::unix::fs::MetadataExt as _;
    std::fs::metadata(path)
        .ok()
        .map(|metadata| (metadata.dev(), metadata.ino()))
}

#[cfg(not(unix))]
fn existing_file_identity(_path: &Path) -> Option<(u64, u64)> {
    None
}

fn validate_path_disjointness(paths: &[ManagedPath]) -> anyhow::Result<()> {
    // @ref LLP 0030#readiness-and-port-discovery — readiness publication is
    // atomic and must not alias another managed startup capability/artifact.
    let resolved = paths
        .iter()
        .map(|path| {
            Ok((
                path,
                resolve_candidate_path(&path.path)?,
                existing_file_identity(&path.path),
            ))
        })
        .collect::<anyhow::Result<Vec<_>>>()?;
    for left in 0..resolved.len() {
        for right in (left + 1)..resolved.len() {
            let (left_path, left_resolved, left_id) = &resolved[left];
            let (right_path, right_resolved, right_id) = &resolved[right];
            let same_inode = left_id.is_some() && left_id == right_id;
            let nested = left_resolved.starts_with(right_resolved)
                || right_resolved.starts_with(left_resolved);
            if nested || same_inode {
                anyhow::bail!(
                    "SNAPBACK_READY_FILE_PATH_COLLISION: {} ({}) aliases or nests beneath {} ({}); every managed startup artifact must have a distinct, non-nested path and file identity",
                    left_path.label,
                    left_path.path.display(),
                    right_path.label,
                    right_path.path.display(),
                );
            }
        }
    }
    Ok(())
}

/// A ready-file pathname resolved once into a stable parent-directory
/// capability. The original pathname is deliberately not reused for writes or
/// removal: an attacker (or launcher cleanup) may replace one of its symlinked
/// parents after startup validation.
struct ReadyFileTarget {
    pinned_path: PathBuf,
    file_name: OsString,
    published_identity: Option<(u64, u64)>,
    parent_identity: Option<(u64, u64)>,
    impersonation_identity: Option<(PathBuf, (u64, u64))>,
    #[cfg(unix)]
    parent: std::fs::File,
}

impl ReadyFileTarget {
    fn open(path: &Path) -> anyhow::Result<Self> {
        Self::open_with_parent_policy(path, true)
    }

    /// Attach-side variant: resolving an existing trusted descriptor must
    /// never create a caller-controlled parent as a side effect.
    fn open_existing(path: &Path) -> anyhow::Result<Self> {
        Self::open_with_parent_policy(path, false)
    }

    fn open_with_parent_policy(path: &Path, create_parent: bool) -> anyhow::Result<Self> {
        let file_name = path
            .file_name()
            .context("ready file path must include a file name")?
            .to_os_string();
        let parent = path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty());
        let parent = match parent {
            Some(parent) if parent.is_absolute() => parent.to_path_buf(),
            Some(parent) => std::env::current_dir()?.join(parent),
            None => std::env::current_dir()?,
        };
        if create_parent {
            std::fs::create_dir_all(&parent).with_context(|| {
                format!("failed to create ready-file directory {}", parent.display())
            })?;
        }
        let canonical_parent = std::fs::canonicalize(&parent).with_context(|| {
            format!(
                "failed to resolve ready-file directory {}",
                parent.display()
            )
        })?;

        #[cfg(unix)]
        let (parent, parent_identity) = {
            use std::os::unix::fs::{MetadataExt as _, OpenOptionsExt as _};
            let parent = std::fs::OpenOptions::new()
                .read(true)
                .custom_flags(libc::O_DIRECTORY | libc::O_CLOEXEC | libc::O_NOFOLLOW)
                .open(&canonical_parent)
                .with_context(|| {
                    format!(
                        "failed to pin ready-file directory {}",
                        canonical_parent.display()
                    )
                })?;
            let metadata = parent.metadata()?;
            let identity = (metadata.dev(), metadata.ino());
            (parent, Some(identity))
        };
        #[cfg(not(unix))]
        let parent_identity = existing_file_identity(&canonical_parent);

        Ok(Self {
            pinned_path: canonical_parent.join(&file_name),
            file_name,
            published_identity: None,
            parent_identity,
            impersonation_identity: None,
            #[cfg(unix)]
            parent,
        })
    }

    fn pinned_path(&self) -> &Path {
        &self.pinned_path
    }

    fn ensure_parent_path_identity(&self) -> std::io::Result<()> {
        let parent = self.pinned_path.parent().ok_or_else(|| {
            std::io::Error::new(ErrorKind::InvalidInput, "ready file has no parent")
        })?;
        if self.parent_identity.is_some() && existing_file_identity(parent) != self.parent_identity
        {
            return Err(std::io::Error::new(
                ErrorKind::PermissionDenied,
                "ready-file parent identity changed after startup validation",
            ));
        }
        Ok(())
    }

    fn sibling_name<'a>(&self, path: &'a Path) -> std::io::Result<&'a std::ffi::OsStr> {
        if path.parent() != self.pinned_path.parent() {
            return Err(std::io::Error::new(
                ErrorKind::InvalidInput,
                "managed ready-file sibling is outside the pinned parent",
            ));
        }
        path.file_name().ok_or_else(|| {
            std::io::Error::new(ErrorKind::InvalidInput, "managed sibling has no file name")
        })
    }

    #[cfg(unix)]
    fn read_owner_only_sibling(&self, path: &Path) -> std::io::Result<Vec<u8>> {
        use std::ffi::CString;
        use std::io::Read as _;
        use std::os::fd::{AsRawFd as _, FromRawFd as _};
        use std::os::unix::ffi::OsStrExt as _;

        const MAX_TOKEN_FILE_BYTES: u64 = 4 * 1024;
        self.ensure_parent_path_identity()?;
        let name = CString::new(self.sibling_name(path)?.as_bytes())
            .map_err(|_| std::io::Error::new(ErrorKind::InvalidInput, "sibling contains NUL"))?;
        // SAFETY: name is one NUL-terminated component and parent is the live
        // directory capability pinned at startup.
        let fd = unsafe {
            libc::openat(
                self.parent.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if fd < 0 {
            return Err(std::io::Error::last_os_error());
        }
        // SAFETY: openat returned this owned descriptor exactly once.
        let file = unsafe { std::fs::File::from_raw_fd(fd) };
        crate::secure_file::validate_and_repair_owner_only(&file)?;
        let mut bytes = Vec::new();
        (&file)
            .take(MAX_TOKEN_FILE_BYTES + 1)
            .read_to_end(&mut bytes)?;
        if bytes.len() as u64 > MAX_TOKEN_FILE_BYTES {
            return Err(std::io::Error::new(
                ErrorKind::InvalidData,
                "admin token file exceeds the bounded capability-file limit",
            ));
        }
        Ok(bytes)
    }

    #[cfg(unix)]
    fn write_owner_only_sibling(&self, path: &Path, bytes: &[u8]) -> std::io::Result<()> {
        use std::ffi::CString;
        use std::io::{Seek as _, Write as _};
        use std::os::fd::{AsRawFd as _, FromRawFd as _};
        use std::os::unix::ffi::OsStrExt as _;

        self.ensure_parent_path_identity()?;
        let name = CString::new(self.sibling_name(path)?.as_bytes())
            .map_err(|_| std::io::Error::new(ErrorKind::InvalidInput, "sibling contains NUL"))?;
        let parent_fd = self.parent.as_raw_fd();
        let open_existing = || {
            // SAFETY: name is one component relative to the pinned parent.
            unsafe {
                libc::openat(
                    parent_fd,
                    name.as_ptr(),
                    libc::O_RDWR | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                )
            }
        };
        let mut fd = open_existing();
        if fd < 0 && std::io::Error::last_os_error().kind() == ErrorKind::NotFound {
            // SAFETY: as above; O_EXCL refuses a racing/pre-created inode.
            fd = unsafe {
                libc::openat(
                    parent_fd,
                    name.as_ptr(),
                    libc::O_RDWR
                        | libc::O_CREAT
                        | libc::O_EXCL
                        | libc::O_NOFOLLOW
                        | libc::O_CLOEXEC,
                    0o600,
                )
            };
            if fd < 0 && std::io::Error::last_os_error().kind() == ErrorKind::AlreadyExists {
                fd = open_existing();
            }
        }
        if fd < 0 {
            return Err(std::io::Error::last_os_error());
        }
        // SAFETY: openat returned this owned descriptor exactly once.
        let mut file = unsafe { std::fs::File::from_raw_fd(fd) };
        crate::secure_file::validate_and_repair_owner_only(&file)?;
        file.set_len(0)?;
        file.seek(std::io::SeekFrom::Start(0))?;
        file.write_all(bytes)?;
        file.sync_all()
    }

    /// Strict attach-side read through the already-pinned ready-file parent.
    /// Unlike the legacy admin-token helper this never repairs permissions and
    /// refuses hard links, replacement during the read, and oversized data.
    #[cfg(unix)]
    fn read_strict_owner_only_sibling(
        &self,
        path: &Path,
        maximum_bytes: usize,
    ) -> std::io::Result<Vec<u8>> {
        use std::ffi::CString;
        use std::io::Read as _;
        use std::os::fd::{AsRawFd as _, FromRawFd as _};
        use std::os::unix::ffi::OsStrExt as _;
        use std::os::unix::fs::{MetadataExt as _, PermissionsExt as _};
        use zeroize::{Zeroize as _, Zeroizing};

        self.ensure_parent_path_identity()?;
        let sibling = self.sibling_name(path)?;
        let name = CString::new(sibling.as_bytes())
            .map_err(|_| std::io::Error::new(ErrorKind::InvalidInput, "sibling contains NUL"))?;
        // SAFETY: the single-component name is resolved beneath the live
        // directory capability and O_NOFOLLOW refuses a symlink entry.
        let fd = unsafe {
            libc::openat(
                self.parent.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if fd < 0 {
            return Err(std::io::Error::last_os_error());
        }
        // SAFETY: openat returned this owned descriptor exactly once.
        let file = unsafe { std::fs::File::from_raw_fd(fd) };
        let before = file.metadata()?;
        // SAFETY: geteuid has no preconditions and reads process identity.
        let effective_uid = unsafe { libc::geteuid() };
        if !before.file_type().is_file()
            || before.uid() != effective_uid
            || before.permissions().mode() & 0o777 != 0o600
            || before.nlink() != 1
            || before.len() > maximum_bytes as u64
        {
            return Err(std::io::Error::new(
                ErrorKind::PermissionDenied,
                "strict ready-file sibling invariants are not satisfied",
            ));
        }
        let identity = (before.dev(), before.ino());
        let mut bytes = Zeroizing::new(Vec::with_capacity(before.len() as usize));
        if let Err(error) = (&file)
            .take(maximum_bytes as u64 + 1)
            .read_to_end(&mut bytes)
        {
            bytes.zeroize();
            return Err(error);
        }
        let after = file.metadata()?;
        if bytes.len() > maximum_bytes
            || after.len() != bytes.len() as u64
            || after.uid() != effective_uid
            || after.permissions().mode() & 0o777 != 0o600
            || after.nlink() != 1
            || (after.dev(), after.ino()) != identity
            || self.identity_at(sibling)? != Some(identity)
        {
            bytes.zeroize();
            return Err(std::io::Error::new(
                ErrorKind::PermissionDenied,
                "strict ready-file sibling changed while it was read",
            ));
        }
        Ok(std::mem::take(&mut *bytes))
    }

    #[cfg(not(unix))]
    fn read_owner_only_sibling(&self, path: &Path) -> std::io::Result<Vec<u8>> {
        self.ensure_parent_path_identity()?;
        crate::secure_file::read_owner_only(path)
    }

    #[cfg(not(unix))]
    fn write_owner_only_sibling(&self, path: &Path, bytes: &[u8]) -> std::io::Result<()> {
        self.ensure_parent_path_identity()?;
        crate::secure_file::write_owner_only(path, bytes)
    }

    #[cfg(not(unix))]
    fn read_strict_owner_only_sibling(
        &self,
        _path: &Path,
        _maximum_bytes: usize,
    ) -> std::io::Result<Vec<u8>> {
        Err(std::io::Error::new(
            ErrorKind::Unsupported,
            "strict descriptor-relative capability reads are unavailable on this host",
        ))
    }

    #[cfg(unix)]
    fn publish_owner_only_sibling_atomic(
        &mut self,
        path: &Path,
        temporary_path: &Path,
        bytes: &[u8],
    ) -> std::io::Result<()> {
        use std::ffi::CString;
        use std::io::Write as _;
        use std::os::fd::{AsRawFd as _, FromRawFd as _};
        use std::os::unix::ffi::OsStrExt as _;
        use std::os::unix::fs::{MetadataExt as _, PermissionsExt as _};

        self.ensure_parent_path_identity()?;
        let final_name = CString::new(self.sibling_name(path)?.as_bytes()).map_err(|_| {
            std::io::Error::new(ErrorKind::InvalidInput, "managed sibling contains NUL")
        })?;
        let temporary_name =
            CString::new(self.sibling_name(temporary_path)?.as_bytes()).map_err(|_| {
                std::io::Error::new(ErrorKind::InvalidInput, "temporary sibling contains NUL")
            })?;
        let parent_fd = self.parent.as_raw_fd();
        let prior_identity = self.validated_impersonation_destination(path)?;
        // SAFETY: the temporary name is one component relative to the pinned
        // directory. O_EXCL and O_NOFOLLOW refuse every pre-created/racing
        // inode instead of truncating it.
        let fd = unsafe {
            libc::openat(
                parent_fd,
                temporary_name.as_ptr(),
                libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                0o600,
            )
        };
        if fd < 0 {
            return Err(std::io::Error::last_os_error());
        }
        // SAFETY: openat returned this owned descriptor exactly once.
        let mut temporary = unsafe { std::fs::File::from_raw_fd(fd) };
        let created_metadata = temporary.metadata()?;
        let created_identity = (created_metadata.dev(), created_metadata.ino());
        let mut published_identity = None;
        let result = (|| -> std::io::Result<(u64, u64)> {
            temporary.set_permissions(std::fs::Permissions::from_mode(0o600))?;
            temporary.write_all(bytes)?;
            temporary.sync_all()?;
            let metadata = temporary.metadata()?;
            let identity = (metadata.dev(), metadata.ino());
            if identity != created_identity {
                return Err(std::io::Error::new(
                    ErrorKind::PermissionDenied,
                    "impersonation sidecar temporary inode changed during publication",
                ));
            }
            if let Some(prior_identity) = prior_identity {
                // Exchange is one atomic directory operation: if the final
                // entry changed after validation, the displaced entry's inode
                // exposes that race and we swap back instead of accepting it.
                renameat_exchange(parent_fd, &temporary_name, &final_name)?;
                // From this point the canonical path may contain the new
                // process bearer. Track it before every fallible verification
                // or rollback step so outer failure cleanup can remove it by
                // inode even if an attempted exchange-back also fails.
                published_identity = Some(identity);
                let final_after = self.identity_at(self.sibling_name(path)?)?;
                let displaced = self.identity_at(self.sibling_name(temporary_path)?)?;
                if final_after != Some(identity) || displaced != Some(prior_identity) {
                    let _ = renameat_exchange(parent_fd, &temporary_name, &final_name);
                    return Err(std::io::Error::new(
                        ErrorKind::PermissionDenied,
                        "impersonation sidecar destination changed during atomic replacement",
                    ));
                }
                if let Err(error) = self.remove_sibling_if_identity(temporary_path, prior_identity)
                {
                    let _ = renameat_exchange(parent_fd, &temporary_name, &final_name);
                    return Err(error);
                }
                if self
                    .identity_at(self.sibling_name(temporary_path)?)?
                    .is_some()
                {
                    return Err(std::io::Error::new(
                        ErrorKind::PermissionDenied,
                        "displaced impersonation sidecar could not be removed safely",
                    ));
                }
            } else {
                renameat_no_replace(parent_fd, &temporary_name, &final_name)?;
                published_identity = Some(identity);
            }
            if self.identity_at(self.sibling_name(path)?)? != Some(identity) {
                return Err(std::io::Error::new(
                    ErrorKind::PermissionDenied,
                    "published owner-only sibling identity changed during publication",
                ));
            }
            self.parent.sync_all()?;
            Ok(identity)
        })();
        if result.is_err() {
            let _ = self.remove_sibling_if_identity(temporary_path, created_identity);
            if let Some(identity) = published_identity {
                let _ = self.remove_sibling_if_identity(path, identity);
            }
            let _ = self.parent.sync_all();
        }
        let identity = result?;
        self.impersonation_identity = Some((path.to_path_buf(), identity));
        Ok(())
    }

    #[cfg(unix)]
    fn validated_impersonation_destination(
        &self,
        path: &Path,
    ) -> std::io::Result<Option<(u64, u64)>> {
        use std::ffi::CString;
        use std::io::Read as _;
        use std::os::fd::{AsRawFd as _, FromRawFd as _};
        use std::os::unix::ffi::OsStrExt as _;
        use std::os::unix::fs::{MetadataExt as _, PermissionsExt as _};

        let name = CString::new(self.sibling_name(path)?.as_bytes()).map_err(|_| {
            std::io::Error::new(ErrorKind::InvalidInput, "managed sibling contains NUL")
        })?;
        // SAFETY: one component relative to the pinned directory; O_NOFOLLOW
        // refuses a stale or attacker-installed symlink.
        let fd = unsafe {
            libc::openat(
                self.parent.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if fd < 0 {
            let error = std::io::Error::last_os_error();
            return if error.kind() == ErrorKind::NotFound {
                Ok(None)
            } else {
                Err(error)
            };
        }
        // SAFETY: openat returned this owned descriptor exactly once.
        let mut file = unsafe { std::fs::File::from_raw_fd(fd) };
        let metadata = file.metadata()?;
        if !metadata.file_type().is_file()
            || metadata.file_type().is_symlink()
            || metadata.permissions().mode() & 0o777 != 0o600
            || metadata.uid() != unsafe { libc::geteuid() }
            || metadata.nlink() != 1
            || metadata.len()
                > crate::admin_impersonation::MAX_IMPERSONATION_CAPABILITY_FILE_BYTES as u64
        {
            return Err(std::io::Error::new(
                ErrorKind::PermissionDenied,
                "existing impersonation sidecar is not a strict owner-only regular file",
            ));
        }
        let mut bytes = zeroize::Zeroizing::new(Vec::new());
        file.by_ref()
            .take(crate::admin_impersonation::MAX_IMPERSONATION_CAPABILITY_FILE_BYTES as u64 + 1)
            .read_to_end(&mut bytes)?;
        crate::admin_impersonation::parse_impersonation_capability_file(bytes).map_err(|_| {
            std::io::Error::new(
                ErrorKind::InvalidData,
                "existing impersonation sidecar is not a canonical process bearer",
            )
        })?;
        Ok(Some((metadata.dev(), metadata.ino())))
    }

    #[cfg(not(unix))]
    fn publish_owner_only_sibling_atomic(
        &mut self,
        _path: &Path,
        _temporary_path: &Path,
        _bytes: &[u8],
    ) -> std::io::Result<()> {
        Err(std::io::Error::new(
            ErrorKind::Unsupported,
            "atomic owner-only sibling publication is unavailable on this host",
        ))
    }

    fn remove_impersonation_capability(&self) -> std::io::Result<()> {
        let Some((path, identity)) = self.impersonation_identity.as_ref() else {
            return Ok(());
        };
        self.remove_sibling_if_identity(path, *identity)
    }

    fn write_atomic_protected(
        &mut self,
        content: &str,
        protected_paths: &[ManagedPath],
        tmp_path: &Path,
    ) -> anyhow::Result<()> {
        // Re-check after the parent capability is pinned. This is the path
        // identity that publication will actually use, not a mutable symlink
        // spelling supplied by the caller.
        self.ensure_parent_path_identity()?;
        validate_path_disjointness(protected_paths)?;

        #[cfg(unix)]
        {
            self.write_atomic_unix(content, tmp_path)
        }
        #[cfg(not(unix))]
        {
            let write_result = (|| -> anyhow::Result<()> {
                crate::secure_file::write_new_owner_only(tmp_path, content.as_bytes())?;
                std::fs::rename(tmp_path, &self.pinned_path)?;
                self.published_identity = existing_file_identity(&self.pinned_path);
                Ok(())
            })();
            if write_result.is_err() {
                let _ = std::fs::remove_file(tmp_path);
            }
            write_result
        }
    }

    #[cfg(unix)]
    fn write_atomic_unix(&mut self, content: &str, tmp_path: &Path) -> anyhow::Result<()> {
        use std::ffi::CString;
        use std::io::Write as _;
        use std::os::fd::{AsRawFd as _, FromRawFd as _};
        use std::os::unix::ffi::OsStrExt as _;
        use std::os::unix::fs::{MetadataExt as _, PermissionsExt as _};

        let tmp_name = tmp_path
            .file_name()
            .context("ready-file temporary path must include a file name")?;
        let tmp_name = CString::new(tmp_name.as_bytes())
            .context("ready-file temporary name contains a NUL byte")?;
        let final_name = CString::new(self.file_name.as_bytes())
            .context("ready-file name contains a NUL byte")?;
        let parent_fd = self.parent.as_raw_fd();
        // SAFETY: both names are single NUL-terminated path components and
        // parent_fd is a live O_DIRECTORY capability owned by this target.
        let fd = unsafe {
            libc::openat(
                parent_fd,
                tmp_name.as_ptr(),
                libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                0o600,
            )
        };
        if fd < 0 {
            return Err(std::io::Error::last_os_error()).with_context(|| {
                format!(
                    "failed to create owner-only temporary ready file {}",
                    tmp_path.display()
                )
            });
        }
        // SAFETY: openat returned this owned descriptor and it is transferred
        // exactly once into File.
        let mut temporary = unsafe { std::fs::File::from_raw_fd(fd) };
        // `openat`'s mode is filtered by the process umask. Repair the opened
        // inode through its descriptor so both permissive and restrictive
        // ambient masks result in the documented exact 0600 handoff.
        temporary.set_permissions(std::fs::Permissions::from_mode(0o600))?;
        let write_result = (|| -> anyhow::Result<(u64, u64)> {
            temporary.write_all(content.as_bytes())?;
            temporary.sync_all()?;
            let metadata = temporary.metadata()?;
            let identity = (metadata.dev(), metadata.ino());
            // SAFETY: source and destination are components relative to the
            // same still-live directory descriptor.
            let renamed = unsafe {
                libc::renameat(parent_fd, tmp_name.as_ptr(), parent_fd, final_name.as_ptr())
            };
            if renamed != 0 {
                return Err(std::io::Error::last_os_error()).with_context(|| {
                    format!(
                        "failed to atomically publish ready file {}",
                        self.pinned_path.display()
                    )
                });
            }
            let published = self.identity_at(&self.file_name)?.with_context(|| {
                format!(
                    "published ready file disappeared from {}",
                    self.pinned_path.display()
                )
            })?;
            anyhow::ensure!(
                published == identity,
                "published ready file identity changed during descriptor-relative publication"
            );
            Ok(identity)
        })();
        if write_result.is_err() {
            // SAFETY: the name remains relative to the pinned parent. ENOENT
            // is expected after a successful rename followed by a later check.
            unsafe {
                libc::unlinkat(parent_fd, tmp_name.as_ptr(), 0);
            }
        }
        self.published_identity = Some(write_result?);
        Ok(())
    }

    #[cfg(unix)]
    fn identity_at(&self, name: &std::ffi::OsStr) -> std::io::Result<Option<(u64, u64)>> {
        use std::ffi::CString;
        use std::mem::MaybeUninit;
        use std::os::fd::AsRawFd as _;
        use std::os::unix::ffi::OsStrExt as _;

        let name = CString::new(name.as_bytes())
            .map_err(|_| std::io::Error::new(ErrorKind::InvalidInput, "name contains NUL"))?;
        let mut stat = MaybeUninit::<libc::stat>::uninit();
        // SAFETY: stat points to writable storage, name is NUL-terminated, and
        // the parent descriptor remains live for this target's lifetime.
        let result = unsafe {
            libc::fstatat(
                self.parent.as_raw_fd(),
                name.as_ptr(),
                stat.as_mut_ptr(),
                libc::AT_SYMLINK_NOFOLLOW,
            )
        };
        if result == 0 {
            // SAFETY: fstatat initialized stat on success.
            let stat = unsafe { stat.assume_init() };
            return Ok(Some((stat.st_dev as u64, stat.st_ino)));
        }
        let error = std::io::Error::last_os_error();
        if error.kind() == ErrorKind::NotFound {
            Ok(None)
        } else {
            Err(error)
        }
    }

    fn remove_published(&self) -> std::io::Result<()> {
        let Some(identity) = self.published_identity else {
            return Ok(());
        };
        self.remove_sibling_if_identity(&self.pinned_path, identity)
    }

    fn remove_sibling_if_identity(&self, path: &Path, identity: (u64, u64)) -> std::io::Result<()> {
        let name = path.file_name().ok_or_else(|| {
            std::io::Error::new(ErrorKind::InvalidInput, "managed sibling has no file name")
        })?;

        #[cfg(unix)]
        {
            use std::ffi::CString;
            use std::os::fd::AsRawFd as _;
            use std::os::unix::ffi::OsStrExt as _;
            if self.identity_at(name)? != Some(identity) {
                return Ok(());
            }
            let name = CString::new(name.as_bytes()).map_err(|_| {
                std::io::Error::new(ErrorKind::InvalidInput, "managed sibling contains NUL")
            })?;
            // SAFETY: name is a single path component relative to the pinned
            // parent capability. Identity was verified immediately above.
            if unsafe { libc::unlinkat(self.parent.as_raw_fd(), name.as_ptr(), 0) } != 0 {
                let error = std::io::Error::last_os_error();
                if error.kind() != ErrorKind::NotFound {
                    return Err(error);
                }
            }
            Ok(())
        }
        #[cfg(not(unix))]
        {
            if existing_file_identity(path) == Some(identity) {
                std::fs::remove_file(path)
            } else {
                Ok(())
            }
        }
    }
}

impl Drop for ReadyFileTarget {
    fn drop(&mut self) {
        let _ = self.remove_impersonation_capability();
    }
}

#[cfg(target_vendor = "apple")]
fn renameat_no_replace(
    parent_fd: std::os::fd::RawFd,
    source: &std::ffi::CStr,
    destination: &std::ffi::CStr,
) -> std::io::Result<()> {
    // SAFETY: both names are NUL-terminated components relative to the live
    // pinned directory descriptor, and the OS retains neither pointer.
    let result = unsafe {
        libc::renameatx_np(
            parent_fd,
            source.as_ptr(),
            parent_fd,
            destination.as_ptr(),
            libc::RENAME_EXCL,
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(target_os = "linux")]
fn renameat_no_replace(
    parent_fd: std::os::fd::RawFd,
    source: &std::ffi::CStr,
    destination: &std::ffi::CStr,
) -> std::io::Result<()> {
    // SAFETY: as above; RENAME_NOREPLACE makes a racing destination fail.
    let result = unsafe {
        libc::renameat2(
            parent_fd,
            source.as_ptr(),
            parent_fd,
            destination.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(target_vendor = "apple")]
fn renameat_exchange(
    parent_fd: std::os::fd::RawFd,
    source: &std::ffi::CStr,
    destination: &std::ffi::CStr,
) -> std::io::Result<()> {
    // SAFETY: both names are NUL-terminated components relative to the live
    // pinned directory; RENAME_SWAP replaces neither inode non-atomically.
    let result = unsafe {
        libc::renameatx_np(
            parent_fd,
            source.as_ptr(),
            parent_fd,
            destination.as_ptr(),
            libc::RENAME_SWAP,
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(target_os = "linux")]
fn renameat_exchange(
    parent_fd: std::os::fd::RawFd,
    source: &std::ffi::CStr,
    destination: &std::ffi::CStr,
) -> std::io::Result<()> {
    // SAFETY: as above; RENAME_EXCHANGE is the Linux atomic swap primitive.
    let result = unsafe {
        libc::renameat2(
            parent_fd,
            source.as_ptr(),
            parent_fd,
            destination.as_ptr(),
            libc::RENAME_EXCHANGE,
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(all(unix, not(any(target_vendor = "apple", target_os = "linux"))))]
fn renameat_no_replace(
    _parent_fd: std::os::fd::RawFd,
    _source: &std::ffi::CStr,
    _destination: &std::ffi::CStr,
) -> std::io::Result<()> {
    Err(std::io::Error::new(
        ErrorKind::Unsupported,
        "descriptor-relative no-replace rename is unavailable on this host",
    ))
}

#[cfg(all(unix, not(any(target_vendor = "apple", target_os = "linux"))))]
fn renameat_exchange(
    _parent_fd: std::os::fd::RawFd,
    _source: &std::ffi::CStr,
    _destination: &std::ffi::CStr,
) -> std::io::Result<()> {
    Err(std::io::Error::new(
        ErrorKind::Unsupported,
        "descriptor-relative atomic exchange is unavailable on this host",
    ))
}

#[cfg(test)]
fn write_ready_file_atomic(path: &Path, content: &str) -> anyhow::Result<()> {
    let tmp_path = ready_file_temp_path(path)?;
    write_ready_file_atomic_protected(
        path,
        content,
        &[
            ManagedPath {
                label: "ready file",
                path: path.to_path_buf(),
            },
            ManagedPath {
                label: "ready-file temporary artifact",
                path: tmp_path.clone(),
            },
        ],
        &tmp_path,
    )
}

fn ready_file_temp_path(path: &Path) -> anyhow::Result<PathBuf> {
    let file_name = path
        .file_name()
        .context("ready file path must include a file name")?
        .to_string_lossy();
    let tmp_name = format!(".{file_name}.tmp-{}", Uuid::now_v7().simple());
    Ok(path.with_file_name(tmp_name))
}

#[cfg(test)]
fn write_ready_file_atomic_protected(
    path: &Path,
    content: &str,
    protected_paths: &[ManagedPath],
    tmp_path: &Path,
) -> anyhow::Result<()> {
    let mut target = ReadyFileTarget::open(path)?;
    target.write_atomic_protected(content, protected_paths, tmp_path)
}

fn prepare_database_path(path: &Path) -> anyhow::Result<PathBuf> {
    if let Some(parent) = path.parent()
        && !parent.as_os_str().is_empty()
    {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("failed to create database directory {}", parent.display()))?;
    }
    resolve_database_path(path)
}

fn resolve_database_path(path: &Path) -> anyhow::Result<PathBuf> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()?.join(path)
    };
    match std::fs::canonicalize(&absolute) {
        Ok(resolved) => return Ok(resolved),
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(error) => {
            return Err(error).with_context(|| {
                format!("failed to resolve database path {}", absolute.display())
            });
        }
    }
    let file_name = absolute
        .file_name()
        .context("database path must include a file name")?
        .to_os_string();
    let parent = absolute
        .parent()
        .context("database path must include a parent directory")?;
    let parent = std::fs::canonicalize(parent)
        .with_context(|| format!("failed to resolve database directory {}", parent.display()))?;
    Ok(parent.join(file_name))
}

/// Resolve a restore target without creating or canonicalizing the required-
/// absent instance directory. Only its existing parent becomes authority for
/// the later descriptor-relative no-replace publication.
fn resolve_restore_database_path(path: &Path) -> anyhow::Result<PathBuf> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()?.join(path)
    };
    let database_name = absolute
        .file_name()
        .filter(|name| *name != "." && *name != "..")
        .context("restore database path must include a file name")?
        .to_os_string();
    let instance = absolute
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .context("restore database must be inside a new instance directory")?;
    let instance_name = instance
        .file_name()
        .filter(|name| *name != "." && *name != "..")
        .context("restore target instance directory must have a name")?
        .to_os_string();
    let existing_parent = instance
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let existing_parent = std::fs::canonicalize(existing_parent).with_context(|| {
        format!(
            "SNAPBACK_AUTH_BACKUP_INVALID: failed to resolve restore parent {}",
            existing_parent.display()
        )
    })?;
    Ok(existing_parent.join(instance_name).join(database_name))
}

async fn bind_listener(host: &str, port: Option<u16>) -> anyhow::Result<TcpListener> {
    if let Some(port) = port {
        return TcpListener::bind((host, port))
            .await
            .with_context(|| format!("failed to bind Snapback server to {host}:{port}"));
    }

    // @ref LLP 0010#required-tool-surfaces — normal local startup should tolerate
    // multiple Snapback instances by scanning the default dev range; explicit
    // `--port` remains a pinned automation contract.
    bind_first_available(host, DEFAULT_PORT_RANGE_START..=DEFAULT_PORT_RANGE_END).await
}

async fn bind_first_available<I>(host: &str, ports: I) -> anyhow::Result<TcpListener>
where
    I: IntoIterator<Item = u16>,
{
    let mut tried = Vec::new();
    for port in ports {
        tried.push(port);
        match TcpListener::bind((host, port)).await {
            Ok(listener) => return Ok(listener),
            Err(err) if err.kind() == ErrorKind::AddrInUse => {}
            Err(err) => {
                return Err(err)
                    .with_context(|| format!("failed to bind Snapback server to {host}:{port}"));
            }
        }
    }

    anyhow::bail!(
        "no available Snapback port on {host}; tried {}",
        describe_ports(&tried)
    );
}

fn describe_ports(ports: &[u16]) -> String {
    match ports {
        [] => "no ports".to_owned(),
        [port] => port.to_string(),
        _ if ports
            .windows(2)
            .all(|pair| pair[0].checked_add(1) == Some(pair[1])) =>
        {
            format!("{}-{}", ports[0], ports[ports.len() - 1])
        }
        _ => ports
            .iter()
            .map(u16::to_string)
            .collect::<Vec<_>>()
            .join(", "),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        Args, AuthCommand, Cli, HostCommand, ManagedPath, ReadyFileTarget, ResolvedHttpTarget,
        TargetArgs, bind_first_available, bind_listener, managed_startup_paths,
        mint_secret_read_via_http, parse_run_args, path_with_filename_suffix,
        prepare_database_path, reject_misdirected_serve_flags, resolve_http_target,
        validate_path_disjointness, validated_secret_read_root_path, write_ready_file_atomic,
        write_ready_file_atomic_protected,
    };
    use clap::Parser;
    use serde_json::json;
    use std::io::{Read as _, Write as _};
    use std::path::{Path, PathBuf};
    use std::time::Duration;
    use tokio::net::TcpListener;

    fn stop_descriptor(startup_nonce: Option<&str>) -> crate::host_ops::HostReadyDescriptor {
        crate::host_ops::HostReadyDescriptor {
            schema_version: crate::manifest::SNAPBACK_SCHEMA_VERSION.to_owned(),
            descriptor_kind: crate::host_ops::HOST_READY_DESCRIPTOR_KIND.to_owned(),
            startup_id: "srt_test".to_owned(),
            ready: true,
            server_url: "http://127.0.0.1:4287".to_owned(),
            host: "127.0.0.1".to_owned(),
            port: 4287,
            pid: 4242,
            startup_nonce: startup_nonce.map(str::to_owned),
            target: crate::host_ops::HostOpsTarget {
                app_id: "app_test".to_owned(),
                app_root: None,
                target_profile: crate::manifest::TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX.to_owned(),
                server_url: Some("http://127.0.0.1:4287".to_owned()),
            },
            database: crate::host_ops::HostReadyDatabase {
                mode: "memory".to_owned(),
                path: None,
            },
            started_at_ms: 0,
            admin_gated: false,
            admin_token_file: None,
            secret_read_root_file: None,
            impersonation_capability_file: None,
            diagnostics: Vec::new(),
        }
    }

    fn health_with_nonce(nonce: &str) -> serde_json::Value {
        json!({ "ok": true, "binary": { "startupNonce": nonce } })
    }

    fn read_http_request(stream: &mut std::net::TcpStream) -> String {
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        let mut bytes = Vec::new();
        let mut chunk = [0_u8; 4096];
        loop {
            let count = stream.read(&mut chunk).expect("read HTTP request");
            if count == 0 {
                break;
            }
            bytes.extend_from_slice(&chunk[..count]);
            let Some(header_end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") else {
                assert!(bytes.len() < 64 * 1024);
                continue;
            };
            let header_len = header_end + 4;
            let headers = String::from_utf8_lossy(&bytes[..header_len]);
            let content_len = headers
                .lines()
                .find_map(|line| {
                    let (name, value) = line.split_once(':')?;
                    name.eq_ignore_ascii_case("content-length")
                        .then(|| value.trim().parse::<usize>().ok())
                        .flatten()
                })
                .unwrap_or(0);
            if bytes.len() >= header_len + content_len {
                break;
            }
        }
        String::from_utf8(bytes).expect("HTTP request is UTF-8")
    }

    fn write_http_json(stream: &mut std::net::TcpStream, body: &serde_json::Value) {
        let body = body.to_string();
        write!(
            stream,
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
            body.len(),
            body
        )
        .unwrap();
    }

    #[test]
    fn stop_signals_only_a_nonce_verified_server() {
        let descriptor = stop_descriptor(Some("nonce-a"));
        let verdict = super::verify_stop_target(&descriptor, &Ok(health_with_nonce("nonce-a")));
        assert!(verdict.is_ok());
    }

    #[test]
    fn stop_refuses_when_the_server_is_a_different_process() {
        let descriptor = stop_descriptor(Some("nonce-a"));
        let diagnostic = super::verify_stop_target(&descriptor, &Ok(health_with_nonce("nonce-b")))
            .expect_err("a restarted server must not be signaled via the old descriptor");
        assert_eq!(diagnostic.code, "SNAPBACK_HOST_STOP_STALE_DESCRIPTOR");
    }

    #[test]
    fn stop_refuses_when_the_server_no_longer_answers() {
        let descriptor = stop_descriptor(Some("nonce-a"));
        let diagnostic =
            super::verify_stop_target(&descriptor, &Err("connection refused".to_owned()))
                .expect_err("a dead server means the pid may be reused; never signal it");
        assert_eq!(diagnostic.code, "SNAPBACK_HOST_STOP_STALE_DESCRIPTOR");
        assert_eq!(diagnostic.details["reason"], json!("connection refused"));
    }

    #[test]
    fn stop_refuses_a_descriptor_without_a_nonce() {
        let descriptor = stop_descriptor(None);
        let diagnostic = super::verify_stop_target(&descriptor, &Ok(health_with_nonce("nonce-a")))
            .expect_err("an unverifiable descriptor must be refused");
        assert_eq!(diagnostic.code, "SNAPBACK_HOST_STOP_UNVERIFIABLE");
    }

    #[test]
    fn stop_refuses_when_the_responder_reports_no_snapback_identity() {
        let descriptor = stop_descriptor(Some("nonce-a"));
        let diagnostic = super::verify_stop_target(&descriptor, &Ok(json!({ "hello": "world" })))
            .expect_err("a non-Snapback responder must not vouch for the pid");
        assert_eq!(diagnostic.code, "SNAPBACK_HOST_STOP_UNVERIFIABLE");
    }

    #[test]
    fn no_argument_defaults_start_local_dev_server() {
        let args = Args::parse_from(["snapback"]);
        assert_eq!(args.host, "127.0.0.1");
        assert_eq!(args.port, None);
        assert_eq!(args.db, PathBuf::from(".snapback/dev.sqlite3"));
        assert!(!args.memory);
    }

    #[test]
    fn port_and_storage_can_be_overridden() {
        let args = Args::parse_from([
            "snapback",
            "--host",
            "0.0.0.0",
            "--port",
            "9000",
            "--db",
            "tmp/dev.sqlite3",
            "--memory",
        ]);
        assert_eq!(args.host, "0.0.0.0");
        assert_eq!(args.port, Some(9000));
        assert_eq!(args.db, PathBuf::from("tmp/dev.sqlite3"));
        assert!(args.memory);
    }

    #[test]
    fn parent_serve_flags_with_subcommands_are_rejected() {
        let cli = Cli::parse_from(["snapback", "--memory", "start"]);

        let error = reject_misdirected_serve_flags(&cli).unwrap_err();
        assert!(
            error.to_string().contains("pass them after `start`"),
            "{error}"
        );
    }

    #[test]
    fn start_subcommand_accepts_serve_flags_after_subcommand() {
        let cli = Cli::parse_from(["snapback", "start", "--memory", "--port", "9000"]);

        reject_misdirected_serve_flags(&cli).unwrap();
        match cli.command {
            Some(HostCommand::Start(args)) => {
                assert!(args.memory);
                assert_eq!(args.port, Some(9000));
            }
            other => panic!("expected start command, got {other:?}"),
        }
    }

    #[test]
    fn auth_backup_restore_and_declared_startup_have_closed_cli_spellings() {
        let backup = Cli::parse_from([
            "snapback",
            "auth",
            "backup",
            "--db",
            "app.sqlite3",
            "--output",
            "backup",
        ]);
        assert!(matches!(
            backup.command,
            Some(HostCommand::Auth {
                command: AuthCommand::Backup { .. }
            })
        ));

        let restore = Cli::parse_from([
            "snapback",
            "auth",
            "restore",
            "--from",
            "backup",
            "--db",
            "restored/app.sqlite3",
        ]);
        assert!(matches!(
            restore.command,
            Some(HostCommand::Auth {
                command: AuthCommand::Restore { .. }
            })
        ));

        let start = Cli::parse_from([
            "snapback",
            "start",
            "--db",
            "restored/app.sqlite3",
            "--restored-from-backup",
            "019b0000-0000-7000-8000-000000000000",
        ]);
        assert!(matches!(
            start.command,
            Some(HostCommand::Start(Args {
                restored_from_backup: Some(_),
                ..
            }))
        ));
        assert!(
            Cli::try_parse_from([
                "snapback",
                "start",
                "--memory",
                "--restored-from-backup",
                "019b0000-0000-7000-8000-000000000000",
            ])
            .is_err()
        );
    }

    #[tokio::test]
    async fn physical_restore_is_quarantined_until_exact_prebind_declaration() {
        use rusqlite::params;

        let directory = tempfile::tempdir().unwrap();
        let source_database = directory.path().join("source.sqlite3");
        let mut database = crate::storage::LocalDatabase::open(&source_database).unwrap();
        let keyring = crate::auth::keyring::AuthKeyringStore::file_for_database(&source_database);
        crate::auth::lifecycle::activate_catalog(
            &mut database,
            &keyring,
            1_700_000_000_000,
            &crate::auth::crypto::OsRandom,
        )
        .unwrap();
        let key_id = keyring
            .with_active_key(
                1_700_000_000_000,
                &crate::auth::crypto::OsRandom,
                |id, _| id.as_str().to_owned(),
            )
            .unwrap();
        database
            .with_auth_transaction(|transaction| {
                transaction.execute(
                    "INSERT INTO _auth_users(id, created_at_ms) VALUES('user', 0)",
                    [],
                )?;
                transaction.execute(
                    "INSERT INTO _auth_identities(
                       id, user_id, provider, subject, verified_at_ms
                     ) VALUES('identity', 'user', 'email-code', 'person@example.com', 0)",
                    [],
                )?;
                transaction.execute(
                    "INSERT INTO _auth_sessions(
                       id, user_id, identity_id, authority_instance_id, token_hash,
                       generation, created_at_ms, last_used_at_ms, expires_at_ms,
                       absolute_expires_at_ms, revoked_at_ms
                     ) VALUES('session', 'user', 'identity', 'authority', ?1,
                              1, 0, 0, 2000000000000, 2000000000000, NULL)",
                    params![vec![1_u8; 32]],
                )?;
                transaction.execute(
                    "INSERT INTO _auth_verification_codes(
                       challenge_id, canonical_address, code_digest, key_id,
                       attempts, max_attempts, requested_at_ms, expires_at_ms,
                       consumed_at_ms, superseded_by
                     ) VALUES('sbc_AAAAAAAAAAAAAAAAAAAAAA', 'person@example.com', ?1, ?2,
                              0, 5, 0, 2000000000000, NULL, NULL)",
                    params![vec![2_u8; 32], key_id],
                )?;
                Ok(())
            })
            .unwrap();
        drop(database);

        let backup = directory.path().join("backup");
        super::auth_backup(&source_database, &backup).await.unwrap();
        let restored_database = directory.path().join("restored").join("app.sqlite3");
        super::auth_restore(&backup, &restored_database).unwrap();
        let declaration_path = restored_database
            .parent()
            .unwrap()
            .join(crate::auth::lifecycle::RESTORE_DECLARATION_FILE);
        let declaration = crate::auth::lifecycle::RestoreDeclaration::parse(
            &crate::secure_file::read_owner_only(&declaration_path).unwrap(),
        )
        .unwrap();

        let ready = directory.path().join("restored.ready.json");
        let missing = super::run(Args {
            host: "127.0.0.1".to_owned(),
            port: Some(0),
            db: restored_database.clone(),
            memory: false,
            ready_file: Some(ready.clone()),
            restored_from_backup: None,
        })
        .await
        .expect_err("restored rows must not reach a listener without declaration authority");
        assert!(missing.to_string().contains("--restored-from-backup"));
        assert!(!ready.exists());

        let declaration_id = declaration.declaration_id().to_owned();
        let server = tokio::spawn(super::run(Args {
            host: "127.0.0.1".to_owned(),
            port: Some(0),
            db: restored_database.clone(),
            memory: false,
            ready_file: Some(ready.clone()),
            restored_from_backup: Some(declaration_id),
        }));
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        while !ready.exists() {
            assert!(
                std::time::Instant::now() < deadline,
                "declared restore never reached readiness"
            );
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        server.abort();
        let _ = server.await;
        assert!(!declaration_path.exists());

        let restored = crate::storage::LocalDatabase::open(&restored_database).unwrap();
        let facts = restored
            .with_auth_read(|connection| {
                Ok((
                    connection.query_row(
                        "SELECT generation, revoked_at_ms IS NOT NULL
                         FROM _auth_sessions WHERE id = 'session'",
                        [],
                        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, bool>(1)?)),
                    )?,
                    connection.query_row(
                        "SELECT COUNT(*) FROM _auth_verification_codes",
                        [],
                        |row| row.get::<_, i64>(0),
                    )?,
                ))
            })
            .unwrap();
        assert_eq!(facts, ((2, true), 0));
    }

    #[test]
    fn secret_read_mint_is_structurally_ready_file_only() {
        assert!(
            Cli::try_parse_from([
                "snapback",
                "secret-read-mint",
                "--url",
                "http://127.0.0.1:4287",
                "--admin-inspect",
            ])
            .is_err()
        );
        assert!(
            Cli::try_parse_from([
                "snapback",
                "secret-read-mint",
                "--ready-file",
                "ready.json",
                "--admin-inspect",
            ])
            .is_ok()
        );
    }

    #[test]
    fn run_args_must_be_json_object() {
        assert!(parse_run_args(Some(r#"{"title":"hello"}"#.to_owned())).is_ok());

        let error = parse_run_args(Some(r#"["hello"]"#.to_owned())).unwrap_err();
        assert!(error.to_string().contains("--args must be a JSON object"));
    }

    #[test]
    fn secret_read_root_path_substitution_is_refused_before_file_or_network_access() {
        let dir = tempfile::tempdir().unwrap();
        let ready = std::fs::canonicalize(dir.path())
            .unwrap()
            .join("server.json");
        let attacker_root = dir.path().join("attacker-root");
        crate::secure_file::write_owner_only(&attacker_root, b"sbrk_deadbeef\n").unwrap();
        let mut descriptor = stop_descriptor(Some("startup-a"));
        descriptor.secret_read_root_file = Some(attacker_root.display().to_string());
        let error = validated_secret_read_root_path(&ready, &descriptor).unwrap_err();
        assert!(
            error
                .to_string()
                .contains("SNAPBACK_ADMIN_SECRET_READ_ROOT_PATH_INVALID")
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn ready_file_cli_mints_a_derived_lease_without_exposing_the_root() {
        let dir = tempfile::tempdir().unwrap();
        let ready = std::fs::canonicalize(dir.path())
            .unwrap()
            .join("server.json");
        let root_path = crate::admin_secret_read::secret_read_root_sibling(&ready);
        let server_root = crate::admin_secret_read::resolve_secret_read_proof_root_with_io(
            &root_path,
            crate::secure_file::read_owner_only,
            crate::secure_file::write_owner_only,
        )
        .unwrap();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let mut context =
            crate::admin::ServerContext::new(address.ip().to_string(), address.port(), true);
        context.admin_token = Some("ordinary-admin".to_owned());
        let (state, operator) = crate::admin::AppState::from_snapback_with_secret_read_operator(
            crate::local::LocalSnapback::memory().unwrap(),
            context,
        );
        let startup_nonce = crate::identity::binary_identity().startup_nonce;
        let app = crate::server::app(state.with_secret_read_mint_bridge(
            crate::admin_secret_read::SecretReadMintBridge::new(
                operator,
                server_root,
                startup_nonce.clone(),
            ),
        ));
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let mut descriptor = stop_descriptor(Some(&startup_nonce));
        descriptor.server_url = format!("http://{address}");
        descriptor.host = address.ip().to_string();
        descriptor.port = address.port();
        descriptor.secret_read_root_file = Some(root_path.display().to_string());
        crate::secure_file::write_owner_only(
            &ready,
            serde_json::to_string(&descriptor).unwrap().as_bytes(),
        )
        .unwrap();
        let response = tokio::task::spawn_blocking(move || {
            mint_secret_read_via_http(
                &ready,
                Some("ordinary-admin".to_owned()),
                crate::admin_secret_read::SecretReadMintSpec {
                    scopes: std::collections::BTreeSet::from([
                        crate::admin_secret_read::SecretReadScope::AdminInspect,
                    ]),
                    ttl_ms: 60_000,
                    row_budget: 10,
                    byte_budget: 1_000,
                },
            )
        })
        .await
        .unwrap()
        .unwrap();
        assert_eq!(response.as_object().unwrap().len(), 1);
        assert!(response["lease"].as_str().unwrap().starts_with("sbrl_"));
        assert!(!serde_json::to_string(&response).unwrap().contains("sbrk_"));
        server.abort();
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn stale_ready_descriptor_sends_adversarial_server_no_admin_or_proof_material() {
        use axum::body::Bytes;
        use axum::http::HeaderMap;
        use axum::routing::{get, post};
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::{Arc, Mutex as StdMutex};

        let observed = Arc::new(StdMutex::new(Vec::<u8>::new()));
        let mint_calls = Arc::new(AtomicUsize::new(0));
        let health_observed = observed.clone();
        let mint_observed = observed.clone();
        let mint_calls_handler = mint_calls.clone();
        let attacker = axum::Router::new()
            .route(
                "/health",
                get(move |headers: HeaderMap| {
                    let observed = health_observed.clone();
                    async move {
                        let mut observed = observed.lock().unwrap();
                        for (name, value) in &headers {
                            observed.extend_from_slice(name.as_str().as_bytes());
                            observed.extend_from_slice(value.as_bytes());
                        }
                        axum::Json(json!({
                            "ok": true,
                            "binary": { "startupNonce": "attacker-startup" }
                        }))
                    }
                }),
            )
            .route(
                "/_snapback/api/admin-secret-read/mint",
                post(move |headers: HeaderMap, body: Bytes| {
                    let observed = mint_observed.clone();
                    let mint_calls = mint_calls_handler.clone();
                    async move {
                        mint_calls.fetch_add(1, Ordering::SeqCst);
                        let mut observed = observed.lock().unwrap();
                        for (name, value) in &headers {
                            observed.extend_from_slice(name.as_str().as_bytes());
                            observed.extend_from_slice(value.as_bytes());
                        }
                        observed.extend_from_slice(&body);
                        axum::Json(json!({ "lease": "attacker" }))
                    }
                }),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, attacker).await.unwrap();
        });

        let dir = tempfile::tempdir().unwrap();
        let ready = std::fs::canonicalize(dir.path())
            .unwrap()
            .join("server.json");
        let root_path = crate::admin_secret_read::secret_read_root_sibling(&ready);
        // If the CLI tries to read the root before checking /health this
        // non-regular path fails with a different error, making ordering part
        // of the acceptance rather than an unobservable implementation detail.
        std::fs::create_dir(&root_path).unwrap();
        let mut descriptor = stop_descriptor(Some("trusted-startup"));
        descriptor.server_url = format!("http://{address}");
        descriptor.host = address.ip().to_string();
        descriptor.port = address.port();
        descriptor.secret_read_root_file = Some(root_path.display().to_string());
        crate::secure_file::write_owner_only(
            &ready,
            serde_json::to_string(&descriptor).unwrap().as_bytes(),
        )
        .unwrap();
        let error = tokio::task::spawn_blocking(move || {
            mint_secret_read_via_http(
                &ready,
                Some("DURABLE_ADMIN_SENTINEL".to_owned()),
                crate::admin_secret_read::SecretReadMintSpec {
                    scopes: std::collections::BTreeSet::from([
                        crate::admin_secret_read::SecretReadScope::AdminInspect,
                    ]),
                    ttl_ms: 60_000,
                    row_budget: 10,
                    byte_budget: 1_000,
                },
            )
        })
        .await
        .unwrap()
        .unwrap_err();
        assert!(
            error
                .to_string()
                .contains("SNAPBACK_HOST_STOP_STALE_DESCRIPTOR"),
            "{error:#}"
        );
        assert_eq!(mint_calls.load(Ordering::SeqCst), 0);
        let observed = String::from_utf8_lossy(&observed.lock().unwrap()).into_owned();
        assert!(!observed.contains("DURABLE_ADMIN_SENTINEL"));
        assert!(!observed.contains("sbrk_"));
        assert!(!observed.contains("\"proof\""));
        server.abort();
    }

    #[test]
    fn credential_bearing_cli_debug_never_exposes_token_material() {
        const SENTINEL: &str = "CLI_CREDENTIAL_SENTINEL_MUST_NOT_ESCAPE";
        let target = TargetArgs {
            url: Some("http://127.0.0.1:4287".to_owned()),
            ready_file: None,
            token: Some(SENTINEL.to_owned()),
        };
        let target_debug = format!("{target:?}");
        assert!(!target_debug.contains(SENTINEL), "{target_debug}");
        assert!(target_debug.contains("[REDACTED]"), "{target_debug}");

        let command = HostCommand::Inspect(target);
        let command_debug = format!("{command:?}");
        assert!(!command_debug.contains(SENTINEL), "{command_debug}");
        assert!(command_debug.contains("[REDACTED]"), "{command_debug}");

        let mint_command = HostCommand::SecretReadMint {
            ready_file: PathBuf::from("ready.json"),
            token: Some(SENTINEL.to_owned()),
            admin_inspect: true,
            receipts: false,
            table: Vec::new(),
            function: Vec::new(),
            explain_function: Vec::new(),
            ttl_seconds: 60,
            row_budget: 10,
            byte_budget: 1_000,
        };
        let mint_debug = format!("{mint_command:?}");
        assert!(!mint_debug.contains(SENTINEL), "{mint_debug}");
        assert!(mint_debug.contains("[REDACTED]"), "{mint_debug}");

        let cli = Cli::parse_from([
            "snapback",
            "inspect",
            "--url",
            "http://127.0.0.1:4287",
            "--token",
            SENTINEL,
        ]);
        let cli_debug = format!("{cli:?}");
        assert!(!cli_debug.contains(SENTINEL), "{cli_debug}");

        let resolved = ResolvedHttpTarget {
            server_url: "http://127.0.0.1:4287".to_owned(),
            minted_token: Some(SENTINEL.to_owned()),
            impersonation_capability: None,
        };
        let resolved_debug = format!("{resolved:?}");
        assert!(!resolved_debug.contains(SENTINEL), "{resolved_debug}");
        assert!(resolved_debug.contains("[REDACTED]"), "{resolved_debug}");
    }

    #[test]
    fn ready_file_write_publishes_final_content() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("ready.json");

        write_ready_file_atomic(&path, "{\"ready\":true}\n").unwrap();

        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "{\"ready\":true}\n"
        );
        let leftovers = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().contains(".tmp-"))
            .count();
        assert_eq!(leftovers, 0, "temporary ready files should be cleaned up");
    }

    #[test]
    fn ready_file_must_be_identity_disjoint_from_every_managed_artifact() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("app.sqlite3");
        std::fs::write(&db, b"database").unwrap();

        for ready in [
            db.clone(),
            crate::instance_lock::lock_path_for_database(&db).unwrap(),
            crate::config::ConfigStore::path_for_database(&db),
            crate::admin::admin_token_sibling(&db),
            path_with_filename_suffix(&db, "-wal").unwrap(),
            dir.path()
                .join("missing-parent")
                .join("..")
                .join("app.sqlite3-wal"),
        ] {
            let error = validate_path_disjointness(
                &managed_startup_paths(Some(&db), Some(&ready)).unwrap(),
            )
            .unwrap_err();
            assert!(
                error
                    .to_string()
                    .contains("SNAPBACK_READY_FILE_PATH_COLLISION"),
                "{error:#}"
            );
        }

        let distinct = dir.path().join("server.ready.json");
        validate_path_disjointness(&managed_startup_paths(Some(&db), Some(&distinct)).unwrap())
            .unwrap();

        for colliding_db in [
            dir.path().join("operator.ready.secret-read-root"),
            dir.path().join("operator.ready.impersonation"),
        ] {
            let colliding_ready = dir.path().join("operator.ready");
            let error = validate_path_disjointness(
                &managed_startup_paths(Some(&colliding_db), Some(&colliding_ready)).unwrap(),
            )
            .unwrap_err();
            assert!(
                error
                    .to_string()
                    .contains("SNAPBACK_READY_FILE_PATH_COLLISION")
            );
        }
    }

    #[test]
    fn ready_file_cannot_create_a_parent_at_a_managed_sidecar_path() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("app.sqlite3");
        let lock = crate::instance_lock::lock_path_for_database(&db).unwrap();
        let nested_ready = lock.join("ready.json");
        let error = validate_path_disjointness(
            &managed_startup_paths(Some(&db), Some(&nested_ready)).unwrap(),
        )
        .expect_err("a ready parent cannot occupy the database lock path");
        assert!(
            error
                .to_string()
                .contains("SNAPBACK_READY_FILE_PATH_COLLISION"),
            "{error:#}"
        );
        assert!(
            !lock.exists(),
            "preflight must reject before creating the colliding parent"
        );

        let wal = super::path_with_filename_suffix(&db, "-wal").unwrap();
        let dotdot_ready = wal.join("transient").join("..").join("ready.json");
        assert!(
            validate_path_disjointness(
                &managed_startup_paths(Some(&db), Some(&dotdot_ready)).unwrap()
            )
            .is_err(),
            "normalized .. spelling must not bypass the ancestor collision"
        );
        assert!(!wal.exists());
    }

    #[cfg(unix)]
    #[test]
    fn ready_file_rejects_symlink_and_hardlink_aliases() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("app.sqlite3");
        std::fs::write(&db, b"database").unwrap();

        let symlink = dir.path().join("symlink.ready");
        std::os::unix::fs::symlink(&db, &symlink).unwrap();
        let error =
            validate_path_disjointness(&managed_startup_paths(Some(&db), Some(&symlink)).unwrap())
                .unwrap_err();
        assert!(
            error
                .to_string()
                .contains("SNAPBACK_READY_FILE_PATH_COLLISION")
        );

        let hardlink = dir.path().join("hardlink.ready");
        std::fs::hard_link(&db, &hardlink).unwrap();
        let error =
            validate_path_disjointness(&managed_startup_paths(Some(&db), Some(&hardlink)).unwrap())
                .unwrap_err();
        assert!(
            error
                .to_string()
                .contains("SNAPBACK_READY_FILE_PATH_COLLISION")
        );
    }

    #[cfg(unix)]
    #[test]
    fn ready_file_parent_swap_cannot_redirect_publish_or_cleanup() {
        let dir = tempfile::tempdir().unwrap();
        let database_parent = dir.path().join("database");
        let ready_parent = dir.path().join("ready");
        std::fs::create_dir_all(&database_parent).unwrap();
        std::fs::create_dir_all(&ready_parent).unwrap();
        let database = database_parent.join("app.sqlite3");
        std::fs::write(&database, b"live database").unwrap();

        let mutable_parent = dir.path().join("mutable-parent");
        std::os::unix::fs::symlink(&ready_parent, &mutable_parent).unwrap();
        let requested = mutable_parent.join("app.sqlite3");
        let mut target = ReadyFileTarget::open(&requested).unwrap();
        let temporary = super::ready_file_temp_path(target.pinned_path()).unwrap();
        let protected = managed_startup_paths(Some(&database), Some(target.pinned_path())).unwrap();
        let pinned_token = ready_parent.join("app.sqlite3.admin-token");
        let database_token = database_parent.join("app.sqlite3.admin-token");
        std::fs::write(&pinned_token, b"ephemeral token").unwrap();
        std::fs::write(&database_token, b"database-side sentinel").unwrap();
        let token_identity = super::existing_file_identity(&pinned_token).unwrap();

        std::fs::remove_file(&mutable_parent).unwrap();
        std::os::unix::fs::symlink(&database_parent, &mutable_parent).unwrap();
        target
            .write_atomic_protected("ready", &protected, &temporary)
            .unwrap();

        assert_eq!(std::fs::read(&database).unwrap(), b"live database");
        assert_eq!(
            std::fs::read(ready_parent.join("app.sqlite3")).unwrap(),
            b"ready"
        );
        target.remove_published().unwrap();
        target
            .remove_sibling_if_identity(&pinned_token, token_identity)
            .unwrap();
        assert_eq!(std::fs::read(&database).unwrap(), b"live database");
        assert_eq!(
            std::fs::read(&database_token).unwrap(),
            b"database-side sentinel"
        );
        assert!(!ready_parent.join("app.sqlite3").exists());
        assert!(!pinned_token.exists());
    }

    #[cfg(unix)]
    #[test]
    fn attach_parent_swap_cannot_splice_a_different_impersonation_sidecar() {
        let dir = tempfile::tempdir().unwrap();
        let trusted_parent = dir.path().join("trusted");
        let attacker_parent = dir.path().join("attacker");
        std::fs::create_dir(&trusted_parent).unwrap();
        std::fs::create_dir(&attacker_parent).unwrap();
        let trusted_ready = std::fs::canonicalize(&trusted_parent)
            .unwrap()
            .join("server.ready.json");
        let attacker_ready = std::fs::canonicalize(&attacker_parent)
            .unwrap()
            .join("server.ready.json");
        crate::secure_file::write_owner_only(&trusted_ready, b"trusted-descriptor").unwrap();
        crate::secure_file::write_owner_only(&attacker_ready, b"attacker-descriptor").unwrap();

        let publish = |ready: &Path, nonce: &str| {
            let (_registry, operator) =
                crate::admin_impersonation::ImpersonationCapabilityRegistry::generate(
                    nonce.to_owned(),
                    &crate::auth::crypto::OsRandom,
                )
                .unwrap();
            let path = operator
                .publish_with(ready, |path, bytes| {
                    crate::secure_file::write_owner_only(path, bytes)
                })
                .unwrap();
            (path.clone(), std::fs::read(path).unwrap())
        };
        let (trusted_sidecar, trusted_bytes) = publish(&trusted_ready, "trusted");
        let (_attacker_sidecar, attacker_bytes) = publish(&attacker_ready, "attacker");
        assert_ne!(trusted_bytes, attacker_bytes);

        let mutable_parent = dir.path().join("mutable");
        std::os::unix::fs::symlink(&trusted_parent, &mutable_parent).unwrap();
        let target = ReadyFileTarget::open_existing(&mutable_parent.join("server.ready.json"))
            .expect("pin trusted attach parent");
        assert_eq!(
            target
                .read_owner_only_sibling(target.pinned_path())
                .unwrap(),
            b"trusted-descriptor"
        );

        std::fs::remove_file(&mutable_parent).unwrap();
        std::os::unix::fs::symlink(&attacker_parent, &mutable_parent).unwrap();
        assert_eq!(target.pinned_path(), trusted_ready);
        assert_eq!(
            target
                .read_strict_owner_only_sibling(
                    &trusted_sidecar,
                    crate::admin_impersonation::MAX_IMPERSONATION_CAPABILITY_FILE_BYTES,
                )
                .unwrap(),
            trusted_bytes,
            "the attach must keep reading beneath the parent pinned before descriptor validation"
        );
    }

    #[cfg(unix)]
    #[test]
    fn replaced_canonical_ready_parent_cannot_split_the_token_handoff() {
        use std::os::unix::fs::PermissionsExt as _;

        let dir = tempfile::tempdir().unwrap();
        let ready_parent = dir.path().join("ready");
        let moved_parent = dir.path().join("ready-moved");
        std::fs::create_dir(&ready_parent).unwrap();
        let target = ReadyFileTarget::open(&ready_parent.join("server.json")).unwrap();
        let token_path = crate::admin::admin_token_sibling(target.pinned_path());

        std::fs::rename(&ready_parent, &moved_parent).unwrap();
        std::fs::create_dir(&ready_parent).unwrap();
        let replacement_token = ready_parent.join("server.json.admin-token");
        std::fs::write(&replacement_token, b"another-instance-token\n").unwrap();
        std::fs::set_permissions(&replacement_token, std::fs::Permissions::from_mode(0o600))
            .unwrap();

        let error = crate::admin::resolve_serve_admin_token_with_io(
            None,
            Some(token_path),
            |path| target.read_owner_only_sibling(path),
            |path, bytes| target.write_owner_only_sibling(path, bytes),
        )
        .expect_err("a renamed/replaced advertised parent must fail closed");
        assert!(
            format!("{error:#}").contains("parent identity changed"),
            "{error:#}"
        );
        assert_eq!(
            std::fs::read(&replacement_token).unwrap(),
            b"another-instance-token\n",
            "the replacement directory's capability must never be adopted or rewritten"
        );
        assert!(!moved_parent.join("server.json.admin-token").exists());
    }

    #[cfg(unix)]
    #[test]
    fn ready_publication_refuses_a_precreated_temp_hardlink_without_truncation() {
        let dir = tempfile::tempdir().unwrap();
        let ready = dir.path().join("server.ready.json");
        let tmp = dir.path().join(".server.ready.json.injected-temp");
        let managed = dir.path().join("managed-artifact");
        std::fs::write(&managed, b"do-not-touch").unwrap();
        std::fs::hard_link(&managed, &tmp).unwrap();
        let protected = [
            ManagedPath {
                label: "ready file",
                path: ready.clone(),
            },
            ManagedPath {
                label: "ready-file temporary artifact",
                path: tmp.clone(),
            },
        ];

        write_ready_file_atomic_protected(&ready, "replacement", &protected, &tmp)
            .expect_err("an existing temp inode must never be opened or truncated");
        assert_eq!(std::fs::read(managed).unwrap(), b"do-not-touch");
        assert!(!ready.exists());
    }

    #[test]
    fn terminal_emission_seam_consumes_one_operator_and_frames_one_line() {
        let (_registry, operator) =
            crate::admin_impersonation::ImpersonationCapabilityRegistry::generate(
                "nonce-terminal".to_owned(),
                &crate::auth::crypto::OsRandom,
            )
            .unwrap();
        let mut output = Vec::new();
        super::emit_impersonation_capability_to_writer(operator, &mut output).unwrap();
        let output = String::from_utf8(output).unwrap();
        assert!(output.starts_with("impersonation capability: sbic_"));
        assert_eq!(output.lines().count(), 1);
        assert!(output.ends_with('\n'));
    }

    #[cfg(unix)]
    #[test]
    fn impersonation_sidecar_is_exact_owner_only_and_replaces_a_valid_crash_remnant() {
        use std::os::unix::fs::PermissionsExt as _;

        let dir = tempfile::tempdir().unwrap();
        let ready = dir.path().join("server.ready.json");
        let mut target = ReadyFileTarget::open(&ready).unwrap();
        let pinned_ready = target.pinned_path().to_path_buf();
        let sidecar =
            crate::admin_impersonation::impersonation_capability_sibling(&pinned_ready).unwrap();
        let temporary = super::ready_file_temp_path(&sidecar).unwrap();

        let (_old_registry, old_operator) =
            crate::admin_impersonation::ImpersonationCapabilityRegistry::generate(
                "nonce-old".to_owned(),
                &crate::auth::crypto::OsRandom,
            )
            .unwrap();
        old_operator
            .publish_with(&pinned_ready, |path, bytes| {
                crate::secure_file::write_owner_only(path, bytes)
            })
            .unwrap();
        let old_bytes = std::fs::read(&sidecar).unwrap();

        let (_new_registry, new_operator) =
            crate::admin_impersonation::ImpersonationCapabilityRegistry::generate(
                "nonce-new".to_owned(),
                &crate::auth::crypto::OsRandom,
            )
            .unwrap();
        let published = new_operator
            .publish_with(&pinned_ready, |path, bytes| {
                target.publish_owner_only_sibling_atomic(path, &temporary, bytes)
            })
            .unwrap();
        let new_bytes = std::fs::read(&published).unwrap();

        assert_ne!(
            new_bytes, old_bytes,
            "restart must replace the stale bearer"
        );
        assert!(!new_bytes.contains(&b'\n'));
        assert_eq!(
            std::fs::metadata(&published).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert!(!temporary.exists());
        drop(target);
        assert!(!sidecar.exists(), "the process-owned sidecar is cleaned up");
    }

    #[cfg(unix)]
    #[test]
    fn impersonation_sidecar_refuses_symlink_and_hardlink_destinations() {
        use std::os::unix::fs::PermissionsExt as _;

        for hard_link in [false, true] {
            let dir = tempfile::tempdir().unwrap();
            let ready = dir.path().join("server.ready.json");
            let mut target = ReadyFileTarget::open(&ready).unwrap();
            let pinned_ready = target.pinned_path().to_path_buf();
            let sidecar =
                crate::admin_impersonation::impersonation_capability_sibling(&pinned_ready)
                    .unwrap();
            let temporary = super::ready_file_temp_path(&sidecar).unwrap();
            let sentinel = dir.path().join("attacker-owned");
            std::fs::write(&sentinel, b"do-not-touch").unwrap();
            std::fs::set_permissions(&sentinel, std::fs::Permissions::from_mode(0o600)).unwrap();
            if hard_link {
                std::fs::hard_link(&sentinel, &sidecar).unwrap();
            } else {
                std::os::unix::fs::symlink(&sentinel, &sidecar).unwrap();
            }
            let (_registry, operator) =
                crate::admin_impersonation::ImpersonationCapabilityRegistry::generate(
                    "nonce".to_owned(),
                    &crate::auth::crypto::OsRandom,
                )
                .unwrap();
            operator
                .publish_with(&pinned_ready, |path, bytes| {
                    target.publish_owner_only_sibling_atomic(path, &temporary, bytes)
                })
                .expect_err("an aliasing destination must be refused");
            assert_eq!(std::fs::read(&sentinel).unwrap(), b"do-not-touch");
            assert!(!temporary.exists());
        }
    }

    #[cfg(unix)]
    #[test]
    fn descriptor_publication_failure_rolls_back_the_published_sidecar() {
        let dir = tempfile::tempdir().unwrap();
        let ready = dir.path().join("server.ready.json");
        let mut target = ReadyFileTarget::open(&ready).unwrap();
        let pinned_ready = target.pinned_path().to_path_buf();
        let descriptor_temp = super::ready_file_temp_path(&pinned_ready).unwrap();
        let sidecar =
            crate::admin_impersonation::impersonation_capability_sibling(&pinned_ready).unwrap();
        let sidecar_temp = super::ready_file_temp_path(&sidecar).unwrap();
        let (_registry, operator) =
            crate::admin_impersonation::ImpersonationCapabilityRegistry::generate(
                "nonce".to_owned(),
                &crate::auth::crypto::OsRandom,
            )
            .unwrap();
        operator
            .publish_with(&pinned_ready, |path, bytes| {
                target.publish_owner_only_sibling_atomic(path, &sidecar_temp, bytes)
            })
            .unwrap();
        assert!(sidecar.exists());

        std::fs::write(&descriptor_temp, b"attacker-temp").unwrap();
        let protected = managed_startup_paths(None, Some(&pinned_ready)).unwrap();
        target
            .write_atomic_protected("descriptor", &protected, &descriptor_temp)
            .expect_err("pre-created descriptor temporary must fail publication");
        drop(target);

        assert!(
            !sidecar.exists(),
            "sidecar must not outlive failed readiness"
        );
        assert_eq!(std::fs::read(&descriptor_temp).unwrap(), b"attacker-temp");
    }

    #[cfg(unix)]
    #[test]
    fn ready_file_is_owner_only_even_under_zero_umask() {
        use std::os::unix::fs::PermissionsExt as _;

        const CHILD_ENV: &str = "SNAPBACK_TEST_READY_FILE_ZERO_UMASK_CHILD";
        if std::env::var_os(CHILD_ENV).is_none() {
            // umask is process-global. Re-run only this test in a subprocess so
            // the adversarial setting cannot weaken files created by parallel
            // tests in this binary.
            let output = std::process::Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "cli::tests::ready_file_is_owner_only_even_under_zero_umask",
                    "--nocapture",
                ])
                .env(CHILD_ENV, "1")
                .output()
                .expect("run isolated zero-umask readiness test");
            assert!(
                output.status.success(),
                "zero-umask readiness child failed\nstdout:\n{}\nstderr:\n{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            return;
        }

        // SAFETY: this is the isolated child process described above.
        let previous = unsafe { libc::umask(0) };
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("ready.json");
        let result = write_ready_file_atomic(&path, "{\"ready\":true}\n");
        let mode = result
            .as_ref()
            .ok()
            .and_then(|()| std::fs::metadata(&path).ok())
            .map(|metadata| metadata.permissions().mode() & 0o777);
        // SAFETY: restore the child's process-global mask before asserting.
        unsafe { libc::umask(previous) };

        result.expect("publish readiness descriptor under zero umask");
        assert_eq!(mode, Some(0o600));
    }

    #[cfg(unix)]
    #[test]
    fn ready_file_is_readable_owner_only_under_restrictive_umask() {
        use std::os::unix::fs::PermissionsExt as _;

        const CHILD_ENV: &str = "SNAPBACK_TEST_READY_FILE_RESTRICTIVE_UMASK_CHILD";
        if std::env::var_os(CHILD_ENV).is_none() {
            let output = std::process::Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "cli::tests::ready_file_is_readable_owner_only_under_restrictive_umask",
                    "--nocapture",
                ])
                .env(CHILD_ENV, "1")
                .output()
                .expect("run isolated restrictive-umask readiness test");
            assert!(
                output.status.success(),
                "restrictive-umask readiness child failed\nstdout:\n{}\nstderr:\n{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            return;
        }

        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("ready.json");
        // SAFETY: this is the isolated child process described above. Create
        // the parent first so the test isolates the ready file's exact mode,
        // not tempfile's own directory creation policy.
        let previous = unsafe { libc::umask(0o777) };
        let result = write_ready_file_atomic(&path, "{\"ready\":true}\n");
        let mode = result
            .as_ref()
            .ok()
            .and_then(|()| std::fs::metadata(&path).ok())
            .map(|metadata| metadata.permissions().mode() & 0o777);
        let contents = std::fs::read_to_string(&path);
        // SAFETY: restore the child's process-global mask before asserting.
        unsafe { libc::umask(previous) };

        result.expect("publish readiness under restrictive umask");
        assert_eq!(mode, Some(0o600));
        assert_eq!(contents.unwrap(), "{\"ready\":true}\n");
    }

    #[cfg(unix)]
    #[test]
    fn ordinary_manifest_reads_do_not_change_shared_source_permissions() {
        use std::os::unix::fs::PermissionsExt as _;

        let dir = tempfile::tempdir().unwrap();
        let manifest = dir.path().join("schema.manifest.json");
        std::fs::write(&manifest, b"{\"schemaVersion\":\"snapback.dev/v1\"}").unwrap();
        std::fs::set_permissions(&manifest, std::fs::Permissions::from_mode(0o644)).unwrap();

        assert!(super::read_json_file(&manifest).is_ok());
        assert_eq!(
            std::fs::metadata(manifest).unwrap().permissions().mode() & 0o777,
            0o644,
            "ordinary CLI inputs are data, not local capability files"
        );
    }

    #[test]
    fn remote_url_never_selects_a_local_token_file() {
        let dir = tempfile::tempdir().unwrap();
        let chosen_by_attacker = dir.path().join("local-secret");
        std::fs::write(&chosen_by_attacker, b"must-not-leave-host").unwrap();
        let target = TargetArgs {
            url: Some("http://127.0.0.1:4400".to_owned()),
            ready_file: None,
            token: None,
        };

        let resolved = resolve_http_target(&target).expect("resolve remote target");
        assert_eq!(resolved.minted_token, None);
        assert_eq!(resolved.server_url, "http://127.0.0.1:4400");
    }

    #[test]
    fn ordinary_ready_file_host_op_never_reads_or_attaches_impersonation_sidecar() {
        let dir = tempfile::tempdir().unwrap();
        let ready = dir.path().join("ready.json");
        let canonical_ready = std::fs::canonicalize(dir.path())
            .unwrap()
            .join("ready.json");
        let sidecar =
            crate::admin_impersonation::impersonation_capability_sibling(&canonical_ready).unwrap();
        // If the ordinary path accidentally tries discovery this deliberately
        // invalid content will fail before the request reaches the server.
        std::fs::write(&sidecar, b"attacker-chosen-not-a-capability").unwrap();

        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let request = read_http_request(&mut stream);
            write_http_json(&mut stream, &json!({"ok": true}));
            request
        });

        let mut descriptor = stop_descriptor(Some("nonce-unused"));
        descriptor.server_url = format!("http://{address}");
        descriptor.target.server_url = Some(descriptor.server_url.clone());
        descriptor.impersonation_capability_file = Some(sidecar.display().to_string());
        crate::secure_file::write_owner_only(&ready, &serde_json::to_vec(&descriptor).unwrap())
            .unwrap();
        let target = TargetArgs {
            url: None,
            ready_file: Some(ready),
            token: None,
        };
        let response = super::post_host_op(&target, json!({"operation": "app.inspect"})).unwrap();
        assert_eq!(response["ok"], json!(true));
        let request = server.join().unwrap();
        assert!(request.starts_with("POST /_snapback/api/host-ops "));
        assert!(
            !request
                .to_ascii_lowercase()
                .contains(crate::admin_impersonation::IMPERSONATION_CAPABILITY_HEADER),
            "ordinary operations must not attach the independent effect capability"
        );
    }

    #[test]
    fn registered_impersonation_host_op_live_checks_then_attaches_exact_sidecar() {
        let dir = tempfile::tempdir().unwrap();
        let ready = dir.path().join("ready.json");
        let canonical_ready = std::fs::canonicalize(dir.path())
            .unwrap()
            .join("ready.json");
        let sidecar =
            crate::admin_impersonation::impersonation_capability_sibling(&canonical_ready).unwrap();
        let (_registry, operator) =
            crate::admin_impersonation::ImpersonationCapabilityRegistry::generate(
                "nonce-live".to_owned(),
                &crate::auth::crypto::OsRandom,
            )
            .unwrap();
        operator
            .publish_with(&canonical_ready, |path, bytes| {
                crate::secure_file::write_owner_only(path, bytes)
            })
            .unwrap();
        let expected = std::fs::read_to_string(&sidecar).unwrap();

        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let mut requests = Vec::new();
            for index in 0..2 {
                let (mut stream, _) = listener.accept().unwrap();
                let request = read_http_request(&mut stream);
                let body = if index == 0 {
                    health_with_nonce("nonce-live")
                } else {
                    json!({"ok": true})
                };
                write_http_json(&mut stream, &body);
                requests.push(request);
            }
            requests
        });

        let mut descriptor = stop_descriptor(Some("nonce-live"));
        descriptor.server_url = format!("http://{address}");
        descriptor.target.server_url = Some(descriptor.server_url.clone());
        descriptor.impersonation_capability_file = Some(sidecar.display().to_string());
        crate::secure_file::write_owner_only(&ready, &serde_json::to_vec(&descriptor).unwrap())
            .unwrap();
        let target = TargetArgs {
            url: None,
            ready_file: Some(ready),
            token: None,
        };
        super::post_host_op(
            &target,
            json!({"operation": "auth.mintSession", "args": {}}),
        )
        .unwrap();
        let requests = server.join().unwrap();
        assert!(requests[0].starts_with("GET /health "));
        assert!(requests[1].starts_with("POST /_snapback/api/host-ops "));
        assert!(requests[1].lines().any(|line| {
            let Some((name, value)) = line.split_once(':') else {
                return false;
            };
            name.eq_ignore_ascii_case(crate::admin_impersonation::IMPERSONATION_CAPABILITY_HEADER)
                && value.trim() == expected
        }));
    }

    #[test]
    fn remote_url_impersonation_request_never_selects_a_local_sidecar() {
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let request = read_http_request(&mut stream);
            write_http_json(&mut stream, &json!({"ok": false}));
            request
        });
        let target = TargetArgs {
            url: Some(format!("http://{address}")),
            ready_file: None,
            token: None,
        };
        super::post_host_op(
            &target,
            json!({"operation": "auth.mintSession", "args": {}}),
        )
        .unwrap();
        let request = server.join().unwrap();
        assert!(request.starts_with("POST /_snapback/api/host-ops "));
        assert!(
            !request
                .to_ascii_lowercase()
                .contains(crate::admin_impersonation::IMPERSONATION_CAPABILITY_HEADER)
        );
    }

    #[test]
    fn adversarial_remote_server_cannot_make_cli_transmit_a_local_file() {
        const CHILD_ENV: &str = "SNAPBACK_TEST_REMOTE_TOKEN_EXFIL_CHILD";
        if std::env::var_os(CHILD_ENV).is_none() {
            // The ambient token is process-global. Isolate this network-boundary
            // regression so it proves the no-explicit-token path even when a
            // developer running the suite has SNAPBACK_ADMIN_TOKEN configured.
            let output = std::process::Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "cli::tests::adversarial_remote_server_cannot_make_cli_transmit_a_local_file",
                    "--nocapture",
                ])
                .env(CHILD_ENV, "1")
                .env_remove("SNAPBACK_ADMIN_TOKEN")
                .output()
                .expect("run isolated remote-token exfiltration test");
            assert!(
                output.status.success(),
                "remote-token exfiltration child failed\nstdout:\n{}\nstderr:\n{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            return;
        }

        use std::io::{Read as _, Write as _};
        use std::net::TcpListener as StdTcpListener;
        use std::time::Duration;

        fn read_request(stream: &mut std::net::TcpStream) -> String {
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut bytes = Vec::new();
            let mut chunk = [0_u8; 4096];
            loop {
                let count = stream.read(&mut chunk).expect("read attacker request");
                if count == 0 {
                    break;
                }
                bytes.extend_from_slice(&chunk[..count]);
                let Some(header_end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") else {
                    assert!(
                        bytes.len() < 64 * 1024,
                        "request headers are unexpectedly large"
                    );
                    continue;
                };
                let header_len = header_end + 4;
                let headers = String::from_utf8_lossy(&bytes[..header_len]);
                let content_len = headers
                    .lines()
                    .find_map(|line| {
                        let (name, value) = line.split_once(':')?;
                        name.eq_ignore_ascii_case("content-length")
                            .then(|| value.trim().parse::<usize>().ok())
                            .flatten()
                    })
                    .unwrap_or(0);
                if bytes.len() >= header_len + content_len {
                    break;
                }
            }
            String::from_utf8_lossy(&bytes).into_owned()
        }

        let dir = tempfile::tempdir().unwrap();
        let chosen_path = dir.path().join("chosen-local-file");
        let chosen_contents = "chosen-local-file-contents-must-not-cross-network";
        std::fs::write(&chosen_path, chosen_contents).unwrap();

        let listener = StdTcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let malicious_path = chosen_path.display().to_string();
        let attacker = std::thread::spawn(move || {
            let mut requests = Vec::new();
            for _ in 0..2 {
                let (mut stream, _) = listener.accept().expect("accept CLI request");
                let request = read_request(&mut stream);
                let offered_path = request.starts_with("GET /_snapback/api/inspect ");
                let body = if offered_path {
                    serde_json::json!({"admin": {"tokenFile": malicious_path}}).to_string()
                } else {
                    serde_json::json!({"ok": true}).to_string()
                };
                write!(
                    stream,
                    "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                    body.len(),
                    body
                )
                .expect("answer CLI request");
                requests.push(request);
                if !offered_path {
                    break;
                }
            }
            requests
        });

        let target = TargetArgs {
            url: Some(format!("http://{address}")),
            ready_file: None,
            token: None,
        };
        let envelope = super::post_host_op(&target, json!({"operation": "app.inspect"}))
            .expect("host operation reaches adversarial server");
        assert_eq!(envelope["ok"], json!(true));

        let requests = attacker.join().expect("attacker server joins");
        assert_eq!(
            requests.len(),
            1,
            "a remote URL must be contacted only for the requested host operation"
        );
        assert!(requests[0].starts_with("POST /_snapback/api/host-ops "));
        assert!(
            !requests
                .iter()
                .any(|request| request.contains(chosen_contents)),
            "the attacker-chosen local file contents crossed the network"
        );
    }

    #[test]
    fn mixed_url_and_ready_file_never_sends_the_local_ready_token() {
        let dir = tempfile::tempdir().unwrap();
        let ready = dir.path().join("ready.json");
        let sibling = crate::admin::admin_token_sibling(&ready);
        std::fs::write(&sibling, b"sbat_local_only\n").unwrap();
        let mut descriptor = stop_descriptor(Some("nonce"));
        descriptor.admin_token_file = Some(sibling.display().to_string());
        std::fs::write(&ready, serde_json::to_vec(&descriptor).unwrap()).unwrap();

        let mixed = TargetArgs {
            url: Some("http://attacker.invalid".to_owned()),
            ready_file: Some(ready),
            token: None,
        };
        assert_eq!(
            resolve_http_target(&mixed)
                .expect("explicit URL wins in directly-constructed args")
                .minted_token,
            None
        );

        let parse = Cli::try_parse_from([
            "snapback",
            "inspect",
            "--url",
            "http://attacker.invalid",
            "--ready-file",
            "ready.json",
        ]);
        assert!(
            parse.is_err(),
            "the CLI must reject ambiguous mixed targets"
        );
    }

    #[test]
    fn ready_file_token_discovery_accepts_only_its_owner_only_sibling() {
        let dir = tempfile::tempdir().unwrap();
        let ready = dir.path().join("ready.json");
        let canonical_ready = std::fs::canonicalize(dir.path())
            .unwrap()
            .join("ready.json");
        let sibling = crate::admin::admin_token_sibling(&canonical_ready);
        let arbitrary = dir.path().join("arbitrary-secret");
        std::fs::write(&sibling, b"sbat_expected\n").unwrap();
        std::fs::write(&arbitrary, b"sbat_attacker_chosen\n").unwrap();

        let target = TargetArgs {
            url: None,
            ready_file: Some(ready.clone()),
            token: None,
        };
        let mut descriptor = stop_descriptor(Some("nonce"));
        descriptor.admin_token_file = Some(arbitrary.display().to_string());
        std::fs::write(&ready, serde_json::to_vec(&descriptor).unwrap()).unwrap();
        assert_eq!(resolve_http_target(&target).unwrap().minted_token, None);

        descriptor.admin_token_file = Some(sibling.display().to_string());
        std::fs::write(&ready, serde_json::to_vec(&descriptor).unwrap()).unwrap();
        assert_eq!(
            resolve_http_target(&target)
                .unwrap()
                .minted_token
                .as_deref(),
            Some("sbat_expected")
        );
    }

    #[test]
    fn ready_descriptor_swap_cannot_mix_an_attacker_url_with_a_trusted_token() {
        let dir = tempfile::tempdir().unwrap();
        let ready = dir.path().join("ready.json");
        let sibling = crate::admin::admin_token_sibling(&ready);
        std::fs::write(&sibling, b"sbat_must_not_be_exfiltrated\n").unwrap();

        let target = TargetArgs {
            url: None,
            ready_file: Some(ready.clone()),
            token: None,
        };
        let mut attacker = stop_descriptor(Some("attacker"));
        attacker.server_url = "http://attacker.invalid".to_owned();
        attacker.target.server_url = Some(attacker.server_url.clone());
        attacker.admin_token_file = None;
        std::fs::write(&ready, serde_json::to_vec(&attacker).unwrap()).unwrap();

        // Resolve the complete request authority from the attacker snapshot.
        // Swapping in a trusted descriptor afterwards must not trigger a
        // second descriptor read that adds its local capability to that URL.
        let resolved = resolve_http_target(&target).unwrap();
        let mut trusted = stop_descriptor(Some("trusted"));
        trusted.admin_token_file = Some(sibling.display().to_string());
        std::fs::write(&ready, serde_json::to_vec(&trusted).unwrap()).unwrap();

        assert_eq!(resolved.server_url, "http://attacker.invalid");
        assert_eq!(
            resolved.minted_token, None,
            "a later trusted descriptor must not donate its token to the already-resolved attacker URL"
        );
    }

    #[tokio::test]
    async fn automatic_port_selection_skips_busy_candidates() {
        let busy = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let busy_port = busy.local_addr().unwrap().port();

        let listener = bind_first_available("127.0.0.1", [busy_port, 0])
            .await
            .unwrap();

        assert_ne!(listener.local_addr().unwrap().port(), busy_port);
    }

    #[tokio::test]
    async fn explicit_port_zero_uses_os_assigned_port() {
        let listener = bind_listener("127.0.0.1", Some(0)).await.unwrap();

        assert_ne!(listener.local_addr().unwrap().port(), 0);
    }

    #[test]
    fn database_path_is_absolute_after_parent_creation() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db_path = dir.path().join("nested").join("snapback.db");

        let resolved = prepare_database_path(&db_path).unwrap();

        assert!(resolved.is_absolute());
        assert_eq!(resolved.file_name().unwrap(), "snapback.db");
        assert!(db_path.parent().unwrap().exists());
    }

    #[cfg(unix)]
    #[test]
    fn existing_database_symlink_resolves_to_target() {
        let dir = tempfile::tempdir().expect("tempdir");
        let real_db = dir.path().join("real.sqlite3");
        let link_db = dir.path().join("link.sqlite3");
        std::fs::write(&real_db, b"").expect("write db placeholder");
        std::os::unix::fs::symlink(&real_db, &link_db).expect("symlink db");

        let resolved = super::resolve_database_path(&link_db).unwrap();

        assert_eq!(resolved, std::fs::canonicalize(&real_db).unwrap());
    }
}
