//! @ref LLP 3000.030#15 — publication ends the foreground clock; proof owns detached custody.
use super::*;
use std::os::{fd::{AsRawFd, FromRawFd}, unix::process::CommandExt};
use std::sync::{Arc, Mutex};

static ACTIVE: AtomicBool = AtomicBool::new(false);
pub(super) fn active() -> bool { ACTIVE.load(Ordering::Relaxed) }
pub(super) fn lower_app(pid: u32) -> Result<Value> {
    // simctl launches through the simulator service, outside our inherited
    // taskpolicy tree. Apply background policy only to our reported launch PID.
    #[cfg(target_os = "macos")]
    if unsafe { libc::setpriority(libc::PRIO_DARWIN_PROCESS, pid, libc::PRIO_DARWIN_BG) } != 0 {
        return Err(error("E_WITNESS_PROCESS", format!("cannot set background policy on owned app: {}", std::io::Error::last_os_error())));
    }
    #[cfg(not(target_os = "macos"))]
    let _ = pid;
    // XNU get_background_proc consults current_task(), even for another PID;
    // it cannot read back this external target's flag. Record the successful
    // setter, not a falsely attributed getpriority result (see §15 NZ report).
    Ok(json!({ "pid": pid, "darwinBackgroundSet": cfg!(target_os = "macos") }))
}
fn read(path: &Path) -> Value { recovery::read(path) }
fn save(path: &Path, value: &Value) -> Result<()> { recovery::write(path, value) }
fn own_policy() -> i32 {
    #[cfg(target_os = "macos")]
    { unsafe { libc::getpriority(libc::PRIO_DARWIN_PROCESS, 0) } }
    #[cfg(not(target_os = "macos"))]
    { 0 }
}
fn bundle(metadata: &Value) -> Result<&str> {
    metadata["fileMetadata"]["ios"]["bundle"].as_str()
        .filter(|p| !Path::new(p).is_absolute() && !Path::new(p).components().any(|c| matches!(c, std::path::Component::ParentDir)))
        .ok_or_else(|| error("E_WITNESS_PROOF", "export metadata has no in-tree iOS bundle"))
}
pub(super) fn executable() -> PathBuf {
    let path = std::env::current_exe().unwrap();
    #[cfg(test)]
    let path = path.parent().unwrap().parent().unwrap().join("snapback4");
    path
}
fn inherited(fd: i32) -> Result<File> {
    if unsafe { libc::fcntl(fd, libc::F_GETFD) } < 0 { return Err(error("E_WITNESS_PROCESS", "missing background custody descriptor")); }
    // Keep inherited custody private to this process except explicit transfers.
    unsafe { libc::fcntl(fd, libc::F_SETFD, libc::FD_CLOEXEC); }
    Ok(unsafe { File::from_raw_fd(fd) })
}
// Command's pre_exec captures raw descriptors; this small wrapper closes the
// parent's copies on both spawn success and failure.
fn spawn_owned(mut command: Command, export: &File, project: Option<&File>, detached: bool) -> Result<Child> {
    let duplicate = |file: &File| -> Result<File> {
        let fd = unsafe { libc::fcntl(file.as_raw_fd(), libc::F_DUPFD_CLOEXEC, 10) };
        if fd < 0 { return Err(error("E_WITNESS_PROCESS", std::io::Error::last_os_error())); }
        Ok(unsafe { File::from_raw_fd(fd) })
    };
    let export = duplicate(export)?;
    let project = project.map(duplicate).transpose()?;
    let a = export.as_raw_fd(); let b = project.as_ref().map(AsRawFd::as_raw_fd);
    unsafe { command.pre_exec(move || {
        if detached && libc::setsid() < 0 { return Err(std::io::Error::last_os_error()); }
        if libc::dup2(a, 3) < 0 { return Err(std::io::Error::last_os_error()); }
        if let Some(fd) = b { if libc::dup2(fd, 4) < 0 { return Err(std::io::Error::last_os_error()); } }
        Ok(())
    }); }
    command.spawn().map_err(|e| error("E_WITNESS_PROCESS", e))
}
fn identity_alive(record: &Value) -> bool {
    !record.is_null() && record["pid"].as_u64().and_then(|p| recovery::identity(p as u32)).as_ref() == Some(record)
}
fn current(dir: &Path) -> bool {
    let request = read(&dir.join("request.json"));
    let marker = read(&Path::new(request["target"].as_str().unwrap_or("dist")).join(".snapback4-publication.json"));
    read(&dir.parent().unwrap().join("latest.json"))["artifacts"].as_str() == dir.to_str()
        && matches_generation(&request, &marker) && marker["mode"] == "background"
}
fn matches_generation(value: &Value, publication: &Value) -> bool {
    publication["generation"].is_string() && publication["exportHash"].is_string()
        && value["generation"] == publication["generation"] && value["exportHash"] == publication["exportHash"]
}
fn finish(dir: &Path, state: &str, reason: &str) -> Result<Value> { finish_at(dir, "result.json", state, reason) }
fn finish_at(dir: &Path, file: &str, state: &str, reason: &str) -> Result<Value> {
    let request = read(&dir.join("request.json"));
    let result = json!({ "state": state, "reason": reason, "exportHash": request["exportHash"],
        "generation": request["generation"], "publishedAt": request["publishedAt"], "finishedAt": now(), "artifacts": dir,
        "log": dir.join("background.log"), "receipt": dir.join("smoke-ios-run.json") });
    save(&dir.join(file), &result)?;
    eprintln!("{}", summary(&result));
    Ok(result)
}

/// Called under the destination publication lock, after verified publication.
/// All errors here describe native evidence; none invalidate the Hermes export.
pub(super) fn schedule(dir: &Path, target: &Path, export: &File) {
    let result = (|| -> Result<()> {
        let marker = read(&target.join(".snapback4-publication.json"));
        let metadata = read(&dir.join("export/metadata.json"));
        let relative = bundle(&metadata)?;
        let hash = artifact(&dir.join("export").join(relative))?["sha256"].clone();
        if !marker["generation"].is_string() || marker["exportHash"] != hash || marker["mode"] != "background" {
            return Err(error("E_WITNESS_PROOF", "publication generation does not bind the background export"));
        }
        let request = json!({ "artifacts": dir, "target": target, "project": std::env::current_dir().map_err(|e| error("E_WITNESS_INPUT", e))?,
            "exportHash": hash, "generation": marker["generation"], "publishedAt": read(&dir.join("publication.json"))["verifiedAt"],
            "qos": "background", "publication": dir.join("publication.json") });
        save(&dir.join("request.json"), &request)?;
        save(&dir.parent().unwrap().join("latest.json"), &request)?;
        let log = output(&dir.join("background.log"))?;
        #[cfg(target_os = "macos")]
        let mut command = { let mut c = Command::new("/usr/sbin/taskpolicy"); c.args(["-b", "-c", "background"]).arg(executable()); c };
        #[cfg(not(target_os = "macos"))]
        let mut command = Command::new(executable());
        command.args(["witness", "background-worker"]).arg(dir).stdin(Stdio::null())
            .stdout(log.try_clone().map_err(|e| error("E_WITNESS_ARTIFACT", e))?).stderr(log);
        let child = spawn_owned(command, export, None, true)?;
        save(&dir.join("launch.json"), &json!({ "process": recovery::identity(child.id()), "at": now() }))?;
        println!("native smoke pending for export {} in background; npx snapback4 witness status --wait; log: {}", hash.as_str().unwrap(), dir.join("background.log").display());
        Ok(())
    })();
    if let Err(e) = result {
        if let Ok(mut log) = OpenOptions::new().create(true).append(true).open(dir.join("background.log")) { let _ = writeln!(log, "native smoke failed to start: {e}"); }
        let _ = finish(dir, "failed", &e);
        eprintln!("native smoke failed to start: {e}; log: {} (Hermes export succeeded)", dir.join("background.log").display());
    }
}

// An explicit opt-out must also supersede a previous background request. It
// records a skip, never leaves an older pass looking like the new export's proof.
pub(super) fn skipped(args: &[String]) -> i32 {
    let result = (|| -> Result<()> {
        if args.len() != 1 || !["SNAPBACK4_NATIVE_SMOKE=off", "macOS is required"].contains(&args[0].as_str()) {
            return Err(error("E_WITNESS_INPUT", "invalid native skip reason"));
        }
        let project = std::env::current_dir().map_err(|e| error("E_WITNESS_INPUT", e))?;
        let root = project.join("artifacts/native-smoke");
        fs::create_dir_all(&root).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
        let lock = OpenOptions::new().create(true).truncate(false).read(true).write(true).open(root.join("publication.lock")).map_err(|e| error("E_WITNESS_PROCESS", e))?;
        lock.lock().map_err(|e| error("E_WITNESS_PROCESS", e))?;
        let dir = root.join(format!("{}-{}", now(), std::process::id()));
        fs::create_dir(&dir).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
        skip_publication(&dir, &project.join("dist"))
    })();
    match result { Ok(()) => 0, Err(e) => { eprintln!("{e}"); 1 } }
}

// Called under the publisher's lock on every skipped publication, including
// the first one. This handoff is downstream of commit; failure cannot undo it.
pub(super) fn skip_publication(dir: &Path, target: &Path) -> Result<()> {
    let marker = read(&target.join(".snapback4-publication.json"));
    let metadata = read(&target.join("metadata.json"));
    let hash = artifact(&target.join(bundle(&metadata)?))?["sha256"].clone();
    if !marker["generation"].is_string() || marker["exportHash"] != hash || marker["mode"] != "skipped" {
        return Err(error("E_WITNESS_PROOF", "publication generation does not bind the skipped export"));
    }
    let project = target.parent().unwrap();
    let request = json!({ "artifacts": dir, "target": target, "project": project,
        "exportHash": hash, "generation": marker["generation"], "publishedAt": now() });
    save(&dir.join("request.json"), &request)?;
    save(&dir.parent().unwrap().join("latest.json"), &request)?;
    let reason = marker["reason"].as_str().unwrap_or("native proof skipped");
    writeln!(output(&dir.join("background.log"))?, "native smoke skipped: {reason}").map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
    finish(dir, "skipped", reason)?;
    save(&dir.join("finished.json"), &json!({ "finishedAt": now(), "skipped": true }))
}

fn directory(args: &[String]) -> Result<PathBuf> {
    if args.len() != 1 { return Err(error("E_WITNESS_INPUT", "internal background command requires one run directory")); }
    let dir = fs::canonicalize(&args[0]).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
    let request = read(&dir.join("request.json"));
    let project = fs::canonicalize(std::env::current_dir().map_err(|e| error("E_WITNESS_INPUT", e))?).map_err(|e| error("E_WITNESS_INPUT", e))?;
    if request["artifacts"].as_str() != dir.to_str() || request["project"].as_str() != project.to_str()
        || dir.parent() != Some(project.join("artifacts/native-smoke").as_path()) {
        return Err(error("E_WITNESS_INPUT", "background request is not this project's export"));
    }
    Ok(dir)
}
pub(super) fn signals() {
    unsafe { for signal in [libc::SIGINT, libc::SIGTERM, libc::SIGHUP] { libc::signal(signal, interrupt as *const () as libc::sighandler_t); } }
}

fn defer_retention(dir: &Path, completed: Option<&Path>) {
    if let Err(e) = retention::run(dir.parent().unwrap(), completed, || {
        if current(dir) { Ok(()) } else { Err(error("E_WITNESS_INTERRUPTED", "retention superseded by a newer export")) }
    }) { eprintln!("native smoke evidence cleanup deferred: {e}"); }
}

pub(super) fn worker(args: &[String]) -> i32 {
    let execute = || -> Result<()> {
        signals();
        let dir = directory(args)?;
        let export = inherited(3)?;
        let policy = own_policy();
        save(&dir.join("worker.json"), &json!({ "process": recovery::identity(std::process::id()), "at": now(), "darwinBackground": policy }))?;
        #[cfg(target_os = "macos")]
        if policy != 1 { return Err(error("E_WITNESS_PROCESS", "background policy was not inherited")); }
        let lock_path = Path::new(".snapback4-witness/background.lock");
        fs::create_dir_all(lock_path.parent().unwrap()).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
        let lock = OpenOptions::new().create(true).truncate(false).read(true).write(true).open(lock_path).map_err(|e| error("E_WITNESS_PROCESS", e))?;
        loop {
            if !current(&dir) { finish(&dir, "superseded", "a newer export was published")?; return Ok(()); }
            interrupted()?;
            match lock.try_lock() {
                Ok(()) => break,
                Err(std::fs::TryLockError::WouldBlock) => sleep(Duration::from_millis(100)),
                Err(e) => return Err(error("E_WITNESS_PROCESS", e)),
            }
        }
        // No newer smoke can start until both this guardian and its driver
        // have released the same open-file-description lease after cleanup.
        defer_retention(&dir, None);
        interrupted()?;
        if !current(&dir) { finish(&dir, "superseded", "a newer export was published")?; return Ok(()); }
        let mut command = Command::new(executable());
        command.args(["witness", "background-run"]).arg(&dir).process_group(0).stdin(Stdio::null())
            .env("SNAPBACK4_EXPORT_WRAPPER_PID", std::process::id().to_string());
        let mut child = spawn_owned(command, &export, Some(&lock), false)?;
        let mut sent = None;
        let started = Instant::now(); let awake = sleep_clock();
        loop {
            // Keep even a dead driver unreaped until its direct tool group is
            // empty. That also covers death before a tool's journal update.
            let mut info: libc::siginfo_t = unsafe { std::mem::zeroed() };
            if unsafe { libc::waitid(libc::P_PID, child.id(), &mut info, libc::WEXITED | libc::WNOHANG | libc::WNOWAIT) } != 0 {
                return Err(error("E_WITNESS_PROCESS", "cannot inspect background driver"));
            }
            if unsafe { info.si_pid() } != 0 { break; }
            if (INTERRUPTED.load(Ordering::Relaxed) || !current(&dir) || slept(awake, sleep_clock()) || started.elapsed() > Duration::from_secs(75 * 60)) && sent.is_none() {
                // Our still-unreaped child cannot have its PID reused.
                unsafe { libc::kill(child.id() as i32, libc::SIGTERM); }
                sent = Some(Instant::now());
            }
            if sent.is_some_and(|at| at.elapsed() > Duration::from_secs(120)) {
                unsafe { libc::kill(-(child.id() as i32), libc::SIGKILL); }
            }
            sleep(Duration::from_millis(100));
        }
        let mut deadline = cleanup::Deadline::new(Instant::now());
        let mut empty = 0;
        loop {
            unsafe { libc::kill(-(child.id() as i32), libc::SIGKILL); }
            let members = recovery::members(child.id())?;
            deadline.observe(Instant::now(), members.len());
            if members.is_empty() { empty += 1; } else { empty = 0; }
            if empty == 2 { break; }
            if deadline.expired(Instant::now()) { return Err(error("E_WITNESS_PROCESS", "background driver group cleanup stalled; recovery required")); }
            sleep(Duration::from_millis(20));
        }
        let status = child.wait().map_err(|e| error("E_WITNESS_PROCESS", e))?;
        INTERRUPTED.store(false, Ordering::Relaxed);
        drop(export);
        // SIGKILL of the driver cannot strand a backend/app/device until the
        // next export: its independent guardian recovers before releasing lock.
        recovery::recover(&dir)?;
        let result = read(&dir.join("driver-result.json"));
        if !current(&dir) {
            finish(&dir, "superseded", "a newer export was published")?;
        } else if !result.is_null() {
            finish(&dir, result["state"].as_str().unwrap_or("failed"), result["reason"].as_str().unwrap_or("missing worker outcome"))?;
        } else {
            finish(&dir, "failed", &format!("native worker exited without a result ({status})"))?;
        }
        // Own custody has already drained. Retention of older evidence is
        // maintenance and must not rewrite the completed native outcome.
        defer_retention(&dir, Some(&dir));
        Ok(())
    };
    match execute() { Ok(()) => 0, Err(e) => {
        if let Ok(dir) = directory(args) { let _ = finish(&dir, if current(&dir) { "failed" } else { "superseded" }, &format!("{e}; cleanup may require recovery")); }
        eprintln!("{e}"); 1
    } }
}

// Unlike wall time, this difference ignores NTP/calendar changes. Darwin's
// continuous clock advances asleep; uptime does not. Unit tests inject samples.
#[allow(deprecated)]
pub(super) fn sleep_clock() -> u64 {
    #[cfg(target_os = "macos")]
    unsafe {
        unsafe extern "C" { fn mach_continuous_time() -> u64; }
        let mut scale = libc::mach_timebase_info_data_t { numer: 0, denom: 0 };
        libc::mach_timebase_info(&mut scale);
        return ((mach_continuous_time().saturating_sub(libc::mach_absolute_time())) as u128 * scale.numer as u128 / scale.denom as u128 / 1_000_000) as u64;
    }
    #[cfg(not(target_os = "macos"))]
    { 0 }
}
pub(super) fn slept(before: u64, after: u64) -> bool { after.saturating_sub(before) > 1000 }

pub(super) fn driver(args: &[String]) -> i32 {
    let guardian = std::env::var("SNAPBACK4_EXPORT_WRAPPER_PID").ok().and_then(|s| s.parse::<i32>().ok());
    let execute = || -> Result<()> {
        signals();
        let dir = directory(args)?;
        let export = inherited(3)?;
        let _project = inherited(4)?;
        ACTIVE.store(true, Ordering::Relaxed);
        let parent = std::env::var("SNAPBACK4_EXPORT_WRAPPER_PID").ok().and_then(|s| s.parse::<i32>().ok())
            .ok_or_else(|| error("E_WITNESS_PROCESS", "missing background guardian"))?;
        let policy = own_policy();
        save(&dir.join("driver.json"), &json!({ "process": recovery::identity(std::process::id()), "at": now(), "darwinBackground": policy }))?;
        #[cfg(target_os = "macos")]
        if policy != 1 { return Err(error("E_WITNESS_PROCESS", "driver did not inherit background policy")); }
        let done = Arc::new(AtomicBool::new(false));
        let why = Arc::new(Mutex::new(None::<String>));
        let monitor = {
            let dir = dir.clone(); let done = done.clone(); let why = why.clone();
            std::thread::spawn(move || {
                let start = Instant::now(); let before = sleep_clock();
                while !done.load(Ordering::Relaxed) {
                    let reason = if unsafe { libc::getppid() } != parent { Some("background guardian exited") }
                        else if !current(&dir) { Some("superseded by a newer export") }
                        else if slept(before, sleep_clock()) { Some("host slept during native proof; retry export after wake") }
                        else if start.elapsed() > Duration::from_secs(75 * 60) { Some("background smoke exceeded 75 minutes") }
                        else { None };
                    if let Some(reason) = reason {
                        *why.lock().unwrap() = Some(reason.to_owned());
                        INTERRUPTED.store(true, Ordering::Relaxed); break;
                    }
                    sleep(Duration::from_millis(100));
                }
            })
        };
        let status = super::run(&["ios".into(), "--build".into(), ".".into(), "--smoke".into(),
            "--export".into(), dir.join("export").to_string_lossy().into_owned(), "--artifacts".into(), dir.to_string_lossy().into_owned()]);
        done.store(true, Ordering::Relaxed); let _ = monitor.join();
        INTERRUPTED.store(false, Ordering::Relaxed);
        // The normal witness has now dropped its run, simulator and project
        // leases. Mark only our own dead role before invoking recorded recovery.
        let mut live = read(&dir.join("live.json"));
        if live["owner"] == recovery::identity(std::process::id()).unwrap_or(Value::Null) {
            live["owner"] = Value::Null; live["wrapper"] = Value::Null; save(&dir.join("live.json"), &live)?;
        }
        drop(export);
        recovery::recover(&dir)?;
        let reason = why.lock().unwrap().clone();
        let receipt = read(&dir.join("smoke-ios-run.json"));
        let (state, message) = if let Some(reason) = reason {
            (if reason.starts_with("superseded") { "superseded" } else { "failed" }, reason)
        } else if status == 0 {
            validate(&dir, &receipt)?;
            ("passed", "prime/offline/restart".to_owned())
        } else if environment_skip(&receipt) {
            ("skipped", receipt["error"].as_str().unwrap_or("native environment unavailable").to_owned())
        } else { ("failed", receipt["error"].as_str().unwrap_or("native smoke interrupted or exited before its receipt").to_owned()) };
        finish_at(&dir, if unsafe { libc::getppid() } == parent { "driver-result.json" } else { "result.json" }, state, &message)?;
        Ok(())
    };
    match execute() { Ok(()) => 0, Err(e) => {
        if let Ok(dir) = directory(args) {
            let file = if Some(unsafe { libc::getppid() }) == guardian { "driver-result.json" } else { "result.json" };
            let _ = finish_at(&dir, file, "failed", &e);
        }
        eprintln!("{e}"); 1
    } }
}
fn environment_skip(receipt: &Value) -> bool {
    let condition = receipt["environmentCondition"].as_str().unwrap_or("");
    let problem = receipt["error"].as_str().unwrap_or("");
    receipt["phase"] == "environment" && ["simulator-list", "missing-runtime", "missing-device-type", "simulator-create", "simulator-boot"].contains(&condition)
        && ["E_WITNESS_PLATFORM:", "E_WITNESS_SIMULATOR:", "E_WITNESS_TIMEOUT:"].iter().any(|p| problem.starts_with(p))
        && !(condition == "simulator-create" && problem.starts_with("E_WITNESS_TIMEOUT:"))
}
fn validate(dir: &Path, receipt: &Value) -> Result<()> {
    let proof = read(&dir.join("proof.json"));
    let publication = read(&dir.join("publication.json"));
    let request = read(&dir.join("request.json"));
    if receipt["exitStatus"] != 0 || receipt["proof"]["sha256"] != artifact(&dir.join("proof.json"))?["sha256"]
        || proof["exported"]["inventory"]["files"] != publication["files"] || !publication["files"].is_array()
        || receipt["installed"]["javascript"]["sha256"] != request["exportHash"] || !request["exportHash"].is_string()
        || ["prime", "offline", "restart"].iter().any(|s| receipt["segments"][s]["status"] != "passed") {
        return Err(error("E_WITNESS_PROOF", "native result does not bind the published export and all three segments"));
    }
    Ok(())
}
fn timestamp(value: &Value) -> String {
    let seconds = (value.as_u64().unwrap_or(0) / 1000) as libc::time_t;
    let mut tm: libc::tm = unsafe { std::mem::zeroed() };
    unsafe { libc::gmtime_r(&seconds, &mut tm); }
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", tm.tm_year + 1900, tm.tm_mon + 1, tm.tm_mday, tm.tm_hour, tm.tm_min, tm.tm_sec)
}
fn summary(value: &Value) -> String {
    let state = value["state"].as_str().unwrap_or("pending");
    let hash = value["exportHash"].as_str().unwrap_or("unknown");
    if state == "unverified" { format!("native smoke: no proof for the current export {hash}: {}; run npm run export:ios", value["reason"].as_str().unwrap_or("publication handoff missing or stale")) }
    else if state == "passed" { format!("native smoke passed for export {hash} at {}: prime/offline/restart; receipt: {}", timestamp(&value["finishedAt"]), value["receipt"].as_str().unwrap_or("unknown")) }
    else { format!("native smoke {state} for export {hash}: {}; log: {}", value["reason"].as_str().unwrap_or("running in background"), value["log"].as_str().unwrap_or("unknown")) }
}
fn latest(project: &Path) -> Option<Value> { latest_observed(project, || {}) }
fn latest_observed(project: &Path, after_hash: impl FnOnce()) -> Option<Value> {
    let root = project.join("artifacts/native-smoke");
    if !root.exists() && !project.join("dist").exists() { return None; }
    // A reader never observes the exchange/verify/handoff transaction halfway
    // through. Never wait here: doctor is informational; --wait polls pending.
    let locked = (|| -> Result<File> {
        fs::create_dir_all(&root).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
        OpenOptions::new().read(true).write(true).create(true).truncate(false)
            .open(root.join("publication.lock")).map_err(|e| error("E_WITNESS_ARTIFACT", e))
    })();
    let lock = match locked { Ok(file) => file, Err(e) => return Some(json!({ "state": "unverified", "reason": e })) };
    match lock.try_lock_shared() {
        Ok(()) => {},
        Err(std::fs::TryLockError::WouldBlock) => return Some(json!({ "state": "pending", "reason": "publication commit in progress", "log": root })),
        Err(e) => return Some(json!({ "state": "unverified", "reason": format!("cannot observe publication: {e}") })),
    }
    let request = read(&project.join("artifacts/native-smoke/latest.json"));
    let dist = project.join("dist");
    if request.is_null() && !dist.exists() { return None; }
    let marker_path = dist.join(".snapback4-publication.json");
    let marker = read(&marker_path);
    let missing = |reason: &str| json!({ "state": "unverified", "exportHash": marker["exportHash"],
        "generation": marker["generation"], "reason": reason });
    // Hash the selected HBC too: retaining a marker while replacing its bundle
    // must not promote older evidence. Re-read the generation after hashing so
    // an atomic publication during observation fails closed for this poll.
    let hash = bundle(&read(&dist.join("metadata.json"))).ok()
        .and_then(|relative| artifact(&dist.join(relative)).ok()).map(|a| a["sha256"].clone());
    after_hash();
    let changed = || json!({ "state": "unverified", "transient": true, "reason": "publication changed during observation" });
    if read(&root.join("latest.json")) != request || read(&marker_path) != marker { return Some(changed()); }
    if !marker["generation"].is_string() || hash.as_ref() != Some(&marker["exportHash"]) || read(&marker_path) != marker {
        return Some(missing("publication identity is missing, changed or unverifiable"));
    }
    if !matches_generation(&request, &marker) || !request["artifacts"].is_string() {
        if marker["mode"] == "skipped" {
            return Some(json!({ "state": "skipped", "exportHash": marker["exportHash"], "generation": marker["generation"],
                "reason": format!("no proof for the current export ({}); status handoff missing or stale", marker["reason"].as_str().unwrap_or("skipped")) }));
        }
        return Some(missing("publication handoff missing or stale"));
    }
    let dir = PathBuf::from(request["artifacts"].as_str().unwrap());
    let mut result = read(&dir.join("result.json"));
    if result.is_null() {
        result = request.clone();
        result["state"] = json!("pending"); result["log"] = json!(dir.join("background.log"));
        let running = ["driver.json", "worker.json", "launch.json"].iter().any(|p| identity_alive(&read(&dir.join(p))["process"]));
        if !running && now().saturating_sub(result["publishedAt"].as_u64().unwrap_or(0) as u128) > 5000 {
            result["state"] = json!("failed"); result["reason"] = json!("background worker exited without a result; next export recovers custody");
        }
    }
    if !matches_generation(&result, &marker) { return Some(missing("proof result belongs to another publication")); }
    if marker["mode"] == "skipped" && result["state"] != "skipped" { return Some(missing("current export was skipped")); }
    if read(&root.join("latest.json")) != request || read(&marker_path) != marker { return Some(changed()); }
    Some(result)
}
pub(crate) fn doctor_summary(project: &Path) -> Option<String> { latest(project).as_ref().map(summary) }
pub(super) fn status(args: &[String]) -> i32 {
    if args.iter().any(|a| !["--wait", "--if-present", "--json"].contains(&a.as_str())) {
        eprintln!("E_WITNESS_INPUT: use snapback4 witness status [--wait] [--json]"); return 1;
    }
    let project = match std::env::current_dir() { Ok(p) => p, Err(e) => { eprintln!("{e}"); return 1; } };
    status_at(&project, args)
}
fn status_at(project: &Path, args: &[String]) -> i32 { status_observed(args, || latest(project)) }
fn status_observed(args: &[String], mut observe: impl FnMut() -> Option<Value>) -> i32 {
    let wait = args.iter().any(|a| a == "--wait");
    if wait { signals(); }
    let mut unstable_since = None;
    loop {
        let Some(result) = observe() else {
            if !args.iter().any(|a| a == "--if-present") { println!("native smoke: no background export result; run npm run export:ios"); }
            return 2;
        };
        let transient = result["state"] == "unverified" && result["transient"] == true;
        if !transient { unstable_since = None; }
        let retry = transient && unstable_since.get_or_insert_with(Instant::now).elapsed() < Duration::from_secs(5);
        if wait && (result["state"] == "pending" || retry) {
            if interrupted().is_err() { return 130; }
            sleep(Duration::from_millis(100)); continue;
        }
        if args.iter().any(|a| a == "--json") { println!("{result}"); } else { println!("{}", summary(&result)); }
        return match result["state"].as_str() { Some("passed") => 0, Some("failed") => 1, _ => 2 };
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(target_os = "macos")]
    #[test]
    fn background_policy_can_be_applied_to_an_owned_external_child() {
        let mut command = Command::new("/bin/sleep"); command.arg("10");
        let mut child = Owned::spawn(&mut command).unwrap();
        let result = lower_app(child.0.id());
        child.stop(libc::SIGTERM).unwrap();
        assert_eq!(result.unwrap()["darwinBackgroundSet"], true);
    }
    #[test]
    fn sleep_clock_requires_actual_suspended_time() {
        assert!(!slept(100, 100)); assert!(!slept(100, 1099));
        assert!(slept(100, 1101)); assert!(!slept(200, 100));
    }
    #[test]
    fn status_distinguishes_skips_from_product_failures() {
        assert!(environment_skip(&json!({ "phase": "environment", "environmentCondition": "missing-runtime", "error": "E_WITNESS_PLATFORM: missing" })));
        assert!(!environment_skip(&json!({ "phase": "environment", "environmentCondition": "simulator-create", "error": "E_WITNESS_TIMEOUT: create" })));
        assert!(!environment_skip(&json!({ "phase": "preparation", "error": "E_WITNESS_BUILD: failed" })));
        assert_eq!(timestamp(&json!(1791068400000u64)), "2026-10-03T23:00:00Z");
    }
    #[test]
    fn witness_status_rechecks_latest_after_hash_and_wait_retries_transient_observation() {
        let root = std::env::temp_dir().join(format!("sb4-status-observation-{}-{}", std::process::id(), now()));
        let dir = root.join("artifacts/native-smoke/1-1"); fs::create_dir_all(&dir).unwrap();
        fs::create_dir_all(root.join("dist")).unwrap();
        fs::write(root.join("dist/bundle"), "same bytes").unwrap();
        save(&root.join("dist/metadata.json"), &json!({"fileMetadata":{"ios":{"bundle":"bundle"}}})).unwrap();
        let record = json!({"generation":"old","exportHash":artifact(&root.join("dist/bundle")).unwrap()["sha256"],"artifacts":dir,"mode":"background","state":"passed"});
        save(&root.join("dist/.snapback4-publication.json"), &record).unwrap();
        save(&root.join("artifacts/native-smoke/latest.json"), &record).unwrap();
        save(&dir.join("result.json"), &record).unwrap();
        assert_eq!(latest(&root).unwrap()["state"], "passed");
        let changed = latest_observed(&root, || {
            let mut next = record.clone(); next["generation"] = json!("new");
            save(&root.join("artifacts/native-smoke/latest.json"), &next).unwrap();
        }).unwrap();
        assert_eq!(changed["state"], "unverified"); assert_eq!(changed["transient"], true);
        let mut polls = 0;
        assert_eq!(status_observed(&["--wait".into()], || {
            polls += 1;
            Some(if polls == 1 { changed.clone() } else { json!({"state":"skipped","generation":"new"}) })
        }), 2);
        assert_eq!(polls, 2);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn witness_passed_outcome_survives_post_driver_compression_failure_fixture() {
        let Ok(root) = std::env::var("SB4_RETENTION_PASSED_FIXTURE") else { return; };
        let root = PathBuf::from(root); let dir = root.join("artifacts/native-smoke/9999999999999-1");
        fs::create_dir_all(&dir).unwrap(); fs::create_dir(root.join("dist")).unwrap();
        let record = json!({"generation":"passed","exportHash":"hash","target":root.join("dist"),"artifacts":dir,"mode":"background"});
        save(&root.join("dist/.snapback4-publication.json"), &record).unwrap();
        save(&root.join("artifacts/native-smoke/latest.json"), &record).unwrap();
        save(&dir.join("request.json"), &record).unwrap();
        save(&dir.join("finished.json"), &json!({})).unwrap();
        for i in 1..=6 {
            let old = root.join(format!("artifacts/native-smoke/{i}-1")); fs::create_dir(&old).unwrap();
            save(&old.join("finished.json"), &json!({})).unwrap(); save(&old.join("result.json"), &json!({"state":"passed"})).unwrap();
        }
        let completed = finish(&dir, "passed", "prime/offline/restart").unwrap();
        defer_retention(&dir, Some(&dir));
        assert_eq!(read(&dir.join("result.json")), completed);
    }
    #[test]
    fn witness_passed_outcome_survives_post_driver_compression_failure() {
        use std::os::unix::fs::PermissionsExt;
        let root = std::env::temp_dir().join(format!("sb4-retention-passed-{}-{}", std::process::id(), now()));
        fs::create_dir_all(root.join("bin")).unwrap();
        fs::write(root.join("bin/gzip"), "#!/bin/sh\nexit 99\n").unwrap();
        fs::set_permissions(root.join("bin/gzip"), fs::Permissions::from_mode(0o755)).unwrap();
        let output = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "verbs::witness::background::tests::witness_passed_outcome_survives_post_driver_compression_failure_fixture", "--nocapture"])
            .env("SB4_RETENTION_PASSED_FIXTURE", &root)
            .env("PATH", format!("{}:{}", root.join("bin").display(), std::env::var("PATH").unwrap()))
            .current_dir(&root).output().unwrap();
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        assert!(String::from_utf8_lossy(&output.stderr).contains("receipt compression failed"));
        fs::remove_dir_all(root).unwrap();
    }

}
