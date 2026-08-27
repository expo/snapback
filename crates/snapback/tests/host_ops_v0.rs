//! LLP 0032 P6: the host-ops first slice. One operation endpoint
//! (`POST /_snapback/api/host-ops`), one `hostOpsResult` envelope per call,
//! served ops app.inspect / debug.networkProfile{Get,Set} / schema.load / functions.load /
//! function.run / function.explain; pinned-not-built ops fail closed with a
//! structured diagnostic; app.reset fails closed unless it executes through
//! the authorization-stream coordinator; the readiness descriptor validates
//! for LLP 0030 attach. The mutationDryRun explain kind has its own suite in
//! `tests/dry_run_v0.rs`.

fn test_app_state_from_snapback(
    snapback: snapback::local::LocalSnapback,
    context: snapback::admin::ServerContext,
) -> snapback::admin::AppState {
    snapback::admin::AppState::try_from_snapback(snapback, context).expect("test app state")
}

use serde_json::{Value, json};
use snapback::admin::{AppState, ServerContext, ServerProfile};
use snapback::admin_impersonation::{
    IMPERSONATION_CAPABILITY_HEADER, ImpersonationCapabilityRegistry,
};
use snapback::auth::crypto::OsRandom;
use snapback::auth::mode::{
    AUTH_MODE_FORMAT_VERSION, AppDataAvailability, AuthModeStateRecord, AuthModeStatus,
    AuthProgramReadiness, DeploymentIdentity, FUNCTION_V1_PREFIX, INPUTS_V1_PREFIX,
    SCHEMA_V1_PREFIX,
};
use snapback::diagnostic::DiagnosticSeverity;
use snapback::host_ops::{
    HOST_READY_DESCRIPTOR_KIND, HostOpsRequest, HostOpsTarget, HostReadyDatabase,
    HostReadyDescriptor, execute_host_op,
};
use snapback::local::LocalSnapback;
use snapback::manifest::{
    AuthMode, AuthRequirement, FunctionDefinition, FunctionKind, FunctionManifest, FunctionRuntime,
    IbexModule,
};
use snapback::server::PolicyAuthMode;
use snapback_server::test_support::axum::body::{Body, to_bytes};
use snapback_server::test_support::axum::http::{Request, StatusCode, header};
use std::fs;
use std::io::{Read as _, Write as _};
use std::path::PathBuf;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};
use tower::ServiceExt as _;

struct RestartServerGuard {
    binary: &'static str,
    ready_file: PathBuf,
    active: bool,
}

impl RestartServerGuard {
    fn stop(&mut self) {
        if !self.active {
            return;
        }
        let _ = std::process::Command::new(self.binary)
            .args(["stop", "--ready-file"])
            .arg(&self.ready_file)
            .env_remove("SNAPBACK_ADMIN_TOKEN")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
        self.active = false;
    }
}

impl Drop for RestartServerGuard {
    fn drop(&mut self) {
        self.stop();
    }
}

fn wait_for_cli_ready(
    child: &mut std::process::Child,
    path: &std::path::Path,
) -> HostReadyDescriptor {
    // 60s ceiling: readiness normally lands in ~1-2s, but a cold spawn under
    // heavy fleet machine load (parallel builds/agent sessions) has been
    // observed to exceed a 15s deadline; the loop returns as soon as the
    // descriptor appears, so a generous ceiling costs nothing when healthy.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(60);
    loop {
        if path.exists() {
            let value: Value = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
            return HostReadyDescriptor::validate(&value).expect("valid CLI readiness descriptor");
        }
        if let Some(status) = child.try_wait().unwrap() {
            panic!("Snapback server exited before readiness: {status}");
        }
        assert!(
            std::time::Instant::now() < deadline,
            "Snapback server did not publish readiness"
        );
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
}

#[derive(Clone, Copy)]
enum FakeLifecycleReply {
    CloseHostOp,
    OkOnly,
    SelfStopClaim,
    SelfStopClaimThenClose,
}

struct FakeLifecycleServer {
    address: std::net::SocketAddr,
    requests: Arc<Mutex<Vec<String>>>,
    shutdown: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl FakeLifecycleServer {
    fn spawn(pid: u32, startup_nonce: &str, reply: FakeLifecycleReply) -> Self {
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();
        let target = HostOpsTarget {
            app_id: "forged-app".to_owned(),
            app_root: None,
            target_profile: snapback::manifest::TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX.to_owned(),
            server_url: Some(format!("http://{address}")),
        };
        let requests = Arc::new(Mutex::new(Vec::new()));
        let request_log = Arc::clone(&requests);
        let shutdown = Arc::new(AtomicBool::new(false));
        let shutdown_signal = Arc::clone(&shutdown);
        let startup_nonce = startup_nonce.to_owned();
        let thread = std::thread::spawn(move || {
            while !shutdown_signal.load(Ordering::Acquire) {
                let (mut stream, _) = match listener.accept() {
                    Ok(connection) => connection,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(std::time::Duration::from_millis(5));
                        continue;
                    }
                    Err(error) => panic!("fake lifecycle accept failed: {error}"),
                };
                let Some(request) = read_fake_http_request(&mut stream) else {
                    continue;
                };
                request_log.lock().unwrap().push(request.clone());
                if request.starts_with("GET /health ") {
                    write_fake_http_json(
                        &mut stream,
                        &json!({
                            "ok": true,
                            "pid": pid,
                            "binary": { "pid": pid, "startupNonce": startup_nonce },
                            "server": { "pid": pid, "startupNonce": startup_nonce },
                        }),
                    );
                    continue;
                }
                if !request.starts_with("POST /_snapback/api/host-ops ") {
                    continue;
                }
                match reply {
                    FakeLifecycleReply::CloseHostOp => {}
                    FakeLifecycleReply::OkOnly => {
                        write_fake_http_json(&mut stream, &json!({ "ok": true }));
                    }
                    FakeLifecycleReply::SelfStopClaim
                    | FakeLifecycleReply::SelfStopClaimThenClose => {
                        let body = request
                            .split_once("\r\n\r\n")
                            .and_then(|(_, body)| serde_json::from_str::<Value>(body).ok())
                            .expect("host-op request JSON");
                        write_fake_http_json(
                            &mut stream,
                            &json!({
                                "schemaVersion": snapback::manifest::SNAPBACK_SCHEMA_VERSION,
                                "resultKind": "hostOpsResult",
                                "requestId": body["requestId"],
                                "operation": "host.stop",
                                "ok": true,
                                "target": target,
                                "authority": {
                                    "mode": "devAdminBypass",
                                    "actorPrincipal": null,
                                    "effectivePrincipal": null,
                                    "localDevOnly": true,
                                    "adminBypass": true,
                                    "scope": null,
                                    "reason": "host-ops process lifecycle gate"
                                },
                                "artifacts": {
                                    "schemaHash": null,
                                    "bundleHash": null,
                                    "databaseVersion": null
                                },
                                "data": {
                                    "shutdownRequested": true,
                                    "shutdownMode": "serverSelfStop"
                                },
                                "diagnostics": [],
                                "next": []
                            }),
                        );
                        if matches!(reply, FakeLifecycleReply::SelfStopClaimThenClose) {
                            return;
                        }
                    }
                }
            }
        });
        Self {
            address,
            requests,
            shutdown,
            thread: Some(thread),
        }
    }

    fn requests(&self) -> Vec<String> {
        self.requests.lock().unwrap().clone()
    }
}

impl Drop for FakeLifecycleServer {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::Release);
        if let Some(thread) = self.thread.take() {
            // A destructor must never panic. The responder thread can legitimately
            // hit a read error (connection reset on shutdown) and panic; joining a
            // panicked thread and unwrapping would abort the whole test binary
            // non-unwinding. The test body's assertions validate behavior — the
            // fixture teardown only needs to stop the thread.
            let _ = thread.join();
        }
    }
}

fn read_fake_http_request(stream: &mut std::net::TcpStream) -> Option<String> {
    stream
        .set_read_timeout(Some(std::time::Duration::from_secs(2)))
        .unwrap();
    let mut bytes = Vec::new();
    let mut chunk = [0_u8; 4096];
    loop {
        let count = match stream.read(&mut chunk) {
            Ok(count) => count,
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) =>
            {
                return None;
            }
            Err(error) => panic!("read fake HTTP request: {error}"),
        };
        if count == 0 {
            break;
        }
        bytes.extend_from_slice(&chunk[..count]);
        let Some(header_end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") else {
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
    Some(String::from_utf8(bytes).expect("fake HTTP request is UTF-8"))
}

fn write_fake_http_json(stream: &mut std::net::TcpStream, body: &Value) {
    let body = body.to_string();
    write!(
        stream,
        "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
        body.len(),
        body,
    )
    .unwrap();
}

fn fake_lifecycle_descriptor(
    ready_file: &std::path::Path,
    server: &FakeLifecycleServer,
    victim_pid: u32,
    startup_nonce: &str,
) -> HostReadyDescriptor {
    let server_url = format!("http://{}", server.address);
    let descriptor = HostReadyDescriptor {
        schema_version: snapback::manifest::SNAPBACK_SCHEMA_VERSION.to_owned(),
        descriptor_kind: HOST_READY_DESCRIPTOR_KIND.to_owned(),
        startup_id: "srt_forged_lifecycle".to_owned(),
        ready: true,
        server_url: server_url.clone(),
        host: server.address.ip().to_string(),
        port: server.address.port(),
        pid: victim_pid,
        startup_nonce: Some(startup_nonce.to_owned()),
        server_profile: Some("dev".to_owned()),
        target: HostOpsTarget {
            app_id: "forged-app".to_owned(),
            app_root: None,
            target_profile: snapback::manifest::TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX.to_owned(),
            server_url: Some(server_url),
        },
        database: HostReadyDatabase {
            mode: "memory".to_owned(),
            path: None,
        },
        started_at_ms: 0,
        admin_gated: true,
        admin_token_file: None,
        secret_read_root_file: None,
        impersonation_capability_file: None,
        dev_identity_capability_file: None,
        diagnostics: Vec::new(),
    };
    fs::write(ready_file, serde_json::to_string(&descriptor).unwrap()).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        fs::set_permissions(ready_file, fs::Permissions::from_mode(0o600)).unwrap();
    }
    descriptor
}

fn fully_settled_sessions_runtime(state: AppState) -> AppState {
    let digest = |prefix: &str, marker: char| format!("{prefix}{}", marker.to_string().repeat(64));
    let deployment = DeploymentIdentity {
        schema_version: "snapback.v1".to_owned(),
        auth_mode: AuthMode::Sessions,
        app_id: "default-react-scaffold".to_owned(),
        schema_hash: digest(SCHEMA_V1_PREFIX, '1'),
        bundle_hash: digest(FUNCTION_V1_PREFIX, '2'),
        inputs_hash: digest(INPUTS_V1_PREFIX, '3'),
    };
    state
        .with_auth_runtime_facts(
            AuthModeStateRecord {
                format_version: AUTH_MODE_FORMAT_VERSION,
                transition_generation: 1,
                active: AuthMode::Sessions,
                desired: AuthMode::Sessions,
                mode_state: AuthModeStatus::Settled,
                app_data_availability: AppDataAvailability::Available,
                sessions_ever_activated: true,
                active_deployment: Some(deployment),
                requested_deployment: None,
                quarantine: None,
            },
            AuthProgramReadiness::new(true, true, true, true, true, true, true),
        )
        .expect("install fully settled sessions runtime")
}

/// The default React scaffold settles sessions mode and requires every online
/// app client to offer auth-client protocol v1. The native CLI must omit
/// `userId`, offer that protocol on its anonymous app-route retry, and still
/// enforce an authenticated function before its handler executes.
// @ref LLP 0058#session-mode-body-closure — every legacy authority field,
// populated or null, is rejected before the host operation runs.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn snapback_run_sessions_retry_runs_public_and_refuses_protected_query() {
    let mut snapback = LocalSnapback::memory().expect("sessions CLI fixture");
    let source = r#"
let protectedExecutions = 0;
globalThis.__snapbackHandlers = {
  publicStatus() { return [{ visibility: 'public' }]; },
  protectedStatus() {
    protectedExecutions += 1;
    return [{ marker: 'PROTECTED_HANDLER_EXECUTED' }];
  },
  protectedExecutionProbe() { return [{ protectedExecutions }]; },
};
"#
    .to_owned();
    let mut public_query = FunctionDefinition::new(
        "publicStatus",
        FunctionKind::Query,
        FunctionRuntime::IbexModule(IbexModule {
            source: source.clone(),
            export: "publicStatus".to_owned(),
        }),
    );
    public_query.auth_requirement = Some(AuthRequirement::Public);
    let mut protected_query = FunctionDefinition::new(
        "protectedStatus",
        FunctionKind::Query,
        FunctionRuntime::IbexModule(IbexModule {
            source: source.clone(),
            export: "protectedStatus".to_owned(),
        }),
    );
    protected_query.auth_requirement = Some(AuthRequirement::Authenticated);
    let mut execution_probe = FunctionDefinition::new(
        "protectedExecutionProbe",
        FunctionKind::Query,
        FunctionRuntime::IbexModule(IbexModule {
            source,
            export: "protectedExecutionProbe".to_owned(),
        }),
    );
    execution_probe.auth_requirement = Some(AuthRequirement::Public);
    let diagnostics = snapback.load_functions(FunctionManifest {
        functions: vec![public_query, protected_query, execution_probe],
        ..FunctionManifest::default()
    });
    assert!(
        diagnostics.iter().all(|diagnostic| !matches!(
            &diagnostic.severity,
            DiagnosticSeverity::Error | DiagnosticSeverity::Fatal
        )),
        "sessions CLI fixture functions must load: {diagnostics:?}"
    );

    let std_listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = std_listener.local_addr().unwrap();
    let mut context = ServerContext::from_bound_listener(&std_listener).unwrap();
    context.profile = ServerProfile::Test;
    context.admin_token = Some("sessions-public-cli-admin".to_owned());
    std_listener.set_nonblocking(true).unwrap();
    let listener = tokio::net::TcpListener::from_std(std_listener).unwrap();
    let state = fully_settled_sessions_runtime(
        test_app_state_from_snapback(snapback, context)
            .with_policy_auth_mode(PolicyAuthMode::Sessions),
    );
    let server = tokio::spawn(async move {
        snapback::server::app(state)
            .bind(listener)
            .expect("bind sessions CLI fixture")
            .serve()
            .await
            .expect("serve sessions CLI fixture");
    });

    let (public_output, protected_output, probe_output) = tokio::task::spawn_blocking(move || {
        let run = |function: &str| {
            std::process::Command::new(env!("CARGO_BIN_EXE_snapback"))
                .args([
                    "run",
                    "--url",
                    &format!("http://{address}"),
                    "--token",
                    "sessions-public-cli-admin",
                    function,
                ])
                .env_remove("SNAPBACK_ADMIN_TOKEN")
                .output()
                .expect("run native CLI against sessions fixture")
        };
        (
            run("publicStatus"),
            run("protectedStatus"),
            run("protectedExecutionProbe"),
        )
    })
    .await
    .unwrap();
    server.abort();

    assert!(
        public_output.status.success(),
        "snapback run stderr: {}\nstdout: {}",
        String::from_utf8_lossy(&public_output.stderr),
        String::from_utf8_lossy(&public_output.stdout),
    );
    let envelope: Value = serde_json::from_slice(&public_output.stdout).expect("CLI query result");
    assert_eq!(
        envelope["rows"][0]["visibility"], "public",
        "public sessions invocation must use the anonymous query route: {envelope}"
    );
    assert!(
        envelope.get("diagnostic").is_none(),
        "the successful anonymous query must not carry a refusal: {envelope}"
    );

    assert!(
        !protected_output.status.success(),
        "an authenticated query must remain closed to snapback run's anonymous retry"
    );
    let protected: Value = serde_json::from_slice(&protected_output.stdout)
        .expect("protected CLI refusal must remain structured JSON");
    assert_eq!(
        protected["diagnostic"]["code"], "SNAPBACK_AUTH_REQUIRED",
        "the app route must refuse the anonymous retry at the function gate: {protected}"
    );
    let protected_process_output = format!(
        "{}\n{}",
        String::from_utf8_lossy(&protected_output.stdout),
        String::from_utf8_lossy(&protected_output.stderr)
    );
    assert!(
        !protected_process_output.contains("PROTECTED_HANDLER_EXECUTED"),
        "the protected handler marker must not escape: {protected_process_output}"
    );

    assert!(
        probe_output.status.success(),
        "execution probe stderr: {}\nstdout: {}",
        String::from_utf8_lossy(&probe_output.stderr),
        String::from_utf8_lossy(&probe_output.stdout),
    );
    let probe: Value =
        serde_json::from_slice(&probe_output.stdout).expect("protected execution probe result");
    assert_eq!(
        probe["rows"][0]["protectedExecutions"], 0,
        "the authenticated handler must not execute on the anonymous retry path: {probe}"
    );
}

/// @ref LLP 0184#security-and-ergonomics-invariants — the native CLI restart
/// presents a concrete admin credential, accepts the exact lifecycle result
/// shape, and spawns the successor only after observing the descriptor-named,
/// pre-stop process identity gone.
#[test]
fn snapback_restart_cli_proves_credential_and_composes_lifecycle() {
    let binary = env!("CARGO_BIN_EXE_snapback");
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("restart.sqlite3");
    let ready_file = directory.path().join("restart.ready.json");
    let mut initial = std::process::Command::new(binary)
        .args(["start", "--port", "0", "--db"])
        .arg(&database)
        .arg("--ready-file")
        .arg(&ready_file)
        .env_remove("SNAPBACK_ADMIN_TOKEN")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .unwrap();
    let previous = wait_for_cli_ready(&mut initial, &ready_file);
    let mut cleanup = RestartServerGuard {
        binary,
        ready_file: ready_file.clone(),
        active: true,
    };
    let previous_nonce = previous.startup_nonce.clone().unwrap();
    let token_file = snapback::admin::admin_token_sibling(&database);
    let token = fs::read_to_string(&token_file).unwrap();
    let token_backup = directory.path().join("restart.admin-token.backup");

    fs::rename(&token_file, &token_backup).unwrap();
    let refused = std::process::Command::new(binary)
        .args(["restart", "--ready-file"])
        .arg(&ready_file)
        .arg("--reason")
        .arg("credential-negative")
        .env_remove("SNAPBACK_ADMIN_TOKEN")
        .output()
        .unwrap();
    fs::rename(&token_backup, &token_file).unwrap();
    assert!(!refused.status.success());
    let refused: Value = serde_json::from_slice(&refused.stdout).unwrap();
    assert_eq!(refused["operation"], "host.restart");
    assert_eq!(refused["ok"], false);
    assert_eq!(
        refused["diagnostics"][0]["code"],
        "SNAPBACK_HOST_RESTART_ADMIN_CREDENTIAL_REQUIRED"
    );
    assert_eq!(
        refused["diagnostics"][0]["details"].get("adminDiagnosticCodes"),
        None,
        "the refusal must not reveal target auth-policy diagnostics: {refused}"
    );
    assert!(
        refused["diagnostics"][0]["details"]["sanctionedDevAlternative"]
            .as_str()
            .is_some_and(|alternative| alternative.contains("`snapback dev`")),
        "the refusal must name the sanctioned stop/start alternative: {refused}"
    );
    let after_refusal: Value = serde_json::from_slice(&fs::read(&ready_file).unwrap()).unwrap();
    assert_eq!(after_refusal["startupNonce"], previous_nonce);

    // Reap the first child after it performs its authenticated self-stop.
    let reaper = std::thread::spawn(move || initial.wait().unwrap());
    let restarted = std::process::Command::new(binary)
        .args(["restart", "--ready-file"])
        .arg(&ready_file)
        .arg("--reason")
        .arg("acceptance-restart")
        .env_remove("SNAPBACK_ADMIN_TOKEN")
        .output()
        .unwrap();
    assert!(
        restarted.status.success(),
        "restart stderr: {}\nstdout: {}",
        String::from_utf8_lossy(&restarted.stderr),
        String::from_utf8_lossy(&restarted.stdout)
    );
    assert!(reaper.join().unwrap().success());
    let receipt: Value = serde_json::from_slice(&restarted.stdout).unwrap();
    assert_eq!(receipt["operation"], "host.restart");
    assert_eq!(receipt["ok"], true, "{receipt}");
    assert_eq!(receipt["data"]["restartReason"], "acceptance-restart");
    assert_eq!(
        receipt["data"]["previous"]["credentialedHostOpResultAccepted"],
        true
    );
    assert_eq!(
        receipt["data"]["previous"]["configuredUrlStoppedAnswering"],
        true
    );
    assert_eq!(receipt["data"]["previous"]["processIdentityVerified"], true);
    assert_eq!(receipt["data"]["previous"].get("shutdownMode"), None);
    assert_eq!(
        receipt["data"]["previous"].get("healthEndpointStopped"),
        None
    );
    assert_eq!(receipt["data"]["previous"].get("pid"), None);
    assert_eq!(receipt["data"]["previous"].get("stoppedPid"), None);
    assert_eq!(receipt["data"]["previous"].get("verifiedBy"), None);
    assert!(receipt["data"]["current"]["pid"].as_u64().is_some());
    assert!(receipt["data"]["current"]["runtimeState"].is_object());
    assert_eq!(
        receipt["data"]["current"]["restartVerifiedBy"],
        "administratorCredential"
    );
    assert!(
        !String::from_utf8_lossy(&restarted.stdout).contains(token.trim()),
        "the administrator credential must not enter the restart receipt"
    );
    let current: Value = serde_json::from_slice(&fs::read(&ready_file).unwrap()).unwrap();
    assert_ne!(current["startupNonce"], previous_nonce);

    cleanup.stop();
}

#[test]
fn snapback_stop_refuses_a_genuine_descriptor_crafted_with_a_foreign_pid() {
    let binary = env!("CARGO_BIN_EXE_snapback");
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("crafted-stop.sqlite3");
    let ready_file = directory.path().join("crafted-stop.ready.json");
    let crafted_ready_file = directory.path().join("crafted-foreign.ready.json");
    let mut server = std::process::Command::new(binary)
        .args(["start", "--port", "0", "--db"])
        .arg(&database)
        .arg("--ready-file")
        .arg(&ready_file)
        .env_remove("SNAPBACK_ADMIN_TOKEN")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .unwrap();
    let descriptor = wait_for_cli_ready(&mut server, &ready_file);
    let mut cleanup = RestartServerGuard {
        binary,
        ready_file: ready_file.clone(),
        active: true,
    };
    let mut foreign = std::process::Command::new("sleep")
        .arg("60")
        .spawn()
        .unwrap();
    let mut crafted = descriptor.clone();
    crafted.pid = foreign.id();
    fs::write(
        &crafted_ready_file,
        serde_json::to_string(&crafted).unwrap().as_bytes(),
    )
    .unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        fs::set_permissions(&crafted_ready_file, fs::Permissions::from_mode(0o600)).unwrap();
    }

    let refused = std::process::Command::new(binary)
        .args(["stop", "--ready-file"])
        .arg(&crafted_ready_file)
        .env_remove("SNAPBACK_ADMIN_TOKEN")
        .output()
        .unwrap();
    assert!(!refused.status.success());
    let receipt: Value = serde_json::from_slice(&refused.stdout).unwrap();
    assert_eq!(receipt["operation"], "host.stop");
    assert_eq!(receipt["ok"], false);
    assert_eq!(
        receipt["diagnostics"][0]["code"],
        "SNAPBACK_HOST_STOP_ADMIN_CREDENTIAL_REQUIRED"
    );
    assert!(
        foreign.try_wait().unwrap().is_none(),
        "the crafted descriptor must never signal the foreign process"
    );

    let _ = foreign.kill();
    let _ = foreign.wait();
    cleanup.stop();
    assert!(server.wait().unwrap().success());
}

/// Exact round-3 peer repro: both descriptor.pid and every PID/nonce field on
/// the fake health responder name a live unrelated victim. Direct stop may
/// present only the nonce to authenticated host.stop; it must never signal the
/// forged PID when that responder cannot complete the host operation.
#[test]
fn snapback_stop_fake_health_forging_nonce_and_pid_never_signals_victim() {
    let binary = env!("CARGO_BIN_EXE_snapback");
    let directory = tempfile::tempdir().unwrap();
    let ready_file = directory.path().join("forged-stop.ready.json");
    let mut victim = std::process::Command::new("sleep")
        .arg("60")
        .spawn()
        .unwrap();
    let nonce = "peer-forged-stop-nonce";
    let fake = FakeLifecycleServer::spawn(victim.id(), nonce, FakeLifecycleReply::CloseHostOp);
    fake_lifecycle_descriptor(&ready_file, &fake, victim.id(), nonce);

    let refused = std::process::Command::new(binary)
        .args(["stop", "--ready-file"])
        .arg(&ready_file)
        .env("SNAPBACK_ADMIN_TOKEN", "dummy")
        .output()
        .unwrap();
    assert!(!refused.status.success());
    let receipt: Value = serde_json::from_slice(&refused.stdout).unwrap();
    assert_eq!(receipt["operation"], "host.stop");
    assert_eq!(receipt["ok"], false);
    assert_eq!(
        receipt["diagnostics"][0]["code"],
        "SNAPBACK_HOST_STOP_ADMIN_CREDENTIAL_REQUIRED"
    );
    assert!(
        victim.try_wait().unwrap().is_none(),
        "the exact forged PID+nonce peer repro must leave the victim alive"
    );
    let requests = fake.requests();
    assert!(
        requests
            .iter()
            .any(|request| request.starts_with("GET /health "))
    );
    let stop_request = requests
        .iter()
        .find(|request| request.starts_with("POST /_snapback/api/host-ops "))
        .expect("direct stop must route through authenticated host.stop");
    assert!(stop_request.contains("x-snapback-admin-token: dummy"));
    assert!(stop_request.contains(&format!("\"startupNonce\":\"{nonce}\"")));
    assert!(
        !stop_request.contains("\"pid\""),
        "no caller-named PID may enter the self-stop request: {stop_request}"
    );

    victim.kill().unwrap();
    victim.wait().unwrap();
}

#[test]
fn snapback_restart_fake_ok_only_responder_never_signals_victim() {
    let binary = env!("CARGO_BIN_EXE_snapback");
    let directory = tempfile::tempdir().unwrap();
    let ready_file = directory.path().join("fake-ok-restart.ready.json");
    let mut victim = std::process::Command::new("sleep")
        .arg("60")
        .spawn()
        .unwrap();
    let nonce = "fake-ok-restart-nonce";
    let fake = FakeLifecycleServer::spawn(victim.id(), nonce, FakeLifecycleReply::OkOnly);
    fake_lifecycle_descriptor(&ready_file, &fake, victim.id(), nonce);

    let refused = std::process::Command::new(binary)
        .args(["restart", "--ready-file"])
        .arg(&ready_file)
        .env("SNAPBACK_ADMIN_TOKEN", "dummy")
        .output()
        .unwrap();
    assert!(!refused.status.success());
    let receipt: Value = serde_json::from_slice(&refused.stdout).unwrap();
    assert_eq!(receipt["operation"], "host.restart");
    assert_eq!(receipt["ok"], false);
    assert_eq!(
        receipt["diagnostics"][0]["code"],
        "SNAPBACK_HOST_RESTART_ADMIN_CREDENTIAL_REQUIRED"
    );
    assert!(
        victim.try_wait().unwrap().is_none(),
        "a fake top-level ok response must leave the restart victim alive"
    );

    victim.kill().unwrap();
    victim.wait().unwrap();
}

/// A fake can forge the entire typed success response, including the declared
/// administrator authority. While its configured URL keeps answering, restart
/// fails the narrow post-result observation and never reaches replacement
/// start or any PID signal.
#[test]
fn snapback_restart_forged_pid_nonce_and_self_stop_claim_times_out_without_signal() {
    let binary = env!("CARGO_BIN_EXE_snapback");
    let directory = tempfile::tempdir().unwrap();
    let ready_file = directory.path().join("forged-restart.ready.json");
    let mut victim = std::process::Command::new("sleep")
        .arg("60")
        .spawn()
        .unwrap();
    let nonce = "forged-restart-nonce";
    let fake = FakeLifecycleServer::spawn(victim.id(), nonce, FakeLifecycleReply::SelfStopClaim);
    fake_lifecycle_descriptor(&ready_file, &fake, victim.id(), nonce);

    let refused = std::process::Command::new(binary)
        .args(["restart", "--ready-file"])
        .arg(&ready_file)
        .env("SNAPBACK_ADMIN_TOKEN", "dummy")
        .output()
        .unwrap();
    assert!(!refused.status.success());
    let receipt: Value = serde_json::from_slice(&refused.stdout).unwrap();
    assert_eq!(receipt["operation"], "host.restart");
    assert_eq!(receipt["ok"], false);
    assert_eq!(
        receipt["diagnostics"][0]["code"],
        "SNAPBACK_HOST_RESTART_STOP_TIMEOUT"
    );
    assert_eq!(
        receipt["data"]["previous"]["credentialedHostOpResultAccepted"],
        true
    );
    assert_eq!(
        receipt["data"]["previous"]["configuredUrlStoppedAnswering"],
        false
    );
    assert_eq!(
        receipt["data"]["previous"]["processIdentityVerified"],
        false
    );
    assert_eq!(receipt["data"]["previous"].get("verifiedBy"), None);
    assert_eq!(receipt["data"]["previous"].get("pid"), None);
    assert_eq!(receipt["data"]["previous"].get("stoppedPid"), None);
    assert!(
        victim.try_wait().unwrap().is_none(),
        "a full PID+nonce+receipt forgery must leave the restart victim alive"
    );

    victim.kill().unwrap();
    victim.wait().unwrap();
}

#[test]
fn snapback_stop_self_stop_claim_is_failure_while_health_keeps_answering() {
    let binary = env!("CARGO_BIN_EXE_snapback");
    let directory = tempfile::tempdir().unwrap();
    let ready_file = directory.path().join("lying-stop.ready.json");
    let mut victim = std::process::Command::new("sleep")
        .arg("60")
        .spawn()
        .unwrap();
    let nonce = "lying-stop-nonce";
    let fake = FakeLifecycleServer::spawn(victim.id(), nonce, FakeLifecycleReply::SelfStopClaim);
    fake_lifecycle_descriptor(&ready_file, &fake, victim.id(), nonce);

    let refused = std::process::Command::new(binary)
        .args(["stop", "--ready-file"])
        .arg(&ready_file)
        .env("SNAPBACK_ADMIN_TOKEN", "dummy")
        .output()
        .unwrap();
    assert!(!refused.status.success());
    let receipt: Value = serde_json::from_slice(&refused.stdout).unwrap();
    assert_eq!(receipt["operation"], "host.stop");
    assert_eq!(receipt["ok"], false);
    assert_eq!(receipt["data"]["credentialedHostOpResultAccepted"], true);
    assert_eq!(receipt["data"]["configuredUrlStoppedAnswering"], false);
    assert_eq!(receipt["data"]["processIdentityVerified"], false);
    assert_eq!(
        receipt["diagnostics"][0]["code"],
        "SNAPBACK_HOST_STOP_TIMEOUT"
    );
    assert_eq!(receipt["data"].get("verifiedBy"), None);
    assert!(
        victim.try_wait().unwrap().is_none(),
        "a liveness lie must be reported as failure without touching the victim"
    );

    victim.kill().unwrap();
    victim.wait().unwrap();
}

/// A same-UID responder can forge every descriptor/result input and close its
/// listener after replying, but it cannot make the live descriptor-named,
/// pre-stop PID/start-time identity disappear. URL loss is recorded while the
/// top-level result remains false and the unrelated victim remains untouched.
#[test]
fn snapback_stop_forged_self_stop_then_close_receipt_disclaims_process_identity() {
    let binary = env!("CARGO_BIN_EXE_snapback");
    let directory = tempfile::tempdir().unwrap();
    let ready_file = directory.path().join("forged-close-stop.ready.json");
    let mut victim = std::process::Command::new("sleep")
        .arg("60")
        .spawn()
        .unwrap();
    let nonce = "forged-close-stop-nonce";
    let fake = FakeLifecycleServer::spawn(
        victim.id(),
        nonce,
        FakeLifecycleReply::SelfStopClaimThenClose,
    );
    fake_lifecycle_descriptor(&ready_file, &fake, victim.id(), nonce);

    let stopped = std::process::Command::new(binary)
        .args(["stop", "--ready-file"])
        .arg(&ready_file)
        .env("SNAPBACK_ADMIN_TOKEN", "dummy")
        .output()
        .unwrap();
    assert!(!stopped.status.success());
    let receipt: Value = serde_json::from_slice(&stopped.stdout).unwrap();
    assert_eq!(receipt["operation"], "host.stop");
    assert_eq!(receipt["ok"], false);
    assert_eq!(receipt["authority"], Value::Null);
    let data = receipt["data"].as_object().expect("stop observation data");
    assert_eq!(
        data.len(),
        3,
        "stop observation data must remain exact: {receipt}; stderr: {}",
        String::from_utf8_lossy(&stopped.stderr),
    );
    assert_eq!(data["credentialedHostOpResultAccepted"], true);
    assert_eq!(data["configuredUrlStoppedAnswering"], true);
    assert_eq!(data["processIdentityVerified"], false);
    assert_eq!(data.get("pid"), None);
    assert_eq!(data.get("stoppedPid"), None);
    assert_eq!(data.get("shutdownRequested"), None);
    assert_eq!(data.get("shutdownMode"), None);
    assert_eq!(data.get("verifiedBy"), None);
    assert_eq!(
        receipt["diagnostics"][0]["code"],
        "SNAPBACK_HOST_STOP_TIMEOUT"
    );
    assert!(
        victim.try_wait().unwrap().is_none(),
        "forge-then-close must not stop the unrelated descriptor-named victim"
    );

    victim.kill().unwrap();
    victim.wait().unwrap();
}

#[test]
fn snapback_restart_cli_preserves_prod_test_and_demo_profiles() {
    let binary = env!("CARGO_BIN_EXE_snapback");
    for profile in ["prod", "test", "demo"] {
        let directory = tempfile::tempdir().unwrap();
        let database = directory.path().join(format!("restart-{profile}.sqlite3"));
        let ready_file = directory
            .path()
            .join(format!("restart-{profile}.ready.json"));
        let mut initial = std::process::Command::new(binary)
            .args(["start", "--port", "0", "--db"])
            .arg(&database)
            .arg("--ready-file")
            .arg(&ready_file)
            .env("SNAPBACK_PROFILE", profile)
            .env_remove("SNAPBACK_ADMIN_TOKEN")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .unwrap();
        let previous = wait_for_cli_ready(&mut initial, &ready_file);
        assert_eq!(previous.server_profile.as_deref(), Some(profile));
        let mut cleanup = RestartServerGuard {
            binary,
            ready_file: ready_file.clone(),
            active: true,
        };
        let reaper = std::thread::spawn(move || initial.wait().unwrap());
        let restarted = std::process::Command::new(binary)
            .args(["restart", "--ready-file"])
            .arg(&ready_file)
            .arg("--reason")
            .arg("profile-round-trip")
            .env("SNAPBACK_PROFILE", "dev")
            .env_remove("SNAPBACK_ADMIN_TOKEN")
            .output()
            .unwrap();
        assert!(
            restarted.status.success(),
            "{profile} restart stderr: {}\nstdout: {}",
            String::from_utf8_lossy(&restarted.stderr),
            String::from_utf8_lossy(&restarted.stdout),
        );
        assert!(reaper.join().unwrap().success());
        let current: Value = serde_json::from_slice(&fs::read(&ready_file).unwrap()).unwrap();
        assert_eq!(
            current["serverProfile"], profile,
            "restart must preserve the descriptor profile rather than inherit the invoking shell"
        );
        cleanup.stop();
    }
}

/// A live dev descriptor and its planted or genuine `sbdev_` sidecar are not
/// lifecycle authority. Without the owner-only administrator credential,
/// both direct stop and restart refuse and leave the server running.
#[test]
fn snapback_restart_cli_refuses_dev_descriptor_without_admin_credential() {
    let binary = env!("CARGO_BIN_EXE_snapback");
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("dev-refusal.sqlite3");
    let ready_file = directory.path().join("dev-refusal.ready.json");
    let mut initial = std::process::Command::new(binary)
        .args(["start", "--port", "0", "--db"])
        .arg(&database)
        .arg("--ready-file")
        .arg(&ready_file)
        .env_remove("SNAPBACK_ADMIN_TOKEN")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .unwrap();
    let previous = wait_for_cli_ready(&mut initial, &ready_file);
    assert_eq!(previous.server_profile.as_deref(), Some("dev"));
    assert!(previous.dev_identity_capability_file.is_some());
    let previous_nonce = previous.startup_nonce.clone().unwrap();
    let token_file = snapback::admin::admin_token_sibling(&database);
    let token_backup = directory.path().join("dev-refusal.admin-token.backup");
    fs::rename(&token_file, &token_backup).unwrap();

    let refused = std::process::Command::new(binary)
        .args(["restart", "--ready-file"])
        .arg(&ready_file)
        .arg("--reason")
        .arg("dev-descriptor-is-not-authority")
        .env_remove("SNAPBACK_ADMIN_TOKEN")
        .output()
        .unwrap();
    assert!(!refused.status.success());
    let receipt: Value = serde_json::from_slice(&refused.stdout).unwrap();
    assert_eq!(
        receipt["diagnostics"][0]["code"],
        "SNAPBACK_HOST_RESTART_ADMIN_CREDENTIAL_REQUIRED"
    );
    assert_eq!(
        receipt["diagnostics"][0]["details"].get("adminDiagnosticCodes"),
        None
    );
    assert!(
        receipt["diagnostics"][0]["details"]["sanctionedDevAlternative"]
            .as_str()
            .is_some_and(|alternative| {
                alternative.contains("Ctrl-C")
                    && alternative.contains("snapback restart --ready-file")
            }),
        "the refusal must name the exact sanctioned alternative: {receipt}"
    );
    let after_refusal: Value = serde_json::from_slice(&fs::read(&ready_file).unwrap()).unwrap();
    assert_eq!(after_refusal["startupNonce"], previous_nonce);
    assert!(initial.try_wait().unwrap().is_none());

    let stopped = std::process::Command::new(binary)
        .args(["stop", "--ready-file"])
        .arg(&ready_file)
        .env_remove("SNAPBACK_ADMIN_TOKEN")
        .output()
        .unwrap();
    assert!(!stopped.status.success());
    let stop_receipt: Value = serde_json::from_slice(&stopped.stdout).unwrap();
    assert_eq!(
        stop_receipt["diagnostics"][0]["code"],
        "SNAPBACK_HOST_STOP_ADMIN_CREDENTIAL_REQUIRED"
    );
    assert!(initial.try_wait().unwrap().is_none());

    fs::rename(&token_backup, &token_file).unwrap();
    // Reap concurrently so the CLI can observe ESRCH rather than a zombie
    // retained by this test process after the authenticated self-stop.
    let reaper = std::thread::spawn(move || initial.wait().unwrap());
    let stopped = std::process::Command::new(binary)
        .args(["stop", "--ready-file"])
        .arg(&ready_file)
        .env_remove("SNAPBACK_ADMIN_TOKEN")
        .output()
        .unwrap();
    assert!(
        stopped.status.success(),
        "{}",
        String::from_utf8_lossy(&stopped.stdout)
    );
    assert!(reaper.join().unwrap().success());
    let stop_receipt: Value = serde_json::from_slice(&stopped.stdout).unwrap();
    assert_eq!(stop_receipt["ok"], true, "{stop_receipt}");
    assert_eq!(stop_receipt["authority"], Value::Null);
    let stop_data = stop_receipt["data"]
        .as_object()
        .expect("positive stop observation data");
    assert_eq!(stop_data.len(), 3, "{stop_receipt}");
    assert_eq!(stop_data["credentialedHostOpResultAccepted"], true);
    assert_eq!(stop_data["configuredUrlStoppedAnswering"], true);
    assert_eq!(stop_data["processIdentityVerified"], true);
    assert_eq!(stop_data.get("pid"), None);
    assert_eq!(stop_data.get("verifiedBy"), None);
}

#[test]
fn snapback_restart_cli_refuses_non_dev_target_without_admin_credential() {
    let binary = env!("CARGO_BIN_EXE_snapback");
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("prod-restart.sqlite3");
    let ready_file = directory.path().join("prod-restart.ready.json");
    let mut initial = std::process::Command::new(binary)
        .args(["start", "--port", "0", "--db"])
        .arg(&database)
        .arg("--ready-file")
        .arg(&ready_file)
        .env("SNAPBACK_PROFILE", "prod")
        .env_remove("SNAPBACK_ADMIN_TOKEN")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .unwrap();
    let previous = wait_for_cli_ready(&mut initial, &ready_file);
    let mut cleanup = RestartServerGuard {
        binary,
        ready_file: ready_file.clone(),
        active: true,
    };
    assert!(
        previous.dev_identity_capability_file.is_none(),
        "production must not advertise development descriptor authority"
    );
    assert_eq!(previous.server_profile.as_deref(), Some("prod"));
    let previous_nonce = previous.startup_nonce.clone().unwrap();
    let token_file = snapback::admin::admin_token_sibling(&database);
    let token_backup = directory.path().join("prod-restart.admin-token.backup");
    fs::rename(&token_file, &token_backup).unwrap();

    let refused = std::process::Command::new(binary)
        .args(["restart", "--ready-file"])
        .arg(&ready_file)
        .arg("--reason")
        .arg("non-dev-credential-negative")
        .env("SNAPBACK_PROFILE", "prod")
        .env_remove("SNAPBACK_ADMIN_TOKEN")
        .output()
        .unwrap();
    assert!(!refused.status.success());
    let receipt: Value = serde_json::from_slice(&refused.stdout).unwrap();
    assert_eq!(receipt["operation"], "host.restart");
    assert_eq!(receipt["ok"], false);
    assert_eq!(
        receipt["diagnostics"][0]["code"],
        "SNAPBACK_HOST_RESTART_ADMIN_CREDENTIAL_REQUIRED"
    );
    assert_eq!(
        receipt["diagnostics"][0]["details"].get("adminDiagnosticCodes"),
        None
    );
    assert!(
        receipt["diagnostics"][0]["details"]["sanctionedDevAlternative"]
            .as_str()
            .is_some_and(|alternative| {
                alternative.contains("Ctrl-C")
                    && alternative.contains("snapback restart --ready-file")
            }),
        "the refusal must name the sanctioned descriptor-owned alternative: {receipt}"
    );
    let after_refusal: Value = serde_json::from_slice(&fs::read(&ready_file).unwrap()).unwrap();
    assert_eq!(after_refusal["startupNonce"], previous_nonce);

    fs::rename(&token_backup, &token_file).unwrap();
    cleanup.stop();
    let _ = initial.wait();
}

fn generated(file: &str) -> Value {
    let path = PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."))
        .join("demos/todo/snapback/generated")
        .join(file);
    serde_json::from_str(&fs::read_to_string(path).expect("read generated artifact"))
        .expect("parse generated artifact")
}

fn request(body: Value) -> HostOpsRequest {
    serde_json::from_value(body).expect("host-ops request parses")
}

fn envelope(snapback: &mut LocalSnapback, body: Value) -> Value {
    let result = execute_host_op(
        snapback,
        request(body),
        Some("http://127.0.0.1:0".to_owned()),
    );
    serde_json::to_value(&result).expect("envelope serializes")
}

fn github_heading_slug(heading: &str) -> String {
    let mut slug = String::new();
    let mut separator_pending = false;
    for character in heading.trim().chars() {
        if character.is_ascii_alphanumeric() {
            if separator_pending && !slug.is_empty() && !slug.ends_with('-') {
                slug.push('-');
            }
            separator_pending = false;
            slug.push(character.to_ascii_lowercase());
        } else if character.is_ascii_whitespace() || character == '-' {
            separator_pending = true;
        }
    }
    slug
}

#[test]
fn mint_session_catalog_contract_and_served_guide_anchor_stay_in_lockstep() {
    let root = PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."));
    let overrides: Value = serde_json::from_str(
        &fs::read_to_string(root.join("control-catalog/operability-overrides.json"))
            .expect("read operability overrides"),
    )
    .expect("parse operability overrides");
    let mint = &overrides["overrides"]["auth.mintSession"];
    let guide = mint["guide"].as_str().expect("mint guide anchor");
    assert_eq!(guide, "operating/host-ops.md#mint-a-session-over-http");

    let (guide_path, expected_slug) = guide.split_once('#').expect("guide fragment");
    let guide_source =
        fs::read_to_string(root.join("guide").join(guide_path)).expect("read host-ops guide");
    let mint_heading = guide_source
        .lines()
        .find_map(|line| {
            line.strip_prefix("## ")
                .filter(|heading| heading.contains("Mint a session") && heading.contains("HTTP"))
        })
        .expect("mint HTTP heading");
    assert_eq!(github_heading_slug(mint_heading), expected_slug);
    assert_eq!(
        format!("/_snapback/guide/{guide}"),
        "/_snapback/guide/operating/host-ops.md#mint-a-session-over-http"
    );

    let input = &mint["inputSchema"];
    assert_eq!(input["type"], "object");
    assert_eq!(input["additionalProperties"], false);
    assert_eq!(input["required"], json!(["email"]));
    assert_eq!(input["properties"].as_object().unwrap().len(), 1);
    assert_eq!(input["properties"]["email"]["type"], "string");
    assert_eq!(input["properties"]["email"]["minLength"], 1);
    assert!(
        input["description"]
            .as_str()
            .is_some_and(|description| description.contains("args object"))
    );
}

#[test]
fn cron_list_host_operation_is_a_narrow_read_only_projection() {
    let mut snapback = LocalSnapback::memory().expect("cron-list fixture");
    let listed = envelope(&mut snapback, json!({ "operation": "cron.list" }));
    assert_eq!(listed["ok"], true, "{listed}");
    assert_eq!(listed["operation"], "cron.list");
    assert_eq!(
        listed["data"]["cron"]["artifactKind"],
        "snapback.cron-list/v1"
    );
    assert!(listed["data"]["cron"]["jobs"].is_array());
    assert!(listed["data"]["cron"].get("recentRuns").is_none());
    assert!(listed["data"]["cron"].get("diagnostics").is_none());
}

#[tokio::test]
async fn cron_list_get_alias_enforces_admin_read_and_returns_the_same_dto() {
    let operation = snapback::server::operation_registry()
        .into_iter()
        .find(|operation| operation.operation == "host_ops.cron.list")
        .expect("cron.list host operation registration");
    assert_eq!(
        operation.path_policy,
        snapback::server::RoutePolicy::AdminRead
    );
    assert_eq!(
        operation.response_sensitivity,
        snapback::server::ResponseSensitivity::OperatorMetadata
    );

    let listener = std::net::TcpListener::bind("0.0.0.0:0").unwrap();
    let mut context = ServerContext::from_bound_listener(&listener).unwrap();
    context.profile = ServerProfile::Test;
    context.admin_token = Some("cron-admin".to_owned());
    let test_app = snapback::server::app(test_app_state_from_snapback(
        LocalSnapback::memory().expect("cron-list HTTP fixture"),
        context,
    ));

    let refused = test_app
        .clone()
        .oneshot(admin_get("/_snapback/api/cron", None))
        .await
        .unwrap();
    assert!(matches!(
        refused.status(),
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN
    ));

    let accepted = test_app
        .oneshot(admin_get("/_snapback/api/cron", Some("cron-admin")))
        .await
        .unwrap();
    assert_eq!(accepted.status(), StatusCode::OK);
    let listed = response_json(accepted).await;
    assert_eq!(listed["artifactKind"], "snapback.cron-list/v1");
    assert!(listed["jobs"].is_array());
    assert!(listed.get("recentRuns").is_none());
    assert!(listed.get("diagnostics").is_none());
}

fn assert_reset_projection_unavailable(result: &Value) {
    assert_eq!(result["ok"], json!(false), "app.reset: {result}");
    assert_eq!(result["data"], json!({}), "app.reset: {result}");
    assert_eq!(
        result["diagnostics"][0]["code"],
        json!("SNAPBACK_AUTH_PROJECTION_UNAVAILABLE"),
        "app.reset: {result}"
    );
}

fn host_ops_http_request(token: &str, body: Value) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri("/_snapback/api/host-ops")
        .header(header::CONTENT_TYPE, "application/json")
        .header("x-snapback-admin-token", token)
        .body(Body::from(serde_json::to_vec(&body).unwrap()))
        .unwrap()
}

async fn response_json(response: snapback_server::test_support::axum::response::Response) -> Value {
    serde_json::from_slice(
        &to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("host-ops response body"),
    )
    .expect("host-ops response JSON")
}

fn admin_get(path: &str, token: Option<&str>) -> Request<Body> {
    let mut request = Request::builder().method("GET").uri(path);
    if let Some(token) = token {
        request = request.header("x-snapback-admin-token", token);
    }
    request.body(Body::empty()).unwrap()
}

#[tokio::test]
async fn build_and_instance_control_catalogs_are_admin_read_gated_and_identity_bound() {
    let catalog_routes = snapback::server::route_registry()
        .into_iter()
        .filter(|route| route.path.starts_with("/_snapback/api/control-catalog"))
        .collect::<Vec<_>>();
    assert_eq!(catalog_routes.len(), 3);
    assert!(catalog_routes.iter().all(|route| {
        route.class == snapback::server::RouteClass::SystemApi
            && route.path_policy == snapback::server::RoutePolicy::AdminRead
            && route.credential_resolution
                == snapback::server::CredentialResolution::AdminCredential
            && route.invocation_authority == snapback::server::InvocationAuthority::Operator
            && route.response_sensitivity == snapback::server::ResponseSensitivity::OperatorMetadata
    }));

    // A non-loopback-bound context disables the local read bypass, proving
    // the declared AdminRead credential floor rather than only inspecting it.
    let listener = std::net::TcpListener::bind("0.0.0.0:0").unwrap();
    let mut context = ServerContext::from_bound_listener(&listener).unwrap();
    context.profile = ServerProfile::Test;
    context.admin_token = Some("catalog-admin".to_owned());
    let state =
        test_app_state_from_snapback(LocalSnapback::memory().expect("catalog fixture"), context)
            .with_server_startup_nonce("catalog-startup-nonce")
            .unwrap();
    let test_app = snapback::server::app(state);

    let refused = test_app
        .clone()
        .oneshot(admin_get("/_snapback/api/control-catalog", None))
        .await
        .unwrap();
    assert!(
        matches!(
            refused.status(),
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN
        ),
        "an exposed catalog route must refuse without administrator authority"
    );

    let build = test_app
        .clone()
        .oneshot(admin_get(
            "/_snapback/api/control-catalog",
            Some("catalog-admin"),
        ))
        .await
        .unwrap();
    assert_eq!(build.status(), StatusCode::OK);
    let header_digest = build
        .headers()
        .get(snapback::control_catalog::CATALOG_DIGEST_HEADER)
        .unwrap()
        .to_str()
        .unwrap()
        .to_owned();
    let build_bytes = to_bytes(build.into_body(), usize::MAX).await.unwrap();
    assert_eq!(
        build_bytes.as_ref(),
        snapback::control_catalog::BUILD_CATALOG_BYTES,
        "the HTTP build catalog must be the exact bytes embedded in the binary"
    );
    let build_json: Value = serde_json::from_slice(&build_bytes).unwrap();
    assert_eq!(build_json["catalogDigest"], header_digest);

    let instance = test_app
        .clone()
        .oneshot(admin_get(
            "/_snapback/api/control-catalog/instance",
            Some("catalog-admin"),
        ))
        .await
        .unwrap();
    assert_eq!(instance.status(), StatusCode::OK);
    let instance = response_json(instance).await;
    assert_eq!(
        instance["schemaVersion"],
        "snapback.control-catalog-instance.v1"
    );
    assert_eq!(instance["catalogDigest"], build_json["catalogDigest"]);
    assert_eq!(instance["startupNonce"], "catalog-startup-nonce");
    assert_eq!(instance["target"], "local");
    assert_eq!(instance["profile"], "test");
    assert!(
        instance["enabledCapabilities"]
            .as_array()
            .unwrap()
            .iter()
            .any(|operation| operation == "debug.networkProfileGet")
    );
    snapback::control_catalog::require_matching_identity(&build_json, &instance).unwrap();

    let described = test_app
        .oneshot(admin_get(
            "/_snapback/api/control-catalog/operations/debug.networkProfileSet",
            Some("catalog-admin"),
        ))
        .await
        .unwrap();
    assert_eq!(described.status(), StatusCode::OK);
    let described = response_json(described).await;
    assert_eq!(described["catalogDigest"], build_json["catalogDigest"]);
    assert_eq!(described["entry"]["operation"], "debug.networkProfileSet");
}

#[tokio::test]
async fn network_profile_ops_share_the_activation_gate_and_standard_envelope() {
    let mut test_context = ServerContext::detached();
    test_context.profile = ServerProfile::Test;
    test_context.admin_token = Some("host-ops-network-test".to_owned());
    let test_app = snapback::server::app(test_app_state_from_snapback(
        LocalSnapback::memory().expect("test-profile fixture"),
        test_context,
    ));

    let initial = test_app
        .clone()
        .oneshot(host_ops_http_request(
            "host-ops-network-test",
            json!({
                "schemaVersion": "snapback.v0",
                "requestId": "hop_network_get_1",
                "operation": "debug.networkProfileGet"
            }),
        ))
        .await
        .unwrap();
    assert_eq!(initial.status(), StatusCode::OK);
    let initial = response_json(initial).await;
    assert_eq!(initial["schemaVersion"], "snapback.v0");
    assert_eq!(initial["resultKind"], "hostOpsResult");
    assert_eq!(initial["requestId"], "hop_network_get_1");
    assert_eq!(initial["operation"], "debug.networkProfileGet");
    assert_eq!(initial["ok"], true, "registered get: {initial}");
    assert_eq!(initial["data"]["profile"]["name"], "normal");

    let set = test_app
        .clone()
        .oneshot(host_ops_http_request(
            "host-ops-network-test",
            json!({
                "schemaVersion": "snapback.v0",
                "requestId": "hop_network_set_1",
                "operation": "debug.networkProfileSet",
                "input": "optimistic"
            }),
        ))
        .await
        .unwrap();
    assert_eq!(set.status(), StatusCode::OK);
    let set = response_json(set).await;
    assert_eq!(set["resultKind"], "hostOpsResult");
    assert_eq!(set["requestId"], "hop_network_set_1");
    assert_eq!(set["operation"], "debug.networkProfileSet");
    assert_eq!(set["ok"], true, "registered set: {set}");
    assert_eq!(set["data"]["profile"]["name"], "optimistic");
    assert_eq!(set["data"]["provenance"]["source"], "host-ops");
    assert_ne!(
        set["diagnostics"]
            .get(0)
            .and_then(|entry| entry.get("code")),
        Some(&json!("SNAPBACK_HOST_OP_UNIMPLEMENTED"))
    );

    let inline = test_app
        .clone()
        .oneshot(host_ops_http_request(
            "host-ops-network-test",
            json!({
                "operation": "debug.networkProfileSet",
                "input": {
                    "name": "inline-zero",
                    "mutationAckDelayMs": 0,
                    "liveDeltaDelayMs": 0,
                    "queryResponseDelayMs": 0,
                    "jitterMs": 0
                }
            }),
        ))
        .await
        .unwrap();
    let inline = response_json(inline).await;
    assert_eq!(inline["ok"], true, "inline set: {inline}");
    assert_eq!(inline["data"]["profile"]["name"], "inline-zero");

    let active = test_app
        .oneshot(host_ops_http_request(
            "host-ops-network-test",
            json!({ "operation": "debug.networkProfileGet" }),
        ))
        .await
        .unwrap();
    let active = response_json(active).await;
    assert_eq!(active["data"], inline["data"]);

    let mut prod_context = ServerContext::detached();
    prod_context.profile = ServerProfile::Prod;
    prod_context.admin_token = Some("host-ops-network-prod".to_owned());
    let prod_app = snapback::server::app(test_app_state_from_snapback(
        LocalSnapback::memory().expect("prod-profile fixture"),
        prod_context,
    ));
    let forbidden = prod_app
        .oneshot(host_ops_http_request(
            "host-ops-network-prod",
            json!({
                "requestId": "hop_network_prod_1",
                "operation": "debug.networkProfileSet",
                "input": "optimistic"
            }),
        ))
        .await
        .unwrap();
    assert_eq!(forbidden.status(), StatusCode::OK);
    let forbidden = response_json(forbidden).await;
    assert_eq!(forbidden["resultKind"], "hostOpsResult");
    assert_eq!(forbidden["requestId"], "hop_network_prod_1");
    assert_eq!(forbidden["operation"], "debug.networkProfileSet");
    assert_eq!(forbidden["ok"], false);
    assert_eq!(
        forbidden["diagnostics"][0]["code"],
        "SNAPBACK_NETWORK_PROFILE_FORBIDDEN"
    );
}

#[tokio::test]
async fn principal_bearing_mcp_profile_set_records_authenticated_provenance() {
    let (registry, operator) = ImpersonationCapabilityRegistry::generate(
        "host-ops-network-principal".to_owned(),
        &OsRandom,
    )
    .expect("generate process-bound impersonation capability");
    let mut capability = None;
    operator
        .emit_once_to_terminal(|value| {
            capability = Some(value.to_owned());
            Ok(())
        })
        .expect("capture fixture capability");

    let mut context = ServerContext::detached();
    context.profile = ServerProfile::Test;
    context.admin_token = Some("host-ops-network-principal".to_owned());
    let app = snapback::server::app(
        test_app_state_from_snapback(
            LocalSnapback::memory().expect("principal profile fixture"),
            context,
        )
        .with_impersonation_capabilities(registry),
    );
    let request = Request::builder()
        .method("POST")
        .uri("/_snapback/api/host-ops")
        .header(header::CONTENT_TYPE, "application/json")
        .header("x-snapback-admin-token", "host-ops-network-principal")
        .header(
            IMPERSONATION_CAPABILITY_HEADER,
            capability.expect("fixture capability"),
        )
        .header("x-snapback-network-profile-source", "mcp")
        .body(Body::from(
            serde_json::to_vec(&json!({
                "operation": "debug.networkProfileSet",
                "userId": "operator:principal-test",
                "input": "optimistic"
            }))
            .unwrap(),
        ))
        .unwrap();
    let response = app.oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let response = response_json(response).await;
    assert_eq!(response["ok"], true, "principal-bearing set: {response}");
    assert_eq!(response["data"]["provenance"]["source"], "mcp");
    assert_eq!(
        response["data"]["provenance"]["principal"],
        "operator:principal-test"
    );
}

#[test]
fn p6_served_ops_round_trip_through_envelopes() {
    let mut snapback = LocalSnapback::memory().expect("memory snapback");

    // schema.load
    let loaded = envelope(
        &mut snapback,
        json!({ "operation": "schema.load", "schema": generated("schema.manifest.json") }),
    );
    assert_eq!(loaded["ok"], json!(true), "schema.load: {loaded}");
    assert_eq!(loaded["resultKind"], json!("hostOpsResult"));
    assert_eq!(loaded["operation"], json!("schema.load"));
    assert!(
        loaded["artifacts"]["schemaHash"].is_string(),
        "schema hash reported"
    );
    assert_eq!(loaded["target"]["appId"], json!("todo"));
    assert_eq!(
        loaded["target"]["targetProfile"],
        json!("local-dev-sqlite-ibex")
    );

    // functions.load
    let functions = envelope(
        &mut snapback,
        json!({ "operation": "functions.load", "functions": generated("functions.manifest.json") }),
    );
    assert_eq!(functions["ok"], json!(true), "functions.load: {functions}");
    assert!(
        functions["artifacts"]["bundleHash"].is_string(),
        "bundle hash reported"
    );
    assert!(functions["data"]["functionCount"].as_u64().unwrap() >= 4);

    // A raw host-op reset has no authorization-stream coordinator and must
    // fail closed without applying its otherwise-valid seed.
    let seed_path = PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."))
        .join("demos/todo/snapback/seed.json");
    let seed: Value =
        serde_json::from_str(&fs::read_to_string(seed_path).expect("read seed")).expect("seed");
    let before_reset = functions["artifacts"]["databaseVersion"].clone();
    let reset = envelope(
        &mut snapback,
        json!({ "operation": "app.reset", "seed": seed }),
    );
    assert_reset_projection_unavailable(&reset);
    assert_eq!(reset["artifacts"]["databaseVersion"], before_reset);

    // function.run — a query as a dev user. The rejected reset did not seed.
    let query = envelope(
        &mut snapback,
        json!({ "operation": "function.run", "function": "listTodos", "userId": "user_ada" }),
    );
    assert_eq!(query["ok"], json!(true), "function.run query: {query}");
    assert_eq!(query["authority"]["mode"], json!("devUser"));
    assert!(
        query["data"]["functionResult"]["rows"].is_array(),
        "query rows present"
    );
    assert_eq!(query["data"]["functionResult"]["rows"], json!([]));
    // LLP 0146 D1: the query envelope carries the conformance report with
    // authoritative read provenance on success.
    assert_eq!(
        query["data"]["conformance"]["readProvenance"],
        json!("complete"),
        "function.run query envelope carries D1 conformance: {query}"
    );
    assert!(query["data"]["conformance"]["missingReads"].is_array());

    // function.run — a mutation, then observe the version advance
    let before = query["artifacts"]["databaseVersion"].as_u64().unwrap();
    let mutation = envelope(
        &mut snapback,
        json!({
            "operation": "function.run",
            "function": "createTodo",
            "args": { "title": "from host-ops" },
            "userId": "user_ada",
        }),
    );
    assert_eq!(
        mutation["ok"],
        json!(true),
        "function.run mutation: {mutation}"
    );
    assert!(mutation["data"]["mutationCommit"].is_object());
    assert_eq!(
        mutation["data"]["conformance"]["readProvenance"],
        json!("complete"),
        "function.run mutation preserves its captured-read provenance: {mutation}"
    );
    assert_eq!(
        mutation["data"]["conformance"]["writeProvenance"],
        json!("complete"),
        "function.run mutation preserves its captured-write provenance: {mutation}"
    );
    assert!(mutation["artifacts"]["databaseVersion"].as_u64().unwrap() > before);

    // app.inspect
    let inspect = envelope(&mut snapback, json!({ "operation": "app.inspect" }));
    assert_eq!(inspect["ok"], json!(true));
    assert_eq!(
        inspect["data"]["runtimeState"]["artifactKind"],
        json!("runtimeState"),
        "runtime state rides data.runtimeState"
    );
    assert!(
        inspect["data"]["runtimeState"]["capabilityManifest"].is_object(),
        "capability manifest rides the runtime state"
    );
}

#[test]
fn host_ops_reset_fails_closed_before_seed_validation() {
    let mut snapback = LocalSnapback::memory().unwrap();
    let loaded = envelope(
        &mut snapback,
        json!({ "operation": "schema.load", "schema": generated("schema.manifest.json") }),
    );
    assert_eq!(loaded["ok"], true);
    let functions = envelope(
        &mut snapback,
        json!({ "operation": "functions.load", "functions": generated("functions.manifest.json") }),
    );
    assert_eq!(functions["ok"], true);
    let created = envelope(
        &mut snapback,
        json!({
            "operation": "function.run",
            "function": "createTodo",
            "args": { "title": "preserved" },
            "userId": "user_1"
        }),
    );
    assert_eq!(created["ok"], true, "create fixture: {created}");
    let before = snapback.scan_table("todos", 100, 0).unwrap();
    assert_eq!(before.rows.len(), 1);
    let version_before = snapback.durable_version().unwrap();

    let rejected = envelope(
        &mut snapback,
        json!({
            "operation": "app.reset",
            "seed": { "tables": { "todos": [
                { "_id": "valid-prefix", "title": "valid", "completed": false, "userId": "user_1" },
                { "_id": "bad", "title": null, "completed": false, "userId": "user_1" }
            ] } }
        }),
    );
    assert_reset_projection_unavailable(&rejected);
    assert_eq!(snapback.durable_version().unwrap(), version_before);
    assert_eq!(
        snapback.scan_table("todos", 100, 0).unwrap().rows,
        before.rows,
        "host-ops must preserve the database when reset projection is unavailable"
    );
}

#[test]
fn p6_unserved_ops_fail_closed_with_structured_envelopes() {
    let mut snapback = LocalSnapback::memory().expect("memory snapback");

    let unknown = envelope(&mut snapback, json!({ "operation": "app.nonsense" }));
    assert_eq!(unknown["ok"], json!(false));
    assert_eq!(
        unknown["diagnostics"][0]["code"],
        json!("SNAPBACK_HOST_OP_UNKNOWN")
    );
    assert!(
        unknown["diagnostics"][0]["details"]["candidateOperations"]
            .as_array()
            .unwrap()
            .iter()
            .any(|operation| operation == "app.inspect")
    );
    let remediation = &unknown["diagnostics"][0]["details"]["remediationSet"];
    assert_eq!(remediation["schemaVersion"], "snapback.remediation-set.v1");
    assert_eq!(
        remediation["registryVersion"],
        "snapback.remediation-kinds.v1"
    );
    assert_eq!(
        remediation["artifactHash"],
        unknown["diagnostics"][0]["details"]["artifactHash"]
    );
    assert!(remediation["items"].as_array().unwrap().iter().any(|item| {
        item["action"]["replacement"] == "app.inspect"
            && item["precondition"]["artifactHash"] == remediation["artifactHash"]
    }));
    assert_eq!(
        unknown["diagnostics"][0]["details"]["localMissSummary"]["capacity"],
        128
    );

    let pinned = envelope(&mut snapback, json!({ "operation": "schema.reload" }));
    assert_eq!(pinned["ok"], json!(false));
    assert_eq!(
        pinned["diagnostics"][0]["code"],
        json!("SNAPBACK_HOST_OP_UNIMPLEMENTED")
    );

    // function.explain is served since ENG-23896, but only for the
    // mutationDryRun kind: a missing kind and the unbuilt kinds fail closed.
    let no_kind = envelope(&mut snapback, json!({ "operation": "function.explain" }));
    assert_eq!(no_kind["ok"], json!(false));
    assert_eq!(
        no_kind["diagnostics"][0]["code"],
        json!("SNAPBACK_HOST_OP_INPUT_MISSING")
    );

    let unbuilt_kind = envelope(
        &mut snapback,
        json!({ "operation": "function.explain", "kind": "queryPlan" }),
    );
    assert_eq!(unbuilt_kind["ok"], json!(false));
    assert_eq!(
        unbuilt_kind["diagnostics"][0]["code"],
        json!("SNAPBACK_EXPLAIN_KIND_UNIMPLEMENTED")
    );

    let unknown_kind = envelope(
        &mut snapback,
        json!({ "operation": "function.explain", "kind": "vibeCheck" }),
    );
    assert_eq!(unknown_kind["ok"], json!(false));
    assert_eq!(
        unknown_kind["diagnostics"][0]["code"],
        json!("SNAPBACK_EXPLAIN_KIND_UNKNOWN")
    );

    let cli_only = envelope(&mut snapback, json!({ "operation": "host.start" }));
    assert_eq!(cli_only["ok"], json!(false));
    assert_eq!(
        cli_only["diagnostics"][0]["code"],
        json!("SNAPBACK_HOST_OP_CLI_ONLY")
    );
    assert!(
        cli_only["diagnostics"][0]["message"]
            .as_str()
            .unwrap()
            .contains("snapback start")
    );
    assert_eq!(
        cli_only["next"],
        json!([
            {
                "guide": "operating/host-ops.md#direct-climcp-projections-beyond-host-ops-llp-0184-phase-2-p1",
                "reason": "read the operation's build-bound Guide acquisition path"
            },
            {
                "command": "snapback start",
                "reason": "retry through the operation's shipped CLI projection"
            }
        ])
    );

    let missing_input = envelope(&mut snapback, json!({ "operation": "schema.load" }));
    assert_eq!(missing_input["ok"], json!(false));
    assert_eq!(
        missing_input["diagnostics"][0]["code"],
        json!("SNAPBACK_HOST_OP_INPUT_MISSING")
    );

    let unknown_function = envelope(
        &mut snapback,
        json!({ "operation": "function.run", "function": "nope" }),
    );
    assert_eq!(unknown_function["ok"], json!(false));
    assert_eq!(
        unknown_function["diagnostics"][0]["code"],
        json!("SNAPBACK_HOST_OP_FUNCTION_UNKNOWN")
    );

    // A request id supplied by the caller is echoed.
    let echoed = envelope(
        &mut snapback,
        json!({ "operation": "app.inspect", "requestId": "hop_fixed" }),
    );
    assert_eq!(echoed["requestId"], json!("hop_fixed"));
}

#[test]
fn served_function_refusals_project_manifest_candidates_and_argument_contracts() {
    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    let loaded = envelope(
        &mut snapback,
        json!({ "operation": "schema.load", "schema": generated("schema.manifest.json") }),
    );
    assert_eq!(loaded["ok"], true, "load schema: {loaded}");
    let loaded = envelope(
        &mut snapback,
        json!({ "operation": "functions.load", "functions": generated("functions.manifest.json") }),
    );
    assert_eq!(loaded["ok"], true, "load functions: {loaded}");

    let mut unknown = Value::Null;
    for _ in 0..3 {
        unknown = envelope(
            &mut snapback,
            json!({ "operation": "function.run", "function": "listTods", "args": {} }),
        );
    }
    let details = &unknown["diagnostics"][0]["details"];
    assert_eq!(
        unknown["diagnostics"][0]["code"],
        "SNAPBACK_HOST_OP_FUNCTION_UNKNOWN"
    );
    assert_eq!(details["candidateFunctions"][0]["name"], "listTodos");
    assert_eq!(details["candidateFunctions"][0]["kind"], "LiveQuery");
    assert_eq!(
        details["artifactHash"],
        generated("functions.manifest.json")["bundleHash"]
    );
    assert_eq!(
        details["remediationSet"]["artifactHash"],
        details["artifactHash"]
    );
    assert_eq!(
        details["remediationSet"]["items"][0]["precondition"]["artifactHash"],
        details["artifactHash"]
    );
    assert_eq!(
        details["remediationSet"]["items"][0]["action"]["replacement"],
        "listTodos"
    );
    assert!(
        details["localMissSummary"]["sameMissCount"]
            .as_u64()
            .unwrap()
            >= 3
    );
    assert!(
        !serde_json::to_string(&unknown)
            .unwrap()
            .contains("listTods")
    );

    let unknown_field = envelope(
        &mut snapback,
        json!({
            "operation": "function.run",
            "function": "createTodo",
            "args": { "titel": "not disclosed" },
            "userId": "user_1"
        }),
    );
    let details = &unknown_field["diagnostics"][0]["details"];
    assert_eq!(
        unknown_field["diagnostics"][0]["code"],
        "SNAPBACK_FUNCTION_ARGS_CONTRACT_VIOLATION"
    );
    assert_eq!(details["candidateFields"][0]["name"], "title");
    assert_eq!(details["candidateFields"][0]["expected"], "string");
    assert_eq!(
        details["remediationSet"]["items"][0]["action"]["replacement"],
        "title"
    );
    assert!(details["expectedArgumentContract"].is_object());
    assert!(
        !serde_json::to_string(&unknown_field)
            .unwrap()
            .contains("titel")
    );

    let wrong_shape = envelope(
        &mut snapback,
        json!({
            "operation": "function.run",
            "function": "createTodo",
            "args": { "title": 42 },
            "userId": "user_1"
        }),
    );
    let details = &wrong_shape["diagnostics"][0]["details"];
    assert_eq!(details["expected"], "string");
    assert_eq!(details["actual"], "number");
    assert_eq!(details["candidateFields"][0]["name"], "title");
    assert_eq!(details["candidateFields"][0]["expected"], "string");
}

/// @ref LLP 0146#oq6-author-ruling--2026-08-10 — apply compares and selects
/// the replacement in one host-operation turn; stale input has no effect.
#[test]
fn remediation_apply_is_generation_fenced_and_effect_free() {
    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    let artifact_hash =
        snapback::control_catalog::catalog_digest(snapback::control_catalog::build_catalog())
            .expect("embedded control catalog digest")
            .to_owned();
    let item = |hash: &str| {
        json!({
            "kind": "fixTypo",
            "riskClass": "mechanical",
            "machineApplicable": true,
            "requiresApproval": false,
            "authorityEffect": "none",
            "precondition": { "type": "artifact-hash", "artifactHash": hash },
            "action": {
                "type": "replaceIdentifier",
                "target": "hostOperation",
                "replacement": "app.inspect"
            }
        })
    };

    let fresh = envelope(
        &mut snapback,
        json!({
            "operation": "remediation.apply",
            "input": {
                "schemaVersion": "snapback.remediation-apply.v1",
                "artifactHash": artifact_hash,
                "item": item(&artifact_hash)
            }
        }),
    );
    assert_eq!(fresh["ok"], true, "{fresh}");
    assert_eq!(fresh["data"]["applied"], true);
    assert_eq!(fresh["data"]["replacement"]["value"], "app.inspect");

    let before = snapback
        .durable_version()
        .expect("version before stale apply");
    let stale_hash = "sha256:aaaaaaaaaaaaaaaa";
    let stale = envelope(
        &mut snapback,
        json!({
            "operation": "remediation.apply",
            "input": {
                "schemaVersion": "snapback.remediation-apply.v1",
                "artifactHash": stale_hash,
                "item": item(stale_hash)
            }
        }),
    );
    assert_eq!(stale["ok"], false, "{stale}");
    assert_eq!(
        stale["diagnostics"][0]["code"],
        "SNAPBACK_REMEDIATION_ARTIFACT_STALE"
    );
    assert_eq!(snapback.durable_version().unwrap(), before);
}

#[tokio::test]
async fn p6_ready_file_descriptor_is_written_and_validates() {
    let dir = tempfile::tempdir().expect("tempdir");
    let ready_path = dir.path().join("ready.json");
    let args = snapback::cli::Args {
        activate_startup_successor: false,
        host: "127.0.0.1".to_owned(),
        port: Some(0),
        port_range: None,
        db: PathBuf::from(".snapback/unused.sqlite3"),
        memory: true,
        ready_file: Some(ready_path.clone()),
        restored_from_backup: None,
        startup_artifacts: None,
        trusted_composition_activation: None,
        clear_desired_auth_mode: false,
        allow_auth_downgrade: false,
        allow_insecure_dev_auth: false,
        auth_deployment: snapback::auth::deployment::AuthDeploymentTarget::Local,
        hosted_edge: None,
        hosted_admission: None,
        cron_disabled: false,
        derived_fork_arm_writer_coverage: false,
    };
    let server = tokio::spawn(snapback::cli::run(args));

    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    while !ready_path.exists() {
        assert!(
            std::time::Instant::now() < deadline,
            "ready file never appeared"
        );
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
    }
    let value: Value =
        serde_json::from_str(&fs::read_to_string(&ready_path).expect("read ready file"))
            .expect("ready file is JSON");
    let descriptor =
        HostReadyDescriptor::validate(&value).expect("descriptor validates for attach");
    assert_eq!(descriptor.descriptor_kind, "snapbackHostReady");
    assert!(descriptor.ready);
    assert_eq!(descriptor.pid, std::process::id());
    assert!(descriptor.server_url.starts_with("http://127.0.0.1:"));
    assert_eq!(descriptor.database.mode, "memory");
    let dev_identity_path = descriptor
        .dev_identity_capability_file
        .as_deref()
        .map(PathBuf::from)
        .expect("memory serve advertises developer identity custody");
    assert_eq!(
        dev_identity_path,
        fs::canonicalize(dir.path())
            .unwrap()
            .join("ready.json.dev-identity")
    );
    assert!(dev_identity_path.exists());
    // The descriptor carries the same per-process nonce this process reports
    // on /health. Lifecycle presents the descriptor nonce to authenticated
    // host.stop; it never signals the descriptor PID.
    assert_eq!(
        descriptor.startup_nonce.as_deref(),
        Some(snapback::identity::binary_identity().startup_nonce.as_str())
    );

    // The attach validation actually rejects: a tampered descriptor fails.
    let mut tampered = value.clone();
    tampered["ready"] = json!(false);
    assert!(HostReadyDescriptor::validate(&tampered).is_err());

    server.abort();
    let _ = server.await;
    assert!(
        !dev_identity_path.exists(),
        "developer identity sidecar must not outlive ready descriptor custody"
    );
}

// Regression (0137 G1): the `<ready>.secret-read-root` proof root is named
// after and scoped to the ready descriptor, so descriptor custody teardown
// must remove it — a serve that dies without it previously orphaned a 0600
// token-like sidecar next to an already-deleted descriptor. The clean-signal
// shutdown path removes it through the same identity-guarded helper.
#[tokio::test]
async fn p6_secret_read_root_sidecar_does_not_survive_descriptor_custody() {
    let dir = tempfile::tempdir().expect("tempdir");
    let ready_path = dir.path().join("dev.ready.json");
    let args = snapback::cli::Args {
        activate_startup_successor: false,
        host: "127.0.0.1".to_owned(),
        port: Some(0),
        port_range: None,
        db: PathBuf::from(".snapback/unused.sqlite3"),
        memory: true,
        ready_file: Some(ready_path.clone()),
        restored_from_backup: None,
        startup_artifacts: None,
        trusted_composition_activation: None,
        clear_desired_auth_mode: false,
        allow_auth_downgrade: false,
        allow_insecure_dev_auth: false,
        auth_deployment: snapback::auth::deployment::AuthDeploymentTarget::Local,
        hosted_edge: None,
        hosted_admission: None,
        cron_disabled: false,
        derived_fork_arm_writer_coverage: false,
    };
    let server = tokio::spawn(snapback::cli::run(args));

    let root_path = dir.path().join("dev.ready.json.secret-read-root");
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    while !(ready_path.exists() && root_path.exists()) {
        assert!(
            std::time::Instant::now() < deadline,
            "ready descriptor and secret-read root never appeared"
        );
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
    }

    server.abort();
    let _ = server.await;
    assert!(
        !root_path.exists(),
        "secret-read root sidecar must not outlive its ready descriptor custody"
    );
}
