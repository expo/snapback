use crate::admin::{AppState, ServerContext};
use crate::host_ops::{HOST_OPS_RESULT_KIND, HostOpsArtifacts, HostOpsResult, HostReadyDescriptor};
use crate::instance_lock::DatabaseInstanceLock;
use crate::local::LocalSnapback;
use crate::manifest::SNAPBACK_SCHEMA_VERSION;
use crate::server;
use anyhow::Context;
use clap::Parser;
use serde_json::{Value, json};
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::Arc;
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
}

impl Default for Args {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".to_owned(),
            port: None,
            db: PathBuf::from(".snapback/dev.sqlite3"),
            memory: false,
            ready_file: None,
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

#[derive(Debug, clap::Subcommand)]
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
}

#[derive(Debug, clap::Args)]
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
    }
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
    let raw = String::from_utf8(raw)
        .with_context(|| format!("{} is not valid UTF-8", path.display()))?;
    serde_json::from_str(&raw).with_context(|| format!("{} is not valid JSON", path.display()))
}

fn resolve_target_url(target: &TargetArgs) -> anyhow::Result<String> {
    if let Some(url) = &target.url {
        return Ok(url.trim_end_matches('/').to_owned());
    }
    if let Some(path) = &target.ready_file {
        let value = read_trusted_json_file(path)?;
        let descriptor = HostReadyDescriptor::validate(&value).map_err(|problems| {
            anyhow::anyhow!(
                "{} is not a valid readiness descriptor: {}",
                path.display(),
                problems.join("; ")
            )
        })?;
        return Ok(descriptor.server_url.trim_end_matches('/').to_owned());
    }
    anyhow::bail!("no target: pass --url or --ready-file")
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
    let url = resolve_target_url(target)?;
    let token = target
        .token
        .clone()
        .or_else(|| std::env::var("SNAPBACK_ADMIN_TOKEN").ok())
        .filter(|token| !token.is_empty())
        .or_else(|| discover_minted_token(target));
    let mut http = ureq::post(&format!("{url}/_snapback/api/host-ops"));
    if let Some(token) = token.filter(|token| !token.is_empty()) {
        http = http.set("x-snapback-admin-token", &token);
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
fn discover_minted_token(target: &TargetArgs) -> Option<String> {
    if target.url.is_some() {
        return None;
    }
    let ready_file = target.ready_file.as_ref()?;
    let descriptor =
        HostReadyDescriptor::validate(&read_trusted_json_file(ready_file).ok()?).ok()?;
    let declared = PathBuf::from(descriptor.admin_token_file?);
    let expected = crate::admin::admin_token_sibling(ready_file);
    if declared != expected {
        return None;
    }
    let token = String::from_utf8(crate::secure_file::read_owner_only(&declared).ok()?).ok()?;
    let token = token.trim();
    (!token.is_empty()).then(|| token.to_owned())
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
    let details = |reason: &str| {
        json!({
            "operation": "host.stop",
            "pid": descriptor.pid,
            "serverUrl": descriptor.server_url,
            "reason": reason,
        })
    };
    let Some(expected_nonce) = descriptor.startup_nonce.as_deref() else {
        return Err(crate::diagnostic::Diagnostic::error(
            "SNAPBACK_HOST_STOP_UNVERIFIABLE",
            "host-ops",
            "the readiness descriptor has no startupNonce (written by an older snapback), so the \
             pid cannot be verified as the server; stop the process manually and remove the \
             ready file",
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
                     stale and pid {} may belong to an unrelated process — nothing was \
                     signaled; remove the ready file if the server is gone",
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
             wrote the descriptor (startupNonce mismatch); nothing was signaled — remove the \
             stale ready file and target the live server's own ready file",
        )
        .with_details(details("startupNonce mismatch"))),
        None => Err(crate::diagnostic::Diagnostic::error(
            "SNAPBACK_HOST_STOP_UNVERIFIABLE",
            "host-ops",
            "the process answering the descriptor's URL does not report a Snapback identity \
             (/health has no binary.startupNonce); nothing was signaled",
        )
        .with_details(details("no binary.startupNonce on /health"))),
    }
}

pub async fn run(args: Args) -> anyhow::Result<()> {
    let mut database_lock = None;
    let mut database_path = None;
    let snapback = if args.memory {
        LocalSnapback::memory()?
    } else {
        let db_path = prepare_database_path(&args.db)?;
        // @ref LLP 0003#decision — one local server process owns the SQLite
        // database and process-local runtime state for this app instance.
        let lock = DatabaseInstanceLock::acquire(&db_path)?;
        let snapback = LocalSnapback::open(&db_path)?;
        database_path = Some(db_path);
        database_lock = Some(lock);
        snapback
    };

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
            .or(args.ready_file.as_deref())
            .map(crate::admin::admin_token_sibling);
        let resolved = crate::admin::resolve_serve_admin_token(None, token_file)?;
        server_context.install_minted_token(&resolved);
        minted_token = Some(resolved);
    }
    let token_configured = server_context.admin_token.is_some();
    let ready_sibling_token_file = if database_path.is_none() {
        server_context.admin_token_file.clone()
    } else {
        None
    };
    let admin_token_file_display = server_context
        .admin_token_file
        .as_ref()
        .map(|path| path.display().to_string());
    let cron_scheduler = server::spawn_cron_scheduler(state.clone());
    let maintenance_worker = server::spawn_maintenance_worker(state.clone(), ephemeral.clone());
    let app = server::app(AppState::new(state, read_lane, ephemeral, server_context));
    if let Some(lock) = database_lock.as_mut() {
        lock.record_server(&local_addr.ip().to_string(), local_addr.port())?;
    }

    // @ref LLP 0030#readiness-and-port-discovery — the readiness file is
    // the structured handshake: out-of-band so launcher stdout (cargo build
    // noise) cannot corrupt it; aligned with the LLP 0024 target shape.
    if let Some(path) = args.ready_file.as_ref() {
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
            startup_nonce: Some(crate::identity::binary_identity().startup_nonce),
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
            diagnostics: Vec::new(),
        };
        write_ready_file_atomic(
            path,
            &format!("{}\n", serde_json::to_string_pretty(&descriptor)?),
        )
        .with_context(|| format!("failed to write ready file {}", path.display()))?;
        println!("ready file: {}", path.display());
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
        println!(
            "admin: writes require the minted local admin token (SNAPBACK_ADMIN_TOKEN unset)"
        );
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
    if let Some(path) = args.ready_file.as_ref() {
        let _ = std::fs::remove_file(path);
    }
    // An in-memory instance's minted token dies with the process; remove the
    // ready-file-sibling token file it was handed off through (ENG-23443).
    // File-backed instances keep their token file across restarts.
    if let Some(path) = ready_sibling_token_file.as_ref() {
        let _ = std::fs::remove_file(path);
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

fn write_ready_file_atomic(path: &Path, content: &str) -> anyhow::Result<()> {
    if let Some(parent) = path.parent()
        && !parent.as_os_str().is_empty()
    {
        std::fs::create_dir_all(parent).with_context(|| {
            format!("failed to create ready-file directory {}", parent.display())
        })?;
    }
    let file_name = path
        .file_name()
        .context("ready file path must include a file name")?
        .to_string_lossy();
    let tmp_name = format!(".{file_name}.tmp-{}", Uuid::now_v7().simple());
    let tmp_path = path.with_file_name(tmp_name);
    let write_result = (|| -> anyhow::Result<()> {
        std::fs::write(&tmp_path, content).with_context(|| {
            format!(
                "failed to write temporary ready file {}",
                tmp_path.display()
            )
        })?;
        std::fs::rename(&tmp_path, path).with_context(|| {
            format!(
                "failed to atomically publish ready file {} from {}",
                path.display(),
                tmp_path.display()
            )
        })?;
        Ok(())
    })();
    if write_result.is_err() {
        let _ = std::fs::remove_file(&tmp_path);
    }
    write_result
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
        Args, Cli, HostCommand, bind_first_available, bind_listener, parse_run_args,
        prepare_database_path, reject_misdirected_serve_flags, write_ready_file_atomic,
        TargetArgs,
    };
    use clap::Parser;
    use serde_json::json;
    use std::path::PathBuf;
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
            diagnostics: Vec::new(),
        }
    }

    fn health_with_nonce(nonce: &str) -> serde_json::Value {
        json!({ "ok": true, "binary": { "startupNonce": nonce } })
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
    fn run_args_must_be_json_object() {
        assert!(parse_run_args(Some(r#"{"title":"hello"}"#.to_owned())).is_ok());

        let error = parse_run_args(Some(r#"["hello"]"#.to_owned())).unwrap_err();
        assert!(error.to_string().contains("--args must be a JSON object"));
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

        assert_eq!(
            super::discover_minted_token(&target),
            None,
            "a network target has no local path-discovery channel"
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
        assert_eq!(super::discover_minted_token(&mixed), None);

        let parse = Cli::try_parse_from([
            "snapback",
            "inspect",
            "--url",
            "http://attacker.invalid",
            "--ready-file",
            "ready.json",
        ]);
        assert!(parse.is_err(), "the CLI must reject ambiguous mixed targets");
    }

    #[test]
    fn ready_file_token_discovery_accepts_only_its_owner_only_sibling() {
        let dir = tempfile::tempdir().unwrap();
        let ready = dir.path().join("ready.json");
        let sibling = crate::admin::admin_token_sibling(&ready);
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
        assert_eq!(super::discover_minted_token(&target), None);

        descriptor.admin_token_file = Some(sibling.display().to_string());
        std::fs::write(&ready, serde_json::to_vec(&descriptor).unwrap()).unwrap();
        assert_eq!(
            super::discover_minted_token(&target).as_deref(),
            Some("sbat_expected")
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
