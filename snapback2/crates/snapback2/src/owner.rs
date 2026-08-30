//! `snapback2 dev`: compile, certify, own the store, serve, watch, and stop.
// @ref LLP 1002#5-the-owner — this process is the only store owner.

use crate::client;
use crate::project::{CompilerWorker, locate_root, seed_rows, write_build_cache};
use crate::protocol::Refusal;
use crate::serve::{BoundServer, Context as ServerContext};
use crate::watch;
#[cfg(not(feature = "effects"))]
use crate::writer::Action;
use crate::writer::{apply_seed, spawn_writer};
use serde::{Deserialize, Serialize};
use serde_json::{Value as Json, json};
use snapback2_core::{Runtime, Store};
use std::fs::{self, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[cfg(unix)]
static SIGNAL_RECEIVED: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnerInfo {
    pub pid: u32,
    pub port: u16,
    pub url: String,
    pub secret: String,
    pub generation: String,
    pub started_at: i64,
    pub mode: String,
    pub project: PathBuf,
}

#[derive(Clone, Debug, Default)]
pub struct DevOptions {
    pub project: Option<PathBuf>,
    pub port: u16,
    pub foreground: bool,
    pub owner_child: bool,
    pub serve: bool,
    pub stop: bool,
    pub status: bool,
    pub apply_migration: Option<PathBuf>,
    pub json: bool,
}

pub fn run(options: DevOptions) -> ExitCode {
    let root = match locate_root(options.project.as_deref()) {
        Ok(root) => root,
        Err(error) => return print_refusal(error, options.json, 2),
    };
    if options.stop {
        return control_command(
            &root,
            "POST",
            "/control/stop",
            json!({ "cause": "snapback2 dev --stop" }),
            options.json,
        );
    }
    if options.status {
        return control_command(&root, "GET", "/control/status", json!({}), options.json);
    }
    if let Some(path) = &options.apply_migration {
        let value: Json = match fs::read(path)
            .map_err(|error| error.to_string())
            .and_then(|bytes| serde_json::from_slice(&bytes).map_err(|error| error.to_string()))
        {
            Ok(value) => value,
            Err(error) => {
                return print_refusal(
                    Refusal::input(
                        format!("cannot read migration file {}: {error}", path.display()),
                        "pass a .snapback/migration-<generation>.json file",
                    ),
                    options.json,
                    2,
                );
            }
        };
        return control_command(&root, "POST", "/control/migrate", value, options.json);
    }
    if let Some(info) = active_owner(&root) {
        print_url(&info, options.json);
        return ExitCode::SUCCESS;
    }
    if options.foreground {
        match foreground(root.clone(), &options) {
            Ok(()) => ExitCode::SUCCESS,
            Err(error) => {
                watch::log(
                    &root,
                    json!({ "exited": format!("fatal: {}", error.code), "refusal": error }),
                );
                let _ = fs::remove_file(owner_path(&root));
                print_refusal(error, options.json, 1)
            }
        }
    } else {
        detach(root, options)
    }
}

pub fn require_owner(root: &Path) -> Result<OwnerInfo, Refusal> {
    let had_owner_file = owner_path(root).is_file();
    active_owner(root).ok_or_else(|| {
        let message = if had_owner_file {
            format!(
                "stale owner.json removed; no owner is running for {}",
                root.display()
            )
        } else {
            format!("no owner is running for {}", root.display())
        };
        Refusal::owner("E_OWNER_NOT_RUNNING", message, "snapback2 dev")
    })
}

pub fn read_owner(root: &Path) -> Option<OwnerInfo> {
    serde_json::from_slice(&fs::read(owner_path(root)).ok()?).ok()
}

fn foreground(root: PathBuf, options: &DevOptions) -> Result<(), Refusal> {
    fs::create_dir_all(root.join(".snapback")).map_err(|error| {
        Refusal::owner(
            "E_OWNER_STORE",
            error.to_string(),
            "make .snapback writable",
        )
    })?;
    let mut compiler = CompilerWorker::spawn()?;
    let compiled = compiler.compile(&root).map_err(first)?;
    let seed = compiler.seed(&root).map_err(first)?;
    write_build_cache(&root, &compiled)?;
    let rows = seed_rows(&seed, &compiled)?;
    let store_path = root.join(".snapback/store.sqlite");
    let store = Store::open(&store_path).map_err(|error| Refusal::from_runtime(&error))?;
    let mut runtime = Runtime::open(store, compiled.generation.clone())
        .map_err(|error| Refusal::from_successor(&error))?;
    let now = unix_millis();
    for persona in &seed.personas {
        runtime
            .persona(persona, now)
            .map_err(|error| Refusal::from_identity(&error))?;
    }
    if runtime
        .store()
        .commit_seq()
        .map_err(|error| Refusal::from_runtime(&error))?
        == 0
        && !rows.is_empty()
    {
        apply_seed(&mut runtime, &rows)?;
    }
    let server = BoundServer::bind(options.port)?;
    let mode = if options.serve { "serve" } else { "dev" }.to_owned();
    let stop = Arc::new(AtomicBool::new(false));
    #[cfg(unix)]
    install_signal_exit(root.clone(), stop.clone());
    let handle = spawn_writer(
        runtime,
        compiled.clone(),
        seed,
        store_path,
        root.clone(),
        mode.clone(),
        stop.clone(),
    )?;
    #[cfg(feature = "effects")]
    let _effects = crate::effects::spawn(handle.clone());
    #[cfg(not(feature = "effects"))]
    handle.call(Action::OutboxMarkUnknown)?;
    let secret = random_secret()?;
    let url = format!("http://127.0.0.1:{}", server.port);
    let info = OwnerInfo {
        pid: std::process::id(),
        port: server.port,
        url: url.clone(),
        secret: secret.clone(),
        generation: compiled.generation.hash,
        started_at: unix_millis(),
        mode: mode.clone(),
        project: root.clone(),
    };
    write_owner(&root, &info)?;
    print_url(&info, options.json);
    std::io::stdout().flush().map_err(|error| {
        Refusal::owner(
            "E_OWNER_OUTPUT",
            error.to_string(),
            "run snapback2 dev again with a writable stdout",
        )
    })?;
    watch::log(
        &root,
        json!({
            "ready": {
                "pid": info.pid,
                "url": info.url,
                "generation": info.generation,
                "mode": info.mode,
                "project": info.project,
            }
        }),
    );
    let watcher = watch::spawn(compiler, root.clone(), handle.clone(), stop.clone());
    let server_result = server.run(ServerContext {
        handle,
        root: root.clone(),
        secret,
        mode,
        url,
        stop: stop.clone(),
    });
    stop.store(true, Ordering::SeqCst);
    if watcher.join().is_err() {
        watch::log(&root, json!({ "watcherError": "source watcher panicked" }));
    }
    if let Err(error) = fs::remove_file(owner_path(&root))
        && error.kind() != std::io::ErrorKind::NotFound
    {
        watch::log(&root, json!({ "ownerStateError": error.to_string() }));
    }
    if !options.owner_child {
        // A foreground owner must never return silently.
        println!("owner exited");
    }
    server_result
}

fn detach(root: PathBuf, options: DevOptions) -> ExitCode {
    let snapback = root.join(".snapback");
    if let Err(error) = fs::create_dir_all(&snapback) {
        return print_refusal(
            Refusal::owner("E_OWNER_LOG", error.to_string(), "make .snapback writable"),
            options.json,
            2,
        );
    }
    let log_path = snapback.join("log.jsonl");
    let log_start = fs::metadata(&log_path).map(|meta| meta.len()).unwrap_or(0);
    let log = match OpenOptions::new().create(true).append(true).open(&log_path) {
        Ok(file) => file,
        Err(error) => {
            return print_refusal(
                Refusal::owner(
                    "E_OWNER_LOG",
                    error.to_string(),
                    "make .snapback/log.jsonl writable",
                ),
                options.json,
                2,
            );
        }
    };
    let stderr = match log.try_clone() {
        Ok(file) => file,
        Err(error) => {
            return print_refusal(
                Refusal::owner(
                    "E_OWNER_LOG",
                    error.to_string(),
                    "make .snapback/log.jsonl writable",
                ),
                options.json,
                2,
            );
        }
    };
    let executable = match std::env::current_exe() {
        Ok(path) => path,
        Err(error) => {
            return print_refusal(
                Refusal::owner(
                    "E_OWNER_EXEC",
                    error.to_string(),
                    "rerun the snapback2 binary",
                ),
                options.json,
                2,
            );
        }
    };
    let mut command = Command::new(executable);
    command
        .arg("dev")
        .arg("--project")
        .arg(&root)
        .arg("--foreground")
        .arg("--owner-child")
        .arg("--json")
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(stderr))
        .current_dir(&root);
    if options.port != 0 {
        command.arg("--port").arg(options.port.to_string());
    }
    if options.serve {
        command.arg("--serve");
    }
    #[cfg(unix)]
    new_session(&mut command);
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            return print_refusal(
                Refusal::owner(
                    "E_OWNER_EXEC",
                    error.to_string(),
                    "run snapback2 dev --foreground to inspect startup",
                ),
                options.json,
                2,
            );
        }
    };
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(10) {
        if let Some(info) = active_owner(&root) {
            print_url(&info, options.json);
            return ExitCode::SUCCESS;
        }
        if let Ok(Some(status)) = child.try_wait() {
            let refusals = startup_refusals(&log_path, log_start);
            if !refusals.is_empty() {
                return print_refusal(first(refusals), options.json, 1);
            }
            return print_refusal(
                Refusal::owner(
                    "E_OWNER_START_FAILED",
                    format!("detached owner exited with {status}"),
                    "inspect .snapback/log.jsonl and rerun snapback2 dev --foreground",
                ),
                options.json,
                1,
            );
        }
        thread::sleep(Duration::from_millis(50));
    }
    let _ = child.kill();
    let _ = child.wait();
    print_refusal(
        Refusal::owner(
            "E_OWNER_START_TIMEOUT",
            "detached owner did not become ready within 10 seconds",
            "inspect .snapback/log.jsonl and run snapback2 dev --foreground",
        ),
        options.json,
        1,
    )
}

fn active_owner(root: &Path) -> Option<OwnerInfo> {
    let path = owner_path(root);
    if !path.is_file() {
        return None;
    }
    let Some(info) = read_owner(root) else {
        let _ = fs::remove_file(path);
        return None;
    };
    if !pid_is_running(info.pid) {
        let _ = fs::remove_file(path);
        return None;
    }
    let Some(response) = client::control(&info, "GET", "/control/status", json!({})).ok() else {
        let _ = fs::remove_file(path);
        return None;
    };
    if response.status != 200 {
        let _ = fs::remove_file(path);
        return None;
    }
    let Some(project) = response.body.get("project").and_then(Json::as_str) else {
        let _ = fs::remove_file(path);
        return None;
    };
    if Path::new(project) == root {
        Some(info)
    } else {
        let _ = fs::remove_file(path);
        None
    }
}

fn control_command(
    root: &Path,
    method: &str,
    path: &str,
    body: Json,
    json_output: bool,
) -> ExitCode {
    let info = match require_owner(root) {
        Ok(info) => info,
        Err(error) => return print_refusal(error, json_output, 1),
    };
    match client::control(&info, method, path, body) {
        Ok(response) => {
            if response.status < 400 {
                if path == "/control/stop" {
                    wait_for_pid_exit(info.pid, Duration::from_secs(2));
                }
                print_control_body(&response.body);
                ExitCode::SUCCESS
            } else {
                print_control_body(&response.body);
                ExitCode::from(1)
            }
        }
        Err(error) => print_refusal(error, json_output, 1),
    }
}

fn write_owner(root: &Path, info: &OwnerInfo) -> Result<(), Refusal> {
    let path = owner_path(root);
    let temporary = root.join(".snapback/owner.json.tmp");
    let bytes = serde_json::to_vec_pretty(info).map_err(|error| {
        Refusal::owner("E_OWNER_STATE", error.to_string(), "restart snapback2 dev")
    })?;
    fs::write(&temporary, bytes).map_err(|error| {
        Refusal::owner(
            "E_OWNER_STATE",
            error.to_string(),
            "make .snapback writable",
        )
    })?;
    fs::rename(&temporary, &path).map_err(|error| {
        Refusal::owner(
            "E_OWNER_STATE",
            error.to_string(),
            "make .snapback writable",
        )
    })
}

fn owner_path(root: &Path) -> PathBuf {
    root.join(".snapback/owner.json")
}

fn print_url(info: &OwnerInfo, json_output: bool) {
    if json_output {
        println!(
            "{}",
            json!({ "url": info.url, "generation": info.generation, "pid": info.pid })
        );
    } else {
        println!("SNAPBACK_URL={}", info.url);
    }
}

pub fn print_refusal(error: Refusal, json_output: bool, code: u8) -> ExitCode {
    let errors = error
        .detail
        .get("refusals")
        .and_then(Json::as_array)
        .cloned()
        .unwrap_or_else(|| vec![serde_json::to_value(&error).unwrap_or(Json::Null)]);
    for error in errors {
        let value = serde_json::to_string(&error).unwrap_or_default();
        if json_output {
            println!("{value}");
        } else {
            eprintln!("{value}");
        }
    }
    ExitCode::from(code)
}

fn first(errors: Vec<Refusal>) -> Refusal {
    Refusal::from_refusals(
        errors,
        Refusal::owner(
            "E_OWNER_COMPILER_PROTOCOL",
            "compiler failed without a refusal",
            "rerun snapback2 check",
        ),
    )
}

fn print_control_body(body: &Json) {
    if let Some(refusals) = body.get("refusals").and_then(Json::as_array) {
        for refusal in refusals {
            println!("{}", serde_json::to_string(refusal).unwrap_or_default());
        }
    } else {
        println!("{}", serde_json::to_string(body).unwrap_or_default());
    }
}

fn startup_refusals(path: &Path, offset: u64) -> Vec<Refusal> {
    let Ok(mut file) = fs::File::open(path) else {
        return Vec::new();
    };
    if file.seek(SeekFrom::Start(offset)).is_err() {
        return Vec::new();
    }
    let mut text = String::new();
    if file.read_to_string(&mut text).is_err() {
        return Vec::new();
    }
    text.lines()
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect()
}

fn wait_for_pid_exit(pid: u32, timeout: Duration) {
    let started = Instant::now();
    while started.elapsed() < timeout && pid_is_running(pid) {
        thread::sleep(Duration::from_millis(25));
    }
}

#[cfg(unix)]
fn pid_is_running(pid: u32) -> bool {
    if pid == 0 || pid > i32::MAX as u32 {
        return false;
    }
    unsafe extern "C" {
        fn kill(pid: i32, signal: i32) -> i32;
    }
    // SAFETY: signal 0 checks whether the recorded PID exists and delivers no signal.
    let result = unsafe { kill(pid as i32, 0) };
    result == 0 || std::io::Error::last_os_error().raw_os_error() == Some(1)
}

#[cfg(not(unix))]
fn pid_is_running(_pid: u32) -> bool {
    true
}

fn random_secret() -> Result<String, Refusal> {
    let mut bytes = [0_u8; 32];
    #[cfg(unix)]
    {
        let mut file = fs::File::open("/dev/urandom").map_err(|error| {
            Refusal::owner(
                "E_OWNER_SECRET",
                error.to_string(),
                "make the platform random source available",
            )
        })?;
        file.read_exact(&mut bytes).map_err(|error| {
            Refusal::owner(
                "E_OWNER_SECRET",
                error.to_string(),
                "make the platform random source available",
            )
        })?;
    }
    #[cfg(not(unix))]
    for (index, byte) in bytes.iter_mut().enumerate() {
        *byte = (unix_millis() as u8)
            .wrapping_add(index as u8)
            .wrapping_add(std::process::id() as u8);
    }
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn unix_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}

#[cfg(unix)]
fn new_session(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    unsafe extern "C" {
        fn setsid() -> i32;
    }
    // SAFETY: `setsid` has no memory-safety preconditions; this closure runs in
    // the post-fork child immediately before exec and reports syscall failure.
    unsafe {
        command.pre_exec(|| {
            if setsid() == -1 {
                Err(std::io::Error::last_os_error())
            } else {
                Ok(())
            }
        });
    }
}

#[cfg(unix)]
fn install_signal_exit(root: PathBuf, stop: Arc<AtomicBool>) {
    unsafe extern "C" {
        fn signal(number: i32, handler: usize) -> usize;
    }
    extern "C" fn received(_number: i32) {
        SIGNAL_RECEIVED.store(true, Ordering::SeqCst);
    }
    SIGNAL_RECEIVED.store(false, Ordering::SeqCst);
    // SAFETY: POSIX `signal` accepts a C signal-handler address. The handler
    // performs only an atomic store, and SIGINT/SIGTERM are fixed POSIX values.
    unsafe {
        signal(2, received as *const () as usize);
        signal(15, received as *const () as usize);
    }
    let monitor_root = root.clone();
    let monitor_stop = stop.clone();
    if let Err(error) = thread::Builder::new()
        .name("snapback2-signal".to_owned())
        .spawn(move || {
            while !monitor_stop.load(Ordering::SeqCst) {
                if SIGNAL_RECEIVED.load(Ordering::SeqCst) {
                    watch::log(&monitor_root, json!({ "exited": "signal" }));
                    monitor_stop.store(true, Ordering::SeqCst);
                    break;
                }
                thread::sleep(Duration::from_millis(25));
            }
        })
    {
        watch::log(
            &root,
            json!({ "exited": "signal thread failed", "error": error.to_string() }),
        );
        stop.store(true, Ordering::SeqCst);
    }
}
