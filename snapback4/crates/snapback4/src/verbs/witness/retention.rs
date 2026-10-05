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
fn runnable(root: &Path) -> bool { ["maintenance-request.json", "maintenance-claimed.json"].iter().any(|n| root.join(n).exists()) }
fn pending(root: &Path) -> bool { runnable(root) || root.join("maintenance-parked.json").exists() }
fn park(root: &Path) -> Result<()> {
    fs::rename(root.join("maintenance-claimed.json"), root.join("maintenance-parked.json")).map_err(|e| error("E_WITNESS_ARTIFACT", e))
}
// Claim by rename, not deletion: a killed custodian cannot acknowledge work.
// New requests have a separate name and cannot be erased by this scan's ack.
fn claim(root: &Path) -> Result<()> {
    let fresh = match fs::rename(root.join("maintenance-request.json"), root.join("maintenance-claimed.json")) {
        Ok(()) => true,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => false,
        Err(e) => return Err(error("E_WITNESS_ARTIFACT", e)),
    };
    let previous = recovery::read(&root.join("maintenance-claimed.json"));
    if !fresh && previous.is_null() { return Err(error("E_WITNESS_ARTIFACT", "missing maintenance claim")); }
    // A producer may still be writing its dirty-bit descriptor after rename.
    // A fresh request is authorized by the name, never its partially read JSON.
    let attempts = if fresh { 0 } else { previous["attempts"].as_u64().unwrap_or(0) };
    // Persist the retry bound across either peer's death. A fresh publication
    // supersedes the old claim and can authorize a new attempt.
    if attempts >= 3 {
        park(root)?;
        return Err(error("E_WITNESS_ARTIFACT", "maintenance claim interrupted three times; request parked for a later export"));
    }
    recovery::write(&root.join("maintenance-claimed.json"), &json!({ "state": "claimed", "attempts": attempts + 1 }))?;
    recovery::remove(&root.join("maintenance-parked.json"))
}
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
    if !try_lock(&publication)? { return Ok(false); }
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
    let journal = recovery::read(&dir.join("live.json"));
    Ok(!recovery::alive(&journal["owner"]) && !recovery::alive(&journal["wrapper"]))
}
fn kick(root: &Path) -> Result<Value> { kick_until(root, now() + OBSERVER_BUDGET.as_millis()) }
fn kick_until(root: &Path, expires: u128) -> Result<Value> {
    if !runnable(root) { return Ok(Value::Null); }
    if now() >= expires {
        return Err(error("E_WITNESS_ARTIFACT", "retention observation exceeded its 60-minute deadline; request parked for a later export"));
    }
    let queued = lock_file(root, "maintenance-next.lock")?;
    if !try_lock(&queued)? { return Ok(recovery::read(&root.join("maintenance-next.json"))); }
    if !runnable(root) { return Ok(Value::Null); }
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
        let mut failed_starts = 0;
        loop {
            observation_guard(started, expires, awake)?;
            if !runnable(&root) {
                drop(queued);
                // Close the ordinary exit/request race. A contender either
                // owns next or sees us; recheck after releasing our lease.
                kick_until(&root, expires)?;
                return Ok(());
            }
            let active = lock_file(&root, "maintenance.lock")?;
            if !try_lock(&active)? { sleep(Duration::from_millis(100)); continue; }
            let available = lock_file(&root, "retention.lock")?;
            if !try_lock(&available)? { drop(active); sleep(Duration::from_millis(100)); continue; }
            if !ready(&root)? { drop(available); drop(active); sleep(Duration::from_millis(100)); continue; }
            drop(available);
            let mut command = Command::new(background::executable());
            command.args(["witness", "export-maintain-scan"]).arg(&root).arg(expires.to_string());
            // Keep the pending lease here. The separate scan custodian owns
            // native work; either peer survives the other's unexpected death.
            let mut child = background::spawn_owned(command, &active, None, false)?;
            drop(active);
            let scan_started = Instant::now();
            let mut cancellation = None;
            let mut forced = false;
            loop {
                if let Some(status) = child.try_wait().map_err(|e| error("E_WITNESS_PROCESS", e))? {
                    failed_starts = if status.success() { 0 } else { failed_starts + 1 };
                    break;
                }
                if cancellation.is_none() {
                    cancellation = observation_guard(started, expires, awake).err();
                    if cancellation.is_some() { unsafe { libc::kill(child.id() as i32, libc::SIGTERM); } }
                }
                // 30 s work + existing 60 s maximum group drain + launch slack.
                // This is our unreaped direct child, never a discovered PID.
                if scan_started.elapsed() >= Duration::from_secs(105) {
                    return Err(error("E_WITNESS_PROCESS", "maintenance custodian did not exit after bounded cancellation; claim preserved"));
                }
                if !forced && scan_started.elapsed() >= Duration::from_secs(100) {
                    child.kill().map_err(|e| error("E_WITNESS_PROCESS", e))?;
                    forced = true;
                }
                sleep(Duration::from_millis(100));
            }
            if let Some(e) = cancellation {
                drop(queued);
                if !e.contains("host slept") { let _ = kick_until(&root, expires); }
                return Err(e);
            }
            if failed_starts >= 3 {
                if root.join("maintenance-claimed.json").exists() { park(&root)?; }
                return Err(error("E_WITNESS_ARTIFACT", "maintenance custodian failed three times; request parked for a later export"));
            }
            // Even a lock acquired after readiness cannot create a hot loop.
            sleep(Duration::from_millis(100));
        }
    })();
    match result { Ok(()) => 0, Err(e) => { eprintln!("witness: evidence cleanup deferred: {e}"); 1 } }
}

// Internal scan custodian. Its parent owns the pending lease. If the parent
// dies, this bounded scan finishes and resumes observation; if this process
// dies, the parent resumes its still-durable claim after native custody drains.
pub(super) fn scan(args: &[String]) -> i32 {
    background::signals();
    let result = (|| -> Result<()> {
        if args.len() != 2 { return Err(error("E_WITNESS_INPUT", "maintenance scan requires its leased claim and deadline")); }
        let root = fs::canonicalize(&args[0]).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
        let expires = args[1].parse::<u128>().map_err(|e| error("E_WITNESS_INPUT", e))?;
        if root != fs::canonicalize(".").map_err(|e| error("E_WITNESS_ARTIFACT", e))?.join("artifacts/native-smoke") {
            return Err(error("E_WITNESS_INPUT", "maintenance is not this project's queue"));
        }
        let active = background::inherited(3)?;
        let held = active.metadata().map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
        let named = fs::metadata(root.join("maintenance.lock")).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
        if held.dev() != named.dev() || held.ino() != named.ino() || !try_lock(&active)? {
            return Err(error("E_WITNESS_PROCESS", "maintenance scan does not own its claim lease"));
        }
        // Claim only AFTER both peers exist; death in the launch gap leaves
        // the observer able to retry, never a claimed request without a peer.
        claim(&root)?;
        let count = recovery::read(&root.join("maintenance-active.json"))["attempt"].as_u64().unwrap_or(0).saturating_add(1);
        recovery::write(&root.join("maintenance-active.json"), &json!({ "process": recovery::identity(std::process::id()), "at": now(), "attempt": count }))?;
        let observer = recovery::read(&root.join("maintenance-next.json"))["process"].clone();
        let result = run_with_budget(&root, None, || {
            if !recovery::alive(&observer) { return Err(error("E_WITNESS_INTERRUPTED", "maintenance observer exited; resuming claim after drain")); }
            if now() >= expires { Err(error("E_WITNESS_ARTIFACT", "retention observation deadline expired")) } else { Ok(()) }
        }, BUDGET);
        let busy = result.as_ref().err().is_some_and(|e| e.contains("retention lock busy"));
        if result.is_ok() { recovery::remove(&root.join("maintenance-claimed.json"))?; }
        else if busy { request(&root)?; recovery::remove(&root.join("maintenance-claimed.json"))?; }
        else if recovery::alive(&observer) && !INTERRUPTED.load(Ordering::Relaxed) { park(&root)?; }
        recovery::write(&root.join("maintenance-result.json"), &json!({ "finishedAt": now(), "error": result.as_ref().err(), "pending": pending(&root) }))?;
        drop(active);
        // Usually the observer is still alive. If it died, we take its free
        // queue lease and restore the one observer, with the original deadline.
        if let Err(e) = kick_until(&root, expires) { eprintln!("witness: evidence cleanup deferred: {e}"); }
        // This internal custodian has handled the outcome durably. Busy work
        // remains pending and ordinary failures are parked/logged; neither is
        // a failed process start. Only unhandled/startup errors (or signals)
        // consume the observer's failed-start budget.
        if let Err(e) = result { eprintln!("witness: evidence cleanup deferred: {e}"); }
        Ok(())
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
    fn claim_ack_never_erases_a_new_request_and_crash_retries_are_bounded() {
        let root = std::env::temp_dir().join(format!("sb4-retention-claim-{}-{}", std::process::id(), now()));
        fs::create_dir_all(&root).unwrap();
        // create_new can become visible before the producer writes its JSON.
        let mut producer = File::create(root.join("maintenance-request.json")).unwrap();
        claim(&root).unwrap();
        producer.write_all(b"{\"state\":\"pending\"}").unwrap();
        assert_eq!(recovery::read(&root.join("maintenance-claimed.json"))["attempts"], 1);
        request(&root).unwrap(); // newer export arrives before acknowledgement
        recovery::remove(&root.join("maintenance-claimed.json")).unwrap();
        assert!(runnable(&root));
        for attempt in 1..=3 { claim(&root).unwrap(); assert_eq!(recovery::read(&root.join("maintenance-claimed.json"))["attempts"], attempt); }
        assert!(claim(&root).unwrap_err().contains("interrupted three times"));
        assert!(pending(&root)); assert!(!runnable(&root));
        request(&root).unwrap(); claim(&root).unwrap();
        assert_eq!(recovery::read(&root.join("maintenance-claimed.json"))["attempts"], 1);
        assert!(!root.join("maintenance-parked.json").exists());
        recovery::remove(&root.join("maintenance-claimed.json")).unwrap();
        assert!(!pending(&root));
        fs::remove_dir_all(root).unwrap();
    }

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
