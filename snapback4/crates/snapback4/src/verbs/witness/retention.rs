//! @ref LLP 3000.030#15 — retention has the same owner-death custody as preparation.
use super::*;
use std::os::unix::fs::MetadataExt;

const BUDGET: Duration = Duration::from_secs(30);
const OBSERVER_BUDGET: Duration = Duration::from_secs(60 * 60);

pub(super) fn run(root: &Path, completed: Option<&Path>, cancelled: impl Fn() -> Result<()>) -> Result<()> {
    let result = attempt(root, completed, cancelled);
    // A proof-bound scan can encounter a publication or export lease too.
    if result.is_ok() && pending(root) && fs::canonicalize("artifacts/native-smoke").is_ok_and(|project_root| fs::canonicalize(root).ok().as_ref() == Some(&project_root)) {
        if let Err(e) = kick(root) { eprintln!("witness: evidence cleanup deferred: {e}"); }
    }
    result
}
fn attempt(root: &Path, completed: Option<&Path>, cancelled: impl Fn() -> Result<()>) -> Result<()> {
    let result = run_with_budget(root, completed, cancelled, BUDGET);
    // A failed attempt is still deferred work. Leave it durable, but do not
    // immediately retry a persistent compressor/recovery error without a new
    // request. An already queued observer may still cover a later publication.
    if result.is_err() { request(root)?; }
    result
}

// One durable dirty bit selects the current project state when claimed. New
// publications coalesce here rather than enqueueing historical run directories.
pub(super) fn request(root: &Path) -> Result<()> {
    match OpenOptions::new().write(true).create_new(true).open(root.join("maintenance-request.json")) {
        Ok(mut file) => file.write_all(b"{\"state\":\"pending\"}\n").map_err(|e| error("E_WITNESS_ARTIFACT", e)),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
        Err(e) => Err(error("E_WITNESS_ARTIFACT", e)),
    }
}
fn pending(root: &Path) -> bool { root.join("maintenance-request.json").exists() }
fn lock_file(root: &Path, name: &str) -> Result<File> {
    OpenOptions::new().create(true).read(true).write(true).truncate(false).open(root.join(name)).map_err(|e| error("E_WITNESS_ARTIFACT", e))
}
fn try_lock(file: &File) -> Result<bool> {
    match file.try_lock() { Ok(()) => Ok(true), Err(std::fs::TryLockError::WouldBlock) => Ok(false), Err(e) => Err(error("E_WITNESS_ARTIFACT", e)) }
}
// These are short, passive probes, never leases held across a scan. A race
// after the probe is handled by the worker recording deferred work again.
fn ready(root: &Path) -> Result<bool> {
    let initializing = lock_file(root, "initialization.lock")?;
    if !try_lock(&initializing)? { return Ok(false); }
    drop(initializing);
    let publication = lock_file(root, "publication.lock")?;
    match publication.try_lock_shared() {
        Ok(()) => {},
        Err(std::fs::TryLockError::WouldBlock) => return Ok(false),
        Err(e) => return Err(error("E_WITNESS_ARTIFACT", e)),
    }
    drop(publication);
    for entry in fs::read_dir(root).map_err(|e| error("E_WITNESS_ARTIFACT", e))? {
        let entry = entry.map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if !entry.file_type().is_ok_and(|t| t.is_dir()) || !name.split_once('-').is_some_and(|(a,b)| a.parse::<u128>().is_ok() && b.parse::<u32>().is_ok()) { continue; }
        if !ready_run(&entry.path())? { return Ok(false); }
    }
    Ok(true)
}
fn ready_run(dir: &Path) -> Result<bool> {
    for name in ["run.lock", "export.lock"] {
        let file = match OpenOptions::new().create(true).read(true).write(true).truncate(false).open(dir.join(name)) {
            Ok(file) => file,
            // A failed initializer may remove its shell after read_dir. Absence
            // means this discovery is already covered, not a parked I/O failure.
            Err(e) if e.kind() == std::io::ErrorKind::NotFound && fs::symlink_metadata(dir).is_err_and(|e| e.kind() == std::io::ErrorKind::NotFound) => return Ok(true),
            Err(e) => return Err(error("E_WITNESS_ARTIFACT", e)),
        };
        if !try_lock(&file)? { return Ok(false); }
    }
    Ok(!recovery::alive(&recovery::read(&dir.join("live.json"))["owner"]))
}
fn kick(root: &Path) -> Result<Value> { kick_until(root, now() + OBSERVER_BUDGET.as_millis()) }
fn kick_until(root: &Path, expires: u128) -> Result<Value> {
    if !pending(root) { return Ok(Value::Null); }
    if now() >= expires {
        return Err(error("E_WITNESS_ARTIFACT", "retention observation exceeded its 60-minute deadline; request parked for a later export"));
    }
    let queued = lock_file(root, "maintenance-next.lock")?;
    if !try_lock(&queued)? { return Ok(recovery::read(&root.join("maintenance-next.json"))); }
    if !pending(root) { return Ok(Value::Null); }
    let log = OpenOptions::new().create(true).append(true).open(root.join("maintenance.log")).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
    #[cfg(target_os = "macos")]
    let mut command = { let mut c = Command::new("/usr/sbin/taskpolicy"); c.args(["-b", "-c", "background"]).arg(background::executable()); c };
    #[cfg(not(target_os = "macos"))]
    let mut command = Command::new(background::executable());
    command.args(["witness", "export-maintain"]).arg(root).arg(expires.to_string()).stdin(Stdio::piped())
        .stdout(log.try_clone().map_err(|e| error("E_WITNESS_ARTIFACT", e))?).stderr(log);
    let mut child = background::spawn_owned(command, &queued, None, true)?;
    let record = json!({ "state": "pending", "process": recovery::identity(child.id()), "at": now(), "expiresAt": expires });
    recovery::write(&root.join("maintenance-next.json"), &record)?;
    drop(queued);
    child.stdin.take().unwrap().write_all(b"s").map_err(|e| error("E_WITNESS_PROCESS", e))?;
    Ok(record)
}

// Called after publication releases its lock. A busy request records pending
// and returns. Only one pending observer and one active scan may exist.
pub(super) fn schedule(dir: &Path, _export: &File) {
    let root = dir.parent().unwrap();
    let result = (|| -> Result<()> {
        request(root)?;
        let record = kick(root)?;
        recovery::write(&dir.join("maintenance-launch.json"), &json!({ "state": "pending", "process": record["process"], "queue": root.join("maintenance-request.json"), "at": now() }))
    })();
    if let Err(e) = result { eprintln!("witness: evidence cleanup deferred: {e}; log: {} (Hermes export succeeded)", root.join("maintenance.log").display()); }
}

fn observation_guard(started: Instant, expires: u128, awake: u64) -> Result<()> {
    interrupted()?;
    if now() >= expires || started.elapsed() >= OBSERVER_BUDGET {
        return Err(error("E_WITNESS_ARTIFACT", "retention observation exceeded its 60-minute deadline; request parked for a later export"));
    }
    if background::slept(awake, background::sleep_clock()) { return Err(error("E_WITNESS_INTERRUPTED", "host slept during pending evidence retention")); }
    Ok(())
}

pub(super) fn maintain(args: &[String]) -> i32 {
    background::signals();
    let result = (|| -> Result<()> {
        if args.len() != 2 { return Err(error("E_WITNESS_INPUT", "export-maintain requires its leased queue and deadline")); }
        let expires = args[1].parse::<u128>().map_err(|e| error("E_WITNESS_INPUT", e))?.min(now() + OBSERVER_BUDGET.as_millis());
        let started = Instant::now();
        let root = fs::canonicalize(&args[0]).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
        let project = fs::canonicalize(".").map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
        if root != project.join("artifacts/native-smoke") { return Err(error("E_WITNESS_INPUT", "maintenance is not this project's queue")); }
        let queued = background::inherited(3)?;
        let held = queued.metadata().map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
        let named = fs::metadata(root.join("maintenance-next.lock")).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
        if held.dev() != named.dev() || held.ino() != named.ino() || !try_lock(&queued)? { return Err(error("E_WITNESS_PROCESS", "maintenance does not own the pending queue lease")); }
        let awake = background::sleep_clock();
        let mut gate = libc::pollfd { fd: 0, events: libc::POLLIN, revents: 0 };
        loop {
            observation_guard(started, expires, awake)?;
            let polled = unsafe { libc::poll(&mut gate, 1, 100) };
            if polled > 0 { break; }
            if polled < 0 && std::io::Error::last_os_error().kind() != std::io::ErrorKind::Interrupted {
                return Err(error("E_WITNESS_PROCESS", std::io::Error::last_os_error()));
            }
        }
        let mut start = [0];
        std::io::stdin().read_exact(&mut start).map_err(|e| error("E_WITNESS_PROCESS", e))?;
        if start != [b's'] { return Err(error("E_WITNESS_PROCESS", "missing maintenance launch gate")); }
        loop {
            observation_guard(started, expires, awake)?;
            if !pending(&root) {
                drop(queued);
                // Close the ordinary exit/request race without holding a lock
                // across process exit. A contender either owns next or sees us.
                kick_until(&root, expires)?;
                return Ok(());
            }
            let active = lock_file(&root, "maintenance.lock")?;
            if !try_lock(&active)? { sleep(Duration::from_millis(100)); continue; }
            let available = lock_file(&root, "retention.lock")?;
            if !try_lock(&available)? { drop(active); sleep(Duration::from_millis(100)); continue; }
            if !ready(&root)? { drop(available); drop(active); sleep(Duration::from_millis(100)); continue; }
            drop(available);
            recovery::remove(&root.join("maintenance-request.json"))?;
            let count = recovery::read(&root.join("maintenance-active.json"))["attempt"].as_u64().unwrap_or(0).saturating_add(1);
            recovery::write(&root.join("maintenance-active.json"), &json!({ "process": recovery::identity(std::process::id()), "at": now(), "attempt": count }))?;
            drop(queued);
            // No native work group waits for the retention lock. The probe can
            // race a proof's maintenance, so a refused claim just requeues.
            let result = attempt(&root, None, || Ok(()));
            let busy = result.as_ref().err().is_some_and(|e| e.contains("retention lock busy"));
            recovery::write(&root.join("maintenance-result.json"), &json!({ "finishedAt": now(), "error": result.as_ref().err(), "pending": pending(&root) }))?;
            drop(active);
            if result.is_ok() || busy { kick_until(&root, expires)?; }
            return result;
        }
    })();
    match result { Ok(()) => 0, Err(e) => { eprintln!("witness: evidence cleanup deferred: {e}"); 1 } }
}

fn run_with_budget(root: &Path, completed: Option<&Path>, cancelled: impl Fn() -> Result<()>, budget: Duration) -> Result<()> {
    interrupted()?;
    cancelled()?;
    let started = Instant::now();
    let awake = background::sleep_clock();
    fs::create_dir_all(root).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
    let root = fs::canonicalize(root).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
    // Never overwrite another custodian's journal. A killed owner can leave
    // this small recovery record; it is not one of the retained proof slots.
    let dir = root.join(format!(".retention-{}-{}", std::process::id(), now()));
    fs::create_dir(&dir).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
    let options = Options::parse(&["ios".into(), "--build".into(), ".".into(), "--smoke".into(),
        "--artifacts".into(), dir.to_string_lossy().into_owned()])?;
    let binary = background::executable();
    let mut args = vec![std::ffi::OsStr::new("witness"), std::ffi::OsStr::new("export-retain-worker"), dir.as_os_str(), root.as_os_str()];
    if let Some(completed) = completed { args.push(completed.as_os_str()); }
    // Native supervisor + unreaped anchor + kernel owner-exit watcher. The
    // complete retention operation, including gzip and lock acquisition, lives
    // inside this owned group, even before a background driver exists.
    let mut child = preparation::PreparationProcess::launch(&options, binary.as_os_str(), &args, "retention")?;
    let result = (|| loop {
        interrupted()?;
        cancelled()?;
        if background::slept(awake, background::sleep_clock()) {
            return Err(error("E_WITNESS_INTERRUPTED", "host slept during evidence retention"));
        }
        if started.elapsed() >= budget {
            return Err(error("E_WITNESS_ARTIFACT", "evidence retention exceeded its 30-second deadline; deferred"));
        }
        if let Some(status) = child.status()? {
            if status.success() { return Ok(()); }
            let detail = fs::read_to_string(dir.join("retention-stderr.log")).unwrap_or_default();
            return Err(error("E_WITNESS_ARTIFACT", format!("evidence retention failed: {detail}")));
        }
        sleep(Duration::from_millis(20));
    })();
    // Keep the existing WD drain (5 s idle / 60 s hard); this is additional
    // cleanup time, never an unbounded wait or a fresh retention budget.
    child.cleanup()?;
    recovery::remove(&dir)?;
    result
}

// Internal entry refuses ordinary/manual invocation. The worker must be the
// native anchor's direct child in its recorded group, after the custody gate.
pub(super) fn worker(args: &[String]) -> i32 {
    let guarded = (|| -> Result<()> {
        if args.len() < 2 { return Err(error("E_WITNESS_PROCESS", "retention worker requires native custody")); }
        let record = recovery::read(&Path::new(&args[0]).join("retention-group.json"));
        let group = unsafe { libc::getpgrp() };
        if group != unsafe { libc::getppid() } || record["group"].as_i64() != Some(group as i64)
            || record["leader"] != recovery::birth(group as u32).unwrap_or(Value::Null)
            || record["leader"].is_null() {
            return Err(error("E_WITNESS_PROCESS", "retention worker requires native custody"));
        }
        Ok(())
    })();
    match guarded { Ok(()) => recovery::retention_command(&args[1..]), Err(e) => { eprintln!("{e}"); 1 } }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn observer_covers_a_discovery_removed_by_its_failed_initializer() {
        let root = std::env::temp_dir().join(format!("sb4-retention-discovery-{}-{}", std::process::id(), now()));
        let dir = root.join("1-1"); fs::create_dir_all(&dir).unwrap();
        let discovered = fs::read_dir(&root).unwrap().next().unwrap().unwrap().path();
        let live = preparation::lease(&dir.join("export.lock")).unwrap();
        assert!(!ready_run(&discovered).unwrap(), "an actual lease owner requires passive waiting");
        drop(live);
        fs::remove_dir_all(&dir).unwrap();
        assert!(ready_run(&discovered).unwrap(), "a vanished entry is already repaired, not pending on an absent owner");
        assert!(!dir.exists(), "probing must not recreate an ownerless shell");
        fs::create_dir(&dir).unwrap();
        std::os::unix::fs::symlink(root.join("missing-parent/lock"), dir.join("export.lock")).unwrap();
        assert!(ready_run(&discovered).is_err(), "a broken lock in a surviving directory is an explicit error, not permission to retry forever");
        fs::remove_dir_all(root).unwrap();
    }
}
