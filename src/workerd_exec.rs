//! The workerd-hosted V8 handler executor (LLP 0048).
//!
//! This is the DK-5 conformance twin's engine leg and the LLP 0040 harness
//! proven locally before any deploy: the same single-sourced handler harness
//! (`packages/snapback-harness/`) hosted in a local workerd process, speaking
//! the async host-call protocol over a private loopback transport. Only the
//! handler executor is swapped — storage, the host-op table
//! (`IbexHostContext::handle_host_call` via `dispatch_host_call`), generated
//! artifacts, and diagnostics are shared with the Ibex leg, so any behavioral
//! difference is a protocol-adapter bug or an engine fact, attributable on
//! sight.
//!
//! Kill domain: **one invocation** (LLP 0047 via LLP 0048 §Limits testbed).
//! Each invocation gets its own workerd process; wall-clock enforcement is
//! process termination, so a busy-loop kill cannot take an unrelated
//! invocation with it, and a killed mutation commits nothing because its
//! buffered writes die with the errored invocation.

use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::manifest::IbexModule;
use crate::runtime::{
    IbexHostContext, dispatch_host_call, parse_handler_output, unhandled_rejection_error,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::cell::Cell;
use std::env;
use std::fs::File;
#[cfg(unix)]
use std::fs::{DirBuilder, OpenOptions};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

#[cfg(unix)]
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};

/// Handler-execution backend selection (LLP 0048): Ibex is canonical and the
/// default (LLP 0002 does not reopen); the workerd twin is opt-in per run via
/// `SNAPBACK_HANDLER_BACKEND=workerd-v8` or per thread via
/// [`with_forced_backend`] (the conformance runner's seam).
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum HandlerBackend {
    Ibex,
    WorkerdV8,
}

impl HandlerBackend {
    pub fn as_str(self) -> &'static str {
        match self {
            HandlerBackend::Ibex => "ibex",
            HandlerBackend::WorkerdV8 => "workerd-v8",
        }
    }
}

thread_local! {
    static FORCED_BACKEND: Cell<Option<HandlerBackend>> = const { Cell::new(None) };
}

/// Run `f` with the handler backend forced on this thread — the conformance
/// twin's per-case selector, safe under parallel tests because handler
/// execution is synchronous on the calling thread.
pub fn with_forced_backend<T>(backend: HandlerBackend, f: impl FnOnce() -> T) -> T {
    let previous = FORCED_BACKEND.with(|slot| slot.replace(Some(backend)));
    let result = f();
    FORCED_BACKEND.with(|slot| slot.set(previous));
    result
}

pub(crate) fn selected_backend() -> HandlerBackend {
    if let Some(forced) = FORCED_BACKEND.with(|slot| slot.get()) {
        return forced;
    }
    match env::var("SNAPBACK_HANDLER_BACKEND").ok().as_deref() {
        Some("workerd-v8") => HandlerBackend::WorkerdV8,
        _ => HandlerBackend::Ibex,
    }
}

/// Default per-invocation wall-clock budget on the workerd leg. Generous for
/// a handler (host calls included), small enough that a busy loop dies fast
/// in CI. Overridable via `SNAPBACK_V8_WALL_CLOCK_TIMEOUT_MS`.
const DEFAULT_WALL_CLOCK_TIMEOUT_MS: u64 = 10_000;

thread_local! {
    static WALL_CLOCK_OVERRIDE_MS: Cell<Option<u64>> = const { Cell::new(None) };
    static INVOKE_AUTH_TEST_MODE: Cell<Option<InvokeAuthTestMode>> = const { Cell::new(None) };
}

/// Adversarial test seam for the local workerd `/invoke` capability.
#[doc(hidden)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InvokeAuthTestMode {
    Missing,
    Wrong,
}

#[doc(hidden)]
pub fn with_invoke_auth_test_mode<T>(mode: InvokeAuthTestMode, f: impl FnOnce() -> T) -> T {
    let previous = INVOKE_AUTH_TEST_MODE.with(|slot| slot.replace(Some(mode)));
    let result = f();
    INVOKE_AUTH_TEST_MODE.with(|slot| slot.set(previous));
    result
}

/// Run `f` with the workerd wall-clock budget forced on this thread — the
/// deterministic seam the LLP 0047 busy-loop kill tests use (env mutation
/// would race across parallel test threads).
pub fn with_wall_clock_timeout_ms<T>(timeout_ms: u64, f: impl FnOnce() -> T) -> T {
    let previous = WALL_CLOCK_OVERRIDE_MS.with(|slot| slot.replace(Some(timeout_ms)));
    let result = f();
    WALL_CLOCK_OVERRIDE_MS.with(|slot| slot.set(previous));
    result
}

/// The effective default budget, surfaced for capability reporting (DK-5's
/// computed-not-asserted rule: the manifest reports the value the runner
/// actually enforces).
pub fn default_wall_clock_timeout_ms() -> u64 {
    wall_clock_timeout_ms()
}

pub(crate) fn wall_clock_timeout_ms() -> u64 {
    if let Some(forced) = WALL_CLOCK_OVERRIDE_MS.with(|slot| slot.get()) {
        return forced;
    }
    env::var("SNAPBACK_V8_WALL_CLOCK_TIMEOUT_MS")
        .ok()
        .and_then(|raw| raw.parse().ok())
        .unwrap_or(DEFAULT_WALL_CLOCK_TIMEOUT_MS)
}

// ---------------------------------------------------------------------------
// workerd discovery and single-sourced runtime config

/// Locate the workerd binary: explicit env override, the repo's npm dev
/// dependency, or PATH. Absence is a capability fact, not an error
/// (LLP 0048 §Distribution posture) — callers surface
/// `SNAPBACK_CAPABILITY_WORKERD_MISSING`.
pub fn detect_workerd_binary() -> Option<PathBuf> {
    if let Ok(explicit) = env::var("SNAPBACK_WORKERD_BIN") {
        let path = PathBuf::from(explicit);
        if path.is_file() {
            return Some(path);
        }
        return None;
    }
    let repo_local = Path::new(env!("CARGO_MANIFEST_DIR")).join("node_modules/.bin/workerd");
    if repo_local.is_file() {
        return Some(repo_local);
    }
    let cwd_local = Path::new("node_modules/.bin/workerd");
    if cwd_local.is_file() {
        return Some(cwd_local.to_path_buf());
    }
    let path_var = env::var_os("PATH")?;
    env::split_paths(&path_var)
        .map(|dir| dir.join("workerd"))
        .find(|candidate| candidate.is_file())
}

pub fn workerd_missing_error() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_CAPABILITY_WORKERD_MISSING",
        "runtime",
        "the workerd-v8 handler backend needs the workerd binary (npm dev dependency); \
         run `bun install --frozen-lockfile` at the repo root or set SNAPBACK_WORKERD_BIN",
    )
}

/// `workerd --version` output, e.g. `workerd 2026-07-07` — recorded in the
/// twin's capability manifest so \"same runtime code as Workers\" is a stated
/// fact, not a trust claim (LLP 0048 §Single-sourced runtime flags).
pub fn workerd_version(bin: &Path) -> Option<String> {
    let output = Command::new(bin).arg("--version").output().ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

#[derive(Clone, Debug, Deserialize)]
pub struct CompatConfig {
    #[serde(rename = "compatibilityDate")]
    pub compatibility_date: String,
    #[serde(rename = "compatibilityFlags", default)]
    pub compatibility_flags: Vec<String>,
}

/// The single-sourced Workers compatibility config. Both the twin's workerd
/// config and LLP 0040's wrangler config are generated from this file; a
/// nodejs_compat* flag is refused fail-closed on every generator — Node
/// compatibility surface would silently re-widen the handler-visible dialect.
pub fn compat_config() -> SnapbackResult<CompatConfig> {
    let raw = include_str!("../packages/snapback-harness/compat.json");
    let config: CompatConfig = serde_json::from_str(raw).map_err(|error| {
        SnapbackError::error(
            "SNAPBACK_V8_COMPAT_CONFIG_INVALID",
            "runtime",
            "packages/snapback-harness/compat.json is not a valid compat config",
        )
        .with_details(json!({ "error": error.to_string() }))
    })?;
    refuse_node_compat(&config)?;
    Ok(config)
}

pub fn refuse_node_compat(config: &CompatConfig) -> SnapbackResult<()> {
    if let Some(flag) = config
        .compatibility_flags
        .iter()
        .find(|flag| flag.starts_with("nodejs_compat"))
    {
        return Err(SnapbackError::error(
            "SNAPBACK_V8_COMPAT_FLAG_REFUSED",
            "runtime",
            "nodejs_compat* flags are refused: the handler-visible dialect is the Workers \
             platform surface minus the allowlist, never the Node surface",
        )
        .with_details(json!({ "flag": flag })));
    }
    Ok(())
}

/// Render the per-invocation workerd config. The harness modules are the
/// single-sourced files from packages/snapback-harness; the only generated
/// parts are the two loopback addresses and the compat pins. There is no
/// `internet` service: the HOST binding is the isolate's only egress.
fn render_workerd_config(
    compat: &CompatConfig,
    host_port: u16,
    worker_port: u16,
    invoke_token: &str,
) -> String {
    let flags = compat
        .compatibility_flags
        .iter()
        .map(|flag| format!("\"{flag}\""))
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        r#"using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [
    (name = "main", worker = .mainWorker),
    (name = "snapbackHost", external = (address = "127.0.0.1:{host_port}", http = ())),
  ],
  sockets = [
    (name = "http", address = "127.0.0.1:{worker_port}", http = (), service = "main"),
  ],
);

const mainWorker :Workerd.Worker = (
  modules = [
    (name = "entry.mjs", esModule = embed "entry.mjs"),
    (name = "handler-server.mjs", esModule = embed "handler-server.mjs"),
    (name = "strip.mjs", esModule = embed "strip.mjs"),
    (name = "rejection-ledger.mjs", esModule = embed "rejection-ledger.mjs"),
    (name = "allowlist-install.js", esModule = embed "allowlist-install.js"),
    (name = "ctx-bootstrap.js", esModule = embed "ctx-bootstrap.js"),
    (name = "handler.mjs", esModule = embed "handler.mjs"),
    (name = "allowlist.mjs", esModule = embed "allowlist.mjs"),
  ],
  compatibilityDate = "{date}",
  compatibilityFlags = [{flags}],
  bindings = [
    (name = "HOST", service = "snapbackHost"),
    (name = "SNAPBACK_INVOKE_TOKEN", text = "{invoke_token}"),
  ],
);
"#,
        date = compat.compatibility_date,
    )
}

pub(crate) const HARNESS_ENTRY_SOURCE: &str =
    include_str!("../packages/snapback-harness/workerd/entry.mjs");
pub(crate) const HARNESS_SERVER_SOURCE: &str =
    include_str!("../packages/snapback-harness/workerd/handler-server.mjs");
pub(crate) const HARNESS_STRIP_SOURCE: &str =
    include_str!("../packages/snapback-harness/workerd/strip.mjs");
pub(crate) const HARNESS_REJECTION_LEDGER_SOURCE: &str =
    include_str!("../packages/snapback-harness/workerd/rejection-ledger.mjs");
pub(crate) const HARNESS_ALLOWLIST_INSTALL_SOURCE: &str =
    include_str!("../packages/snapback-harness/allowlist-install.js");
pub(crate) const HARNESS_CTX_BOOTSTRAP_SOURCE: &str =
    include_str!("../packages/snapback-harness/ctx-bootstrap.js");
pub(crate) const HARNESS_ALLOWLIST_JSON: &str =
    include_str!("../packages/snapback-harness/allowlist.json");

fn allowlist_module_source() -> String {
    format!("export default {};", HARNESS_ALLOWLIST_JSON.trim_end())
}

// ---------------------------------------------------------------------------
// per-invocation runner

struct ChildGuard(Child);

impl Drop for ChildGuard {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

struct TempDirGuard(PathBuf);

impl Drop for TempDirGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[cfg(unix)]
fn create_private_invocation_dir() -> SnapbackResult<PathBuf> {
    for _ in 0..16 {
        let path = env::temp_dir().join(format!("snapback-workerd-{}", uuid::Uuid::new_v4()));
        let mut builder = DirBuilder::new();
        #[cfg(unix)]
        builder.mode(0o700);
        match builder.create(&path) {
            Ok(()) => return Ok(path),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(runner_error(
                    "SNAPBACK_V8_RUNNER_START_FAILED",
                    "could not atomically create the private workerd invocation directory",
                    json!({ "error": error.to_string(), "operation": "createInvocationDirectory" }),
                ));
            }
        }
    }
    Err(runner_error(
        "SNAPBACK_V8_RUNNER_START_FAILED",
        "could not allocate a unique workerd invocation directory",
        json!({}),
    ))
}

#[cfg(not(unix))]
fn create_private_invocation_dir() -> SnapbackResult<PathBuf> {
    Err(runner_error(
        "SNAPBACK_V8_RUNNER_HOST_UNSUPPORTED",
        "owner-only workerd invocation directories are not implemented on this host; refusing to materialize handler code",
        json!({}),
    ))
}

#[cfg(unix)]
fn create_private_file(path: &Path, role: &str, contents: &[u8]) -> SnapbackResult<File> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    options.mode(0o600);
    let mut file = options.open(path).map_err(|error| {
        runner_error(
            "SNAPBACK_V8_RUNNER_START_FAILED",
            "could not exclusively create a private workerd invocation file",
            json!({ "error": error.to_string(), "fileRole": role, "operation": "create" }),
        )
    })?;
    file.write_all(contents).map_err(|error| {
        runner_error(
            "SNAPBACK_V8_RUNNER_START_FAILED",
            "could not write a private workerd invocation file",
            json!({ "error": error.to_string(), "fileRole": role, "operation": "write" }),
        )
    })?;
    file.flush().map_err(|error| {
        runner_error(
            "SNAPBACK_V8_RUNNER_START_FAILED",
            "could not flush a private workerd invocation file",
            json!({ "error": error.to_string(), "fileRole": role, "operation": "flush" }),
        )
    })?;
    Ok(file)
}

#[cfg(not(unix))]
fn create_private_file(_path: &Path, _role: &str, _contents: &[u8]) -> SnapbackResult<File> {
    Err(runner_error(
        "SNAPBACK_V8_RUNNER_HOST_UNSUPPORTED",
        "owner-only workerd invocation files are not implemented on this host; refusing to materialize handler code",
        json!({}),
    ))
}

fn runner_error(code: &str, message: impl Into<String>, details: Value) -> SnapbackError {
    SnapbackError::error(code, "runtime", message.into()).with_details(details)
}

#[derive(Debug, Deserialize)]
struct InvokeResponse {
    envelope: Option<String>,
    #[serde(default, rename = "didNotSettle")]
    did_not_settle: bool,
    #[serde(default, rename = "unhandledRejections")]
    unhandled_rejections: Vec<String>,
    #[serde(default, rename = "rejectionDetectionSupported")]
    rejection_detection_supported: bool,
    #[serde(default)]
    fatal: Option<String>,
}

/// Execute one query/mutation handler invocation in a fresh workerd process.
///
/// The calling thread serves the invocation's host calls (each one dispatched
/// into the shared `IbexHostContext` op table); a helper thread carries the
/// blocking invoke request. On wall-clock expiry the process is killed —
/// nothing commits, because the buffered writes belong to the errored
/// invocation.
pub(crate) fn run_handler_workerd(
    module: &IbexModule,
    invocation: &mut IbexHostContext<'_>,
) -> SnapbackResult<Value> {
    crate::exec_guard::debug_assert_off_async_worker("workerd_invocation");
    let workerd = detect_workerd_binary().ok_or_else(workerd_missing_error)?;
    let compat = compat_config()?;
    let timeout_ms = wall_clock_timeout_ms();
    let deadline = Instant::now() + Duration::from_millis(timeout_ms);

    // Private loopback transport: the host listener the isolate calls back
    // into (via its HOST service binding), and a per-invocation bearer token.
    let host_listener = TcpListener::bind("127.0.0.1:0").map_err(|error| {
        runner_error(
            "SNAPBACK_V8_RUNNER_START_FAILED",
            "could not bind the host-call listener",
            json!({ "error": error.to_string() }),
        )
    })?;
    let host_port = host_listener
        .local_addr()
        .map_err(|error| {
            runner_error(
                "SNAPBACK_V8_RUNNER_START_FAILED",
                "could not read the host-call listener address",
                json!({ "error": error.to_string() }),
            )
        })?
        .port();
    let worker_probe = TcpListener::bind("127.0.0.1:0").map_err(|error| {
        runner_error(
            "SNAPBACK_V8_RUNNER_START_FAILED",
            "could not reserve a workerd socket port",
            json!({ "error": error.to_string() }),
        )
    })?;
    let worker_port = worker_probe
        .local_addr()
        .map_err(|error| {
            runner_error(
                "SNAPBACK_V8_RUNNER_START_FAILED",
                "could not read the reserved workerd port",
                json!({ "error": error.to_string() }),
            )
        })?
        .port();
    let token = uuid::Uuid::new_v4().to_string();

    // Materialize the single-sourced harness plus this invocation's handler
    // module into a per-invocation directory; the config embeds them by path.
    let dir = create_private_invocation_dir()?;
    let _dir_guard = TempDirGuard(dir.clone());
    let write = |name: &str, contents: &str| -> SnapbackResult<()> {
        create_private_file(&dir.join(name), name, contents.as_bytes()).map(|_| ())
    };
    write("entry.mjs", HARNESS_ENTRY_SOURCE)?;
    write("handler-server.mjs", HARNESS_SERVER_SOURCE)?;
    write("strip.mjs", HARNESS_STRIP_SOURCE)?;
    write("rejection-ledger.mjs", HARNESS_REJECTION_LEDGER_SOURCE)?;
    write("allowlist-install.js", HARNESS_ALLOWLIST_INSTALL_SOURCE)?;
    write("ctx-bootstrap.js", HARNESS_CTX_BOOTSTRAP_SOURCE)?;
    write("allowlist.mjs", &allowlist_module_source())?;
    write("handler.mjs", &module.source)?;
    write(
        "config.capnp",
        &render_workerd_config(&compat, host_port, worker_port, &token),
    )?;

    let stderr_path = dir.join("workerd-stderr.log");
    let stderr_file = create_private_file(&stderr_path, "workerd-stderr.log", &[])?;
    // Keep the reservation until immediately before spawn. workerd itself has
    // to bind the port, but the TOCTOU window is now just the spawn handoff.
    drop(worker_probe);
    let child = Command::new(&workerd)
        .arg("serve")
        .arg(dir.join("config.capnp"))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::from(stderr_file))
        .spawn()
        .map_err(|error| {
            runner_error(
                "SNAPBACK_V8_RUNNER_START_FAILED",
                "could not spawn workerd",
                json!({ "error": error.to_string(), "workerd": workerd.display().to_string() }),
            )
        })?;
    let mut child = ChildGuard(child);

    // Readiness: prove the accepted socket is THIS harness, not merely
    // something listening on the reserved port.
    let worker_addr = format!("127.0.0.1:{worker_port}");
    let readiness_nonce = uuid::Uuid::new_v4().to_string();
    let readiness_url = format!("http://{worker_addr}/__snapback/health?nonce={readiness_nonce}");
    let readiness_agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_millis(300))
        .build();
    loop {
        if Instant::now() >= deadline {
            return Err(startup_failure(&stderr_path, timeout_ms));
        }
        if let Ok(Some(_)) = child.0.try_wait() {
            return Err(startup_failure(&stderr_path, timeout_ms));
        }
        match readiness_agent.get(&readiness_url).call() {
            Ok(response) => {
                let body = response.into_string().unwrap_or_default();
                let parsed: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
                let ok = parsed.get("ok").and_then(Value::as_bool) == Some(true);
                let harness =
                    parsed.get("harness").and_then(Value::as_str) == Some("snapback-workerd-v8");
                let nonce =
                    parsed.get("nonce").and_then(Value::as_str) == Some(readiness_nonce.as_str());
                if ok && harness && nonce {
                    break;
                }
                std::thread::sleep(Duration::from_millis(5));
            }
            Err(_) => std::thread::sleep(Duration::from_millis(5)),
        }
    }

    // The blocking invoke request rides a helper thread; this thread serves
    // host calls until the response (or the deadline) arrives.
    let invoke_body = json!({
        "export": module.export,
        "argsJson": serde_json::to_string(&invocation.input().args).unwrap_or_else(|_| "{}".into()),
        "authJson": serde_json::to_string(&invocation.input().auth).unwrap_or_else(|_| "{}".into()),
        "mode": invocation.mode_str(),
        "runJson": Value::Null,
        "secretsJson": Value::Null,
        "epoch": invocation.epoch().to_string(),
        "settlementTimeoutMs": timeout_ms.saturating_sub(250).max(1),
    })
    .to_string();
    let invoke_url = format!("http://{worker_addr}/invoke");
    let request_timeout = Duration::from_millis(timeout_ms + 2_000);
    let (done_tx, done_rx) = mpsc::channel::<Result<String, String>>();
    let invoke_token = token.clone();
    let invoke_auth_test_mode = INVOKE_AUTH_TEST_MODE.with(|slot| slot.get());
    let invoke_thread = std::thread::spawn(move || {
        let agent = ureq::AgentBuilder::new().timeout(request_timeout).build();
        let mut request = agent
            .post(&invoke_url)
            .set("content-type", "application/json");
        match invoke_auth_test_mode {
            None => request = request.set("x-snapback-invoke-token", &invoke_token),
            Some(InvokeAuthTestMode::Wrong) => {
                request = request.set("x-snapback-invoke-token", "wrong-test-token");
            }
            Some(InvokeAuthTestMode::Missing) => {}
        }
        let outcome = request.send_string(&invoke_body);
        let message = match outcome {
            Ok(response) => match response.into_string() {
                Ok(body) => Ok(body),
                Err(error) => Err(format!("invoke response unreadable: {error}")),
            },
            Err(ureq::Error::Status(status, response)) => {
                let body = response.into_string().unwrap_or_default();
                Err(format!("invoke status {status}: {body}"))
            }
            Err(error) => Err(format!("invoke request failed: {error}")),
        };
        let _ = done_tx.send(message);
    });

    host_listener.set_nonblocking(true).map_err(|error| {
        runner_error(
            "SNAPBACK_V8_RUNNER_START_FAILED",
            "could not set the host-call listener nonblocking",
            json!({ "error": error.to_string() }),
        )
    })?;

    let body = loop {
        match done_rx.try_recv() {
            Ok(Ok(body)) => break body,
            Ok(Err(message)) => {
                let _ = invoke_thread.join();
                let stderr = stderr_tail(&stderr_path);
                return Err(runner_error(
                    "SNAPBACK_V8_RUNNER_INVOKE_FAILED",
                    format!("the workerd invocation transport failed: {message}; stderr: {stderr}"),
                    json!({ "error": message, "stderr": stderr }),
                ));
            }
            Err(mpsc::TryRecvError::Empty) => {}
            Err(mpsc::TryRecvError::Disconnected) => {
                return Err(runner_error(
                    "SNAPBACK_V8_RUNNER_INVOKE_FAILED",
                    "the workerd invocation thread disappeared",
                    json!({ "stderr": stderr_tail(&stderr_path) }),
                ));
            }
        }
        if Instant::now() >= deadline {
            // The LLP 0047 kill path: terminate the whole process — the kill
            // domain is exactly this invocation, and its buffered writes die
            // with the error return (a killed mutation commits nothing).
            drop(child);
            let _ = invoke_thread.join();
            return Err(runner_error(
                "SNAPBACK_HANDLER_WALL_CLOCK_EXCEEDED",
                "handler exceeded the wall-clock budget and its runtime process was killed; \
                 nothing was committed",
                json!({
                    "timeoutMs": timeout_ms,
                    "engine": "workerd-v8",
                    "killDomain": "process-per-invocation",
                    "function": module.export,
                }),
            ));
        }
        match host_listener.accept() {
            Ok((stream, _)) => {
                serve_host_call_connection(stream, invocation, &token);
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(2));
            }
            Err(_) => {
                std::thread::sleep(Duration::from_millis(2));
            }
        }
    };
    let _ = invoke_thread.join();
    drop(child);

    let response: InvokeResponse = serde_json::from_str(&body).map_err(|error| {
        runner_error(
            "SNAPBACK_V8_RUNNER_INVOKE_FAILED",
            "the workerd invocation response was not valid JSON",
            json!({ "error": error.to_string(), "body": body }),
        )
    })?;
    if let Some(fatal) = response.fatal {
        return Err(runner_error(
            "SNAPBACK_V8_RUNNER_INVOKE_FAILED",
            "the workerd harness rejected the invocation",
            json!({ "error": fatal }),
        ));
    }
    if response.did_not_settle {
        return Err(SnapbackError::error(
            "SNAPBACK_HANDLER_DID_NOT_SETTLE",
            "runtime",
            "handler promise did not settle before the harness deadline — the invocation \
             produced no result and committed no writes",
        )
        .with_details(json!({
            "function": module.export,
            "engine": "workerd-v8",
            "signal": "structured harness settlement deadline",
        })));
    }
    if !response.unhandled_rejections.is_empty() {
        return Err(unhandled_rejection_error(
            module,
            response.unhandled_rejections,
        ));
    }
    if !response.rejection_detection_supported {
        return Err(runner_error(
            "SNAPBACK_V8_REJECTION_DETECTION_UNAVAILABLE",
            "the workerd harness could not install unhandled-rejection detection; \
             the LLP 0009 conformance floor requires it on every engine",
            json!({ "function": module.export }),
        ));
    }
    let envelope = response.envelope.unwrap_or_default();
    parse_handler_output(module, envelope)
}

fn startup_failure(stderr_path: &Path, timeout_ms: u64) -> SnapbackError {
    runner_error(
        "SNAPBACK_V8_RUNNER_START_FAILED",
        "workerd did not become ready",
        json!({
            "timeoutMs": timeout_ms,
            "stderr": stderr_tail(stderr_path),
        }),
    )
}

fn stderr_tail(path: &Path) -> String {
    std::fs::read_to_string(path)
        .map(|contents| {
            let tail: Vec<&str> = contents.lines().rev().take(20).collect();
            tail.into_iter().rev().collect::<Vec<_>>().join("\n")
        })
        .unwrap_or_default()
}

// ---------------------------------------------------------------------------
// minimal loopback HTTP handling for the host-call channel

const MAX_HOST_CALL_REQUEST_LINE_BYTES: usize = 4 * 1024;
const MAX_HOST_CALL_HEADER_LINE_BYTES: usize = 8 * 1024;
const MAX_HOST_CALL_HEADERS_BYTES: usize = 16 * 1024;
// Above the hosted proof's 4 MB request ceiling so application value limits
// remain authoritative, while still preventing attacker-sized allocation.
const MAX_HOST_CALL_BODY_BYTES: usize = 8 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum HostTransportReadError {
    Malformed,
    Unauthorized,
    HeadersTooLarge,
    BodyTooLarge,
    Io,
}

fn read_bounded_line<R: BufRead>(
    reader: &mut R,
    max_bytes: usize,
) -> Result<Option<Vec<u8>>, HostTransportReadError> {
    let mut line = Vec::new();
    let mut limited = (&mut *reader).take((max_bytes + 1) as u64);
    let read = limited
        .read_until(b'\n', &mut line)
        .map_err(|_| HostTransportReadError::Io)?;
    if read == 0 {
        return Ok(None);
    }
    if read > max_bytes || line.last() != Some(&b'\n') {
        return Err(HostTransportReadError::HeadersTooLarge);
    }
    Ok(Some(line))
}

fn read_host_call_request<R: BufRead>(
    reader: &mut R,
    expected_token: &str,
) -> Result<Vec<u8>, HostTransportReadError> {
    let request_line = read_bounded_line(reader, MAX_HOST_CALL_REQUEST_LINE_BYTES)?
        .ok_or(HostTransportReadError::Malformed)?;
    let request_line = std::str::from_utf8(&request_line)
        .map_err(|_| HostTransportReadError::Malformed)?
        .trim_end_matches(['\r', '\n']);
    if request_line != "POST /host-call HTTP/1.1" {
        return Err(HostTransportReadError::Malformed);
    }

    let mut total_header_bytes = request_line.len();
    let mut content_length = None;
    let mut sent_token = None;
    loop {
        let line = read_bounded_line(reader, MAX_HOST_CALL_HEADER_LINE_BYTES)?
            .ok_or(HostTransportReadError::Malformed)?;
        total_header_bytes = total_header_bytes.saturating_add(line.len());
        if total_header_bytes > MAX_HOST_CALL_HEADERS_BYTES {
            return Err(HostTransportReadError::HeadersTooLarge);
        }
        let line = std::str::from_utf8(&line).map_err(|_| HostTransportReadError::Malformed)?;
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break;
        }
        let (name, value) = trimmed
            .split_once(':')
            .ok_or(HostTransportReadError::Malformed)?;
        match name.trim().to_ascii_lowercase().as_str() {
            "content-length" => {
                if content_length.is_some() {
                    return Err(HostTransportReadError::Malformed);
                }
                content_length = Some(
                    value
                        .trim()
                        .parse::<usize>()
                        .map_err(|_| HostTransportReadError::Malformed)?,
                );
            }
            "x-snapback-host-token" => {
                if sent_token.is_some() {
                    return Err(HostTransportReadError::Malformed);
                }
                sent_token = Some(value.trim().to_owned());
            }
            _ => {}
        }
    }

    // Authenticate before allocating or reading the attacker-declared body.
    if sent_token.as_deref() != Some(expected_token) {
        return Err(HostTransportReadError::Unauthorized);
    }
    let content_length = content_length.ok_or(HostTransportReadError::Malformed)?;
    if content_length > MAX_HOST_CALL_BODY_BYTES {
        return Err(HostTransportReadError::BodyTooLarge);
    }
    let mut body = vec![0u8; content_length];
    reader
        .read_exact(&mut body)
        .map_err(|_| HostTransportReadError::Io)?;
    Ok(body)
}

fn transport_error_payload(error: HostTransportReadError) -> (u16, Value) {
    match error {
        HostTransportReadError::Unauthorized => (
            401,
            json!({ "ok": false, "code": "SNAPBACK_HANDLER_HOST_CALL_UNAUTHORIZED", "message": "host-call transport authentication failed" }),
        ),
        HostTransportReadError::HeadersTooLarge => (
            431,
            json!({ "ok": false, "code": "SNAPBACK_HANDLER_HOST_CALL_HEADERS_TOO_LARGE", "message": "host-call headers exceeded the transport limit" }),
        ),
        HostTransportReadError::BodyTooLarge => (
            413,
            json!({ "ok": false, "code": "SNAPBACK_HANDLER_HOST_CALL_BODY_TOO_LARGE", "message": "host-call body exceeded the transport limit" }),
        ),
        HostTransportReadError::Malformed | HostTransportReadError::Io => (
            400,
            json!({ "ok": false, "code": "SNAPBACK_HANDLER_HOST_CALL_MALFORMED", "message": "host-call transport request was malformed" }),
        ),
    }
}

fn write_json_response(mut stream: TcpStream, status: u16, response: Value) {
    let payload = response.to_string();
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        413 => "Content Too Large",
        431 => "Request Header Fields Too Large",
        _ => "Error",
    };
    let _ = write!(
        stream,
        "HTTP/1.1 {status} {reason}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
        payload.len(),
        payload
    );
    let _ = stream.flush();
}

fn serve_host_call_connection(stream: TcpStream, ctx: &mut IbexHostContext<'_>, token: &str) {
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(Duration::from_millis(2_000)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(2_000)));
    let mut reader = BufReader::new(stream);

    let body = match read_host_call_request(&mut reader, token) {
        Ok(body) => body,
        Err(error) => {
            let (status, payload) = transport_error_payload(error);
            write_json_response(reader.into_inner(), status, payload);
            return;
        }
    };
    let response = host_call_response(ctx, &body);
    write_json_response(reader.into_inner(), 200, response);
}

/// Decode one host call and dispatch it into the shared op table with the
/// same epoch discipline as the Ibex FFI trampoline: every legitimate call is
/// `"<epoch>|<op>"`, and a mismatched epoch is a stale continuation.
fn host_call_response(ctx: &mut IbexHostContext<'_>, body: &[u8]) -> Value {
    let parsed: Value = match serde_json::from_slice(body) {
        Ok(value) => value,
        Err(error) => {
            return json!({
                "ok": false,
                "code": "SNAPBACK_HANDLER_HOST_CALL_INVALID_JSON",
                "message": format!("host call body was not valid JSON: {error}"),
            });
        }
    };
    let raw_op = parsed.get("rawOp").and_then(Value::as_str).unwrap_or("");
    let args_json = parsed
        .get("argsJson")
        .and_then(Value::as_str)
        .unwrap_or("{}");

    let Some((epoch_str, op)) = raw_op.split_once('|') else {
        return json!({
            "ok": false,
            "code": "SNAPBACK_HANDLER_HOST_CALL_MALFORMED",
            "message": "handler host call was not issued through ctx",
        });
    };
    let Ok(call_epoch) = epoch_str.parse::<u64>() else {
        return json!({
            "ok": false,
            "code": "SNAPBACK_HANDLER_HOST_CALL_MALFORMED",
            "message": "handler host call carried an unparseable invocation epoch",
        });
    };
    if call_epoch != ctx.epoch() {
        return json!({
            "ok": false,
            "code": "SNAPBACK_HANDLER_STALE_CONTINUATION",
            "message": "a handler continuation from a prior invocation attempted a host call \
                        against the current invocation; rejected",
        });
    }
    let args: Value = match serde_json::from_str(args_json) {
        Ok(value) => value,
        Err(error) => {
            return json!({
                "ok": false,
                "code": "SNAPBACK_HANDLER_HOST_CALL_INVALID_JSON",
                "message": format!("handler host call arguments were not valid JSON: {error}"),
            });
        }
    };
    match dispatch_host_call(ctx, op, args) {
        Ok(value) => json!({ "ok": true, "value": value }),
        Err(error) => json!({
            "ok": false,
            "code": error.diagnostic.code,
            "message": error.diagnostic.message,
        }),
    }
}

#[cfg(test)]
mod security_tests {
    use super::*;
    use std::io::Cursor;

    fn request(token: &str, content_length: &str, body: &[u8]) -> Vec<u8> {
        let mut bytes = format!(
            "POST /host-call HTTP/1.1\r\ncontent-length: {content_length}\r\nx-snapback-host-token: {token}\r\n\r\n"
        )
        .into_bytes();
        bytes.extend_from_slice(body);
        bytes
    }

    #[test]
    fn host_transport_authenticates_before_allocating_declared_body() {
        let bytes = request("wrong", &usize::MAX.to_string(), &[]);
        let error = read_host_call_request(&mut Cursor::new(bytes), "right")
            .expect_err("a bad token must be refused");
        assert_eq!(error, HostTransportReadError::Unauthorized);
    }

    #[test]
    fn host_transport_bounds_headers_and_body() {
        let oversized = request("right", &(MAX_HOST_CALL_BODY_BYTES + 1).to_string(), &[]);
        assert_eq!(
            read_host_call_request(&mut Cursor::new(oversized), "right").unwrap_err(),
            HostTransportReadError::BodyTooLarge
        );

        let mut long_header = b"POST /host-call HTTP/1.1\r\nx-long: ".to_vec();
        long_header.extend(std::iter::repeat_n(b'a', MAX_HOST_CALL_HEADER_LINE_BYTES));
        long_header.extend_from_slice(b"\r\n\r\n");
        assert_eq!(
            read_host_call_request(&mut Cursor::new(long_header), "right").unwrap_err(),
            HostTransportReadError::HeadersTooLarge
        );
    }

    #[test]
    fn host_transport_accepts_one_bounded_authenticated_request() {
        let body = br#"{"rawOp":"1|runtime.now","argsJson":"{}"}"#;
        let bytes = request("right", &body.len().to_string(), body);
        assert_eq!(
            read_host_call_request(&mut Cursor::new(bytes), "right").unwrap(),
            body
        );
    }

    #[test]
    fn workerd_config_carries_a_private_invoke_capability() {
        let config = render_workerd_config(
            &CompatConfig {
                compatibility_date: "2026-07-01".to_owned(),
                compatibility_flags: vec![],
            },
            1234,
            5678,
            "unguessable-test-token",
        );
        assert!(config.contains("SNAPBACK_INVOKE_TOKEN"));
        assert!(config.contains("unguessable-test-token"));
    }

    #[cfg(unix)]
    #[test]
    fn workerd_files_are_created_exclusively() {
        let dir = create_private_invocation_dir().expect("private invocation directory");
        let _guard = TempDirGuard(dir.clone());
        let path = dir.join("entry.mjs");
        create_private_file(&path, "test-fixture", b"first").expect("first exclusive create");
        let error = create_private_file(&path, "test-fixture", b"replacement")
            .expect_err("create_new must refuse pre-existing files");
        assert_eq!(error.diagnostic.details["fileRole"], "test-fixture");
        assert_eq!(error.diagnostic.details["operation"], "create");
        assert!(
            !error
                .diagnostic
                .details
                .to_string()
                .contains(&dir.display().to_string()),
            "public diagnostics must not disclose the private materialization path"
        );
        assert_eq!(std::fs::read(path).unwrap(), b"first");

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777,
                0o700
            );
            assert_eq!(
                std::fs::metadata(dir.join("entry.mjs"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
    }
}
