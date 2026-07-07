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
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

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
         run `npm install` at the repo root or set SNAPBACK_WORKERD_BIN",
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

fn runner_error(code: &str, message: impl Into<String>, details: Value) -> SnapbackError {
    SnapbackError::error(code, "runtime", message.into()).with_details(details)
}

#[derive(Debug, Deserialize)]
struct InvokeResponse {
    envelope: Option<String>,
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
    let worker_port = {
        let probe = TcpListener::bind("127.0.0.1:0").map_err(|error| {
            runner_error(
                "SNAPBACK_V8_RUNNER_START_FAILED",
                "could not reserve a workerd socket port",
                json!({ "error": error.to_string() }),
            )
        })?;
        let port = probe
            .local_addr()
            .map_err(|error| {
                runner_error(
                    "SNAPBACK_V8_RUNNER_START_FAILED",
                    "could not read the reserved workerd port",
                    json!({ "error": error.to_string() }),
                )
            })?
            .port();
        drop(probe);
        port
    };
    let token = uuid::Uuid::new_v4().to_string();

    // Materialize the single-sourced harness plus this invocation's handler
    // module into a per-invocation directory; the config embeds them by path.
    let dir = env::temp_dir().join(format!(
        "snapback-workerd-{}-{}",
        std::process::id(),
        invocation.epoch()
    ));
    std::fs::create_dir_all(&dir).map_err(|error| {
        runner_error(
            "SNAPBACK_V8_RUNNER_START_FAILED",
            "could not create the workerd invocation directory",
            json!({ "error": error.to_string(), "dir": dir.display().to_string() }),
        )
    })?;
    let _dir_guard = TempDirGuard(dir.clone());
    let write = |name: &str, contents: &str| -> SnapbackResult<()> {
        std::fs::write(dir.join(name), contents).map_err(|error| {
            runner_error(
                "SNAPBACK_V8_RUNNER_START_FAILED",
                format!("could not write {name} for the workerd invocation"),
                json!({ "error": error.to_string() }),
            )
        })
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
        &render_workerd_config(&compat, host_port, worker_port),
    )?;

    let stderr_path = dir.join("workerd-stderr.log");
    let stderr_file = std::fs::File::create(&stderr_path).map_err(|error| {
        runner_error(
            "SNAPBACK_V8_RUNNER_START_FAILED",
            "could not create the workerd stderr capture",
            json!({ "error": error.to_string() }),
        )
    })?;
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

    // Readiness: the workerd socket accepts once the config is live.
    let worker_addr = format!("127.0.0.1:{worker_port}");
    loop {
        if Instant::now() >= deadline {
            return Err(startup_failure(&stderr_path, timeout_ms));
        }
        if let Ok(Some(_)) = child.0.try_wait() {
            return Err(startup_failure(&stderr_path, timeout_ms));
        }
        match TcpStream::connect_timeout(
            &worker_addr.parse().expect("loopback addr parses"),
            Duration::from_millis(100),
        ) {
            Ok(_) => break,
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
        "token": token,
    })
    .to_string();
    let invoke_url = format!("http://{worker_addr}/invoke");
    let request_timeout = Duration::from_millis(timeout_ms + 2_000);
    let (done_tx, done_rx) = mpsc::channel::<Result<String, String>>();
    let invoke_thread = std::thread::spawn(move || {
        let agent = ureq::AgentBuilder::new().timeout(request_timeout).build();
        let outcome = agent
            .post(&invoke_url)
            .set("content-type", "application/json")
            .send_string(&invoke_body);
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
                // workerd's hung-request detection is this leg's settlement
                // signal: the runtime proved the invocation promise can never
                // settle, which is exactly the Ibex no-progress fallback's
                // meaning — same failure, same stable code, nothing committed.
                let stderr = stderr_tail(&stderr_path);
                let hang_signal = format!("{message} {stderr}").to_ascii_lowercase();
                if hang_signal.contains("never generate a response")
                    || hang_signal.contains("hung")
                {
                    return Err(SnapbackError::error(
                        "SNAPBACK_HANDLER_DID_NOT_SETTLE",
                        "runtime",
                        "handler promise never settled — the invocation produced no result and \
                         committed no writes",
                    )
                    .with_details(json!({
                        "function": module.export,
                        "engine": "workerd-v8",
                        "signal": "workerd hung-request detection",
                    })));
                }
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

fn serve_host_call_connection(stream: TcpStream, ctx: &mut IbexHostContext<'_>, token: &str) {
    let _ = stream.set_read_timeout(Some(Duration::from_millis(2_000)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(2_000)));
    let mut reader = BufReader::new(stream);

    let mut request_line = String::new();
    if reader.read_line(&mut request_line).is_err() {
        return;
    }
    let mut content_length = 0usize;
    let mut sent_token = String::new();
    loop {
        let mut line = String::new();
        match reader.read_line(&mut line) {
            Ok(0) => break,
            Ok(_) => {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    break;
                }
                if let Some((name, value)) = trimmed.split_once(':') {
                    let name = name.trim().to_ascii_lowercase();
                    if name == "content-length" {
                        content_length = value.trim().parse().unwrap_or(0);
                    } else if name == "x-snapback-host-token" {
                        sent_token = value.trim().to_owned();
                    }
                }
            }
            Err(_) => return,
        }
    }
    let mut body = vec![0u8; content_length];
    if reader.read_exact(&mut body).is_err() {
        return;
    }
    let mut stream = reader.into_inner();

    let response = if sent_token != token {
        json!({ "ok": false, "code": "SNAPBACK_HANDLER_HOST_CALL_MALFORMED", "message": "host call carried a bad transport token" })
    } else {
        host_call_response(ctx, &body)
    };
    let payload = response.to_string();
    let _ = write!(
        stream,
        "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
        payload.len(),
        payload
    );
    let _ = stream.flush();
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
    let args_json = parsed.get("argsJson").and_then(Value::as_str).unwrap_or("{}");

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
