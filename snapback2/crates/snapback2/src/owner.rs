//! `snapback2 dev`: compile, certify, own the store, serve, watch, and stop.
// @ref LLP 1002#5-the-owner — this process is the only store owner.

use crate::blob_store::{BlobStore, FileBlobStore, LocalStaging};
use crate::client;
use crate::project::{CompilerWorker, locate_root, seed_rows, write_build_cache};
use crate::protocol::Refusal;
use crate::serve::{BoundServer, Context as ServerContext};
use crate::watch;
use crate::writer::{Action, apply_seed, spawn_writer};
use serde::{Deserialize, Serialize};
use serde_json::{Value as Json, json};
use snapback2_core::{Runtime, Store};
use std::fs::{self, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[cfg(unix)]
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt};

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
    match probe_owner(&root) {
        OwnerProbe::Active(info) => {
            return ready_exit(&info, options.json);
        }
        OwnerProbe::Running(_) => {}
        OwnerProbe::Missing => {}
    }
    if options.foreground {
        match foreground(root.clone(), &options) {
            Ok(()) => ExitCode::SUCCESS,
            Err(error) if error.code == "E_STORE_OWNED" => {
                if let Some(info) = wait_for_active_owner(&root, Duration::from_secs(2)) {
                    ready_exit(&info, options.json)
                } else {
                    print_refusal(error, options.json, 1)
                }
            }
            Err(error) => {
                watch::log(
                    &root,
                    json!({ "exited": format!("fatal: {}", error.code), "refusal": error }),
                );
                print_refusal(error, options.json, 1)
            }
        }
    } else {
        detach(root, options)
    }
}

pub fn require_owner(root: &Path) -> Result<OwnerInfo, Refusal> {
    match probe_owner(root) {
        OwnerProbe::Active(info) => Ok(info),
        OwnerProbe::Running(info) => Err(owner_running(&info)),
        OwnerProbe::Missing => Err(Refusal::owner(
            "E_OWNER_NOT_RUNNING",
            format!("no owner is running for {}", root.display()),
            "snapback2 dev",
        )),
    }
}

pub fn read_owner(root: &Path) -> Option<OwnerInfo> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    options.custom_flags(libc::O_NOFOLLOW);
    let mut file = options.open(owner_path(root)).ok()?;
    let metadata = file.metadata().ok()?;
    if !metadata.is_file() {
        return None;
    }
    #[cfg(unix)]
    if metadata.uid() != unsafe { libc::geteuid() } || metadata.mode() & 0o077 != 0 {
        return None;
    }
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn foreground(root: PathBuf, options: &DevOptions) -> Result<(), Refusal> {
    let owner_started_at = unix_millis();
    secure_owner_directory(&root)?;
    let mut compiler = CompilerWorker::spawn()?;
    let compiled = compiler.compile(&root).map_err(first)?;
    crate::media_helper::require_for_generation(&compiled.generation)?;
    let seed = compiler.seed(&root).map_err(first)?;
    write_build_cache(&root, &compiled)?;
    let rows = seed_rows(&seed, &compiled)?;
    let store_path = root.join(".snapback/store.sqlite");
    let store = Store::open(&store_path).map_err(|error| Refusal::from_runtime(&error))?;
    let restarted_through_seq = store
        .commit_seq()
        .map_err(|error| Refusal::from_runtime(&error))?;
    let mut runtime = Runtime::open(store, compiled.generation.clone())
        .map_err(|error| crate::protocol::successor_site(Refusal::from_successor(&error), &compiled, None))?;
    let now = unix_millis();
    for persona in &seed.personas {
        runtime
            .ensure_persona(persona, now)
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
    let secret = random_secret()?;
    let url = format!("http://127.0.0.1:{}", server.port);
    // Store::open has established owner exclusivity before byte-custody startup
    // cleanup is allowed to remove crash-left temporaries.
    let blobs: Arc<dyn BlobStore> = Arc::new(FileBlobStore::open(&root)?);
    let staging = Arc::new(LocalStaging::open(&root)?);
    let info = OwnerInfo {
        pid: std::process::id(),
        port: server.port,
        url: url.clone(),
        secret: secret.clone(),
        generation: compiled.generation.hash(),
        started_at: owner_started_at,
        mode: mode.clone(),
        project: root.clone(),
    };
    let handle = spawn_writer(
        runtime,
        compiled.clone(),
        seed,
        root.clone(),
        mode.clone(),
        restarted_through_seq,
        stop.clone(),
        info.clone(),
        blobs.clone(),
        staging.clone(),
    )?;
    let _effects = crate::effects::spawn(handle.clone());
    handle.call(Action::PublishOwner)?;
    if let Err(error) = print_url(&info, options.json) {
        stop.store(true, Ordering::SeqCst);
        let _ = remove_owner_if_matches(&root, &info);
        return Err(error);
    }
    if let Err(error) = std::io::stdout().flush() {
        stop.store(true, Ordering::SeqCst);
        let _ = remove_owner_if_matches(&root, &info);
        return Err(Refusal::owner(
            "E_OWNER_OUTPUT",
            error.to_string(),
            "run snapback2 dev again with a writable stdout",
        ));
    }
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
    // One worker for the whole owner: the watcher's rebuilds and `/control/run`'s
    // explicit ad hoc compilations share it under a lock.
    let compiler = Arc::new(Mutex::new(compiler));
    let watcher = watch::spawn(compiler.clone(), root.clone(), handle.clone(), stop.clone());
    let server_result = server.run(ServerContext {
        handle,
        root: root.clone(),
        secret,
        mode,
        url,
        stop: stop.clone(),
        blobs,
        staging,
        media_jobs: Default::default(),
        compiler,
    });
    stop.store(true, Ordering::SeqCst);
    if watcher.join().is_err() {
        watch::log(&root, json!({ "exited": "source watcher panicked" }));
    }
    if let Err(error) = remove_owner_if_matches(&root, &info) {
        watch::log(&root, json!({ "ownerStateError": error.to_string() }));
    }
    if !options.owner_child {
        // A foreground owner must never return silently.
        println!("owner exited");
    }
    server_result
}

fn detach(root: PathBuf, options: DevOptions) -> ExitCode {
    let snapback = match secure_owner_directory(&root) {
        Ok(path) => path,
        Err(error) => return print_refusal(error, options.json, 2),
    };
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
        match probe_owner(&root) {
            OwnerProbe::Active(info) => {
                if info.pid != child.id() {
                    terminate_owner_session(child.id());
                    let _ = child.kill();
                    let _ = child.wait();
                }
                return ready_exit(&info, options.json);
            }
            OwnerProbe::Running(info) => {
                let _ = info;
            }
            OwnerProbe::Missing => {}
        }
        if let Ok(Some(status)) = child.try_wait() {
            terminate_owner_session(child.id());
            let refusals = startup_refusals(&log_path, log_start);
            if !refusals.is_empty() {
                let error = first(refusals);
                if error.code == "E_STORE_OWNED"
                    && let Some(info) = wait_for_active_owner(&root, Duration::from_secs(2))
                {
                    return ready_exit(&info, options.json);
                }
                return print_refusal(error, options.json, 1);
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
    terminate_owner_session(child.id());
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

enum OwnerProbe {
    Active(OwnerInfo),
    Running(OwnerInfo),
    Missing,
}

fn probe_owner(root: &Path) -> OwnerProbe {
    let Some(info) = owner_file_for_project(root) else {
        return OwnerProbe::Missing;
    };
    if !pid_is_running(info.pid) {
        return OwnerProbe::Missing;
    }
    match client::control(&info, "GET", "/control/status", json!({})) {
        Ok(response)
            if response.status == 200
                && response
                    .body
                    .get("project")
                    .and_then(Json::as_str)
                    .is_some_and(|project| Path::new(project) == root) =>
        {
            OwnerProbe::Active(info)
        }
        _ => OwnerProbe::Running(info),
    }
}

fn owner_file_for_project(root: &Path) -> Option<OwnerInfo> {
    let info = read_owner(root)?;
    (info.project == root).then_some(info)
}

fn wait_for_active_owner(root: &Path, timeout: Duration) -> Option<OwnerInfo> {
    let started = Instant::now();
    while started.elapsed() < timeout {
        if let OwnerProbe::Active(info) = probe_owner(root) {
            return Some(info);
        }
        thread::sleep(Duration::from_millis(25));
    }
    None
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
                if path == "/control/stop"
                    && !wait_for_owner_exit(root, &info, Duration::from_secs(2))
                {
                    return print_refusal(
                        Refusal::owner(
                            "E_OWNER_STOP_TIMEOUT",
                            format!("owner pid {} is still alive after 2 seconds", info.pid),
                            "inspect .snapback/log.jsonl, then retry snapback2 dev --stop",
                        )
                        .with_detail("pid", json!(info.pid)),
                        json_output,
                        1,
                    );
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

pub(crate) fn write_owner(root: &Path, info: &OwnerInfo) -> Result<(), Refusal> {
    let bytes = serde_json::to_vec_pretty(info).map_err(|error| {
        Refusal::owner("E_OWNER_STATE", error.to_string(), "restart snapback2 dev")
    })?;
    write_owner_file(root, "owner.json", &bytes)
}

fn write_owner_file(root: &Path, name: &str, bytes: &[u8]) -> Result<(), Refusal> {
    let directory = secure_owner_directory(root)?;
    let path = directory.join(name);
    let temporary = directory.join(format!(
        ".owner-{}-{}.tmp",
        std::process::id(),
        random_secret()?
    ));
    let result = (|| {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
        let mut file = options.open(&temporary)?;
        let metadata = file.metadata()?;
        if !metadata.is_file() {
            return Err(std::io::Error::other(
                "owner temporary is not a regular file",
            ));
        }
        #[cfg(unix)]
        if metadata.uid() != unsafe { libc::geteuid() } || metadata.mode() & 0o777 != 0o600 {
            return Err(std::io::Error::other(
                "owner temporary does not have owner-only custody",
            ));
        }
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&temporary, &path)?;
        fs::File::open(&directory)?.sync_all()
    })();
    if let Err(error) = result {
        let _ = fs::remove_file(&temporary);
        return Err(Refusal::owner(
            "E_OWNER_STATE",
            error.to_string(),
            "make .snapback writable and remove unsafe owner-state paths",
        ));
    }
    Ok(())
}

// @ref LLP 1002#5-the-owner — owner data and its control bearer are private
// local capability state, not project-readable build output.
fn secure_owner_directory(root: &Path) -> Result<PathBuf, Refusal> {
    let path = root.join(".snapback");
    match fs::symlink_metadata(&path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            return Err(Refusal::owner(
                "E_OWNER_STATE",
                format!(
                    "{} must be a project-owned directory, not a symlink",
                    path.display()
                ),
                "replace .snapback with a directory owned by the current user",
            ));
        }
        Ok(metadata) => {
            #[cfg(unix)]
            {
                if metadata.uid() != unsafe { libc::geteuid() } {
                    return Err(Refusal::owner(
                        "E_OWNER_STATE",
                        format!("{} is not owned by the current user", path.display()),
                        "replace .snapback with a directory owned by the current user",
                    ));
                }
                if metadata.mode() & 0o777 != 0o700 {
                    fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).map_err(
                        |error| {
                            Refusal::owner(
                                "E_OWNER_STATE",
                                error.to_string(),
                                "make .snapback owner-only (mode 0700)",
                            )
                        },
                    )?;
                }
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let mut builder = fs::DirBuilder::new();
            #[cfg(unix)]
            builder.mode(0o700);
            match builder.create(&path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                    return secure_owner_directory(root);
                }
                Err(error) => {
                    return Err(Refusal::owner(
                        "E_OWNER_STATE",
                        error.to_string(),
                        "create a writable project-owned .snapback directory",
                    ));
                }
            }
        }
        Err(error) => {
            return Err(Refusal::owner(
                "E_OWNER_STATE",
                error.to_string(),
                "make .snapback accessible to the current user",
            ));
        }
    }
    Ok(path)
}

pub(crate) fn write_owner_if_active(
    root: &Path,
    info: &OwnerInfo,
    exited: bool,
) -> Result<(), Refusal> {
    if exited {
        Ok(())
    } else {
        write_owner(root, info)
    }
}

fn remove_owner_if_matches(root: &Path, expected: &OwnerInfo) -> std::io::Result<()> {
    let Some(current) = read_owner(root) else {
        return Ok(());
    };
    if current.pid != expected.pid || current.secret != expected.secret {
        return Ok(());
    }
    fs::remove_file(owner_path(root)).or_else(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            Ok(())
        } else {
            Err(error)
        }
    })
}

fn owner_path(root: &Path) -> PathBuf {
    root.join(".snapback/owner.json")
}

fn ready_exit(info: &OwnerInfo, json_output: bool) -> ExitCode {
    match print_url(info, json_output) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => print_refusal(error, json_output, 1),
    }
}

fn print_url(info: &OwnerInfo, json_output: bool) -> Result<(), Refusal> {
    // @ref LLP 1002#templates-are-products — bundlers read the owner's URL; the owner never supervises them.
    if info.mode == "dev" {
        write_owner_file(
            &info.project,
            "dev-url",
            format!("{}\n", info.url).as_bytes(),
        )?;
    }
    if json_output {
        println!(
            "{}",
            json!({ "url": info.url, "generation": info.generation, "pid": info.pid })
        );
    } else {
        println!("SNAPBACK_URL={}", info.url);
    }
    Ok(())
}

fn owner_running(info: &OwnerInfo) -> Refusal {
    Refusal::owner(
        "E_OWNER_RUNNING",
        format!(
            "owner pid {} is running at {}, but its status probe did not answer",
            info.pid, info.url
        ),
        "use the reported URL or retry after the owner becomes responsive",
    )
    .with_detail("pid", json!(info.pid))
    .with_detail("url", json!(info.url))
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

fn wait_for_owner_exit(root: &Path, info: &OwnerInfo, timeout: Duration) -> bool {
    let started = Instant::now();
    while started.elapsed() < timeout && !owner_process_exited(root, info) {
        thread::sleep(Duration::from_millis(25));
    }
    owner_process_exited(root, info)
}

fn owner_file_matches(root: &Path, expected: &OwnerInfo) -> bool {
    read_owner(root)
        .is_some_and(|current| current.pid == expected.pid && current.secret == expected.secret)
}

fn owner_process_exited(root: &Path, info: &OwnerInfo) -> bool {
    if !pid_is_running(info.pid) {
        return true;
    }
    // A foreground owner held by a test or supervisor can be an unreaped zombie:
    // it has exited even though signal 0 still observes its PID. Only run the
    // platform process-state probe after this owner has removed its own record.
    !owner_file_matches(root, info) && pid_is_zombie(info.pid)
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

#[cfg(unix)]
fn pid_is_zombie(pid: u32) -> bool {
    let output = Command::new("ps")
        .args(["-o", "stat=", "-p", &pid.to_string()])
        .output();
    output.is_ok_and(|output| {
        output.status.success()
            && String::from_utf8_lossy(&output.stdout)
                .trim_start()
                .starts_with('Z')
    })
}

#[cfg(not(unix))]
fn pid_is_running(_pid: u32) -> bool {
    true
}

#[cfg(not(unix))]
fn pid_is_zombie(_pid: u32) -> bool {
    false
}

fn random_hex<const N: usize>() -> Result<String, Refusal> {
    let mut bytes = [0_u8; N];
    getrandom::fill(&mut bytes).map_err(|error| {
        Refusal::owner(
            "E_OWNER_SECRET",
            error.to_string(),
            "make the platform random source available",
        )
    })?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn random_secret() -> Result<String, Refusal> {
    random_hex::<32>()
}

#[cfg(unix)]
fn terminate_owner_session(pid: u32) {
    if pid != 0 && pid <= i32::MAX as u32 {
        // The detached owner calls setsid before exec, so its PID is its process-group ID.
        unsafe {
            libc::kill(-(pid as i32), libc::SIGTERM);
        }
    }
}

#[cfg(not(unix))]
fn terminate_owner_session(_pid: u32) {}

fn unix_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}

#[cfg(test)]
#[allow(clippy::items_after_test_module)]
mod tests {
    use super::*;

    fn test_info(root: &Path, pid: u32, secret: &str) -> OwnerInfo {
        OwnerInfo {
            pid,
            port: 1234,
            url: "http://127.0.0.1:1234".to_owned(),
            secret: secret.to_owned(),
            generation: "one".to_owned(),
            started_at: 0,
            mode: "dev".to_owned(),
            project: root.to_owned(),
        }
    }

    fn root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "snapback2-owner-unit-{name}-{}-{}",
            std::process::id(),
            unix_millis()
        ));
        fs::create_dir_all(root.join(".snapback")).unwrap();
        root
    }

    #[test]
    fn cleanup_is_conditional_on_pid_and_secret() {
        let root = root("identity");
        let winner = test_info(&root, 11, "winner");
        let loser = test_info(&root, 22, "loser");
        write_owner(&root, &winner).unwrap();
        remove_owner_if_matches(&root, &loser).unwrap();
        let current = read_owner(&root).unwrap();
        assert_eq!(current.pid, winner.pid);
        assert_eq!(current.secret, winner.secret);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn exited_owner_state_refuses_a_late_generation_write() {
        let root = root("late-generation");
        let mut info = test_info(&root, 11, "owner");
        write_owner_if_active(&root, &info, false).unwrap();
        remove_owner_if_matches(&root, &info).unwrap();
        info.generation = "two".to_owned();
        write_owner_if_active(&root, &info, true).unwrap();
        assert!(!owner_path(&root).exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn owner_secret_is_a_full_random_capability() {
        let first = random_secret().unwrap();
        let second = random_secret().unwrap();
        assert_eq!(first.len(), 64);
        assert!(first.bytes().all(|byte| byte.is_ascii_hexdigit()));
        assert_ne!(first, second);
    }

    #[cfg(unix)]
    #[test]
    fn owner_state_is_owner_only_under_an_ordinary_directory_mode() {
        let root = root("permissions");
        fs::set_permissions(root.join(".snapback"), fs::Permissions::from_mode(0o755)).unwrap();
        let info = test_info(&root, 11, "secret");

        write_owner(&root, &info).unwrap();

        assert_eq!(
            fs::metadata(root.join(".snapback")).unwrap().mode() & 0o777,
            0o700
        );
        assert_eq!(
            fs::metadata(owner_path(&root)).unwrap().mode() & 0o777,
            0o600
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn owner_state_refuses_a_symlinked_directory() {
        use std::os::unix::fs::symlink;

        let root = root("symlinks");
        let directory = root.join(".snapback");
        let target_directory = root.join("attacker-directory");
        fs::create_dir(&target_directory).unwrap();
        fs::remove_dir(&directory).unwrap();
        symlink(&target_directory, &directory).unwrap();
        assert_eq!(
            secure_owner_directory(&root).unwrap_err().code,
            "E_OWNER_STATE"
        );
        assert!(!target_directory.join("owner.json").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn fixed_owner_temp_symlink_cannot_clobber_its_target() {
        use std::os::unix::fs::symlink;

        let root = root("temp-symlink");
        let outside = root.join("outside");
        let original = b"do not overwrite\n";
        fs::write(&outside, original).unwrap();
        symlink(&outside, root.join(".snapback/owner.json.tmp")).unwrap();
        let info = test_info(&root, 11, "secret");

        write_owner(&root, &info).unwrap();

        assert_eq!(fs::read(&outside).unwrap(), original);
        assert!(root.join(".snapback/owner.json.tmp").is_symlink());
        assert_eq!(read_owner(&root).unwrap().secret, "secret");
        fs::remove_dir_all(root).unwrap();
    }
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
