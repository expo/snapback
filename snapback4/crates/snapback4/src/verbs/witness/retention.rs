//! @ref LLP 3000.030#15 — retention has the same owner-death custody as preparation.
use super::*;
use std::os::unix::fs::MetadataExt;

const BUDGET: Duration = Duration::from_secs(30);

pub(super) fn run(root: &Path, completed: Option<&Path>, cancelled: impl Fn() -> Result<()>) -> Result<()> {
    run_with_budget(root, completed, cancelled, BUDGET, false)
}

// Called only after publication releases its lock. The detached custodian owns
// an export lease until the wrapper exits, then prunes under native custody.
pub(super) fn schedule(dir: &Path, export: &File) {
    let result = (|| -> Result<()> {
        let log = OpenOptions::new().create(true).append(true).open(dir.join("background.log")).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
        #[cfg(target_os = "macos")]
        let mut command = { let mut c = Command::new("/usr/sbin/taskpolicy"); c.args(["-b", "-c", "background"]).arg(background::executable()); c };
        #[cfg(not(target_os = "macos"))]
        let mut command = Command::new(background::executable());
        command.args(["witness", "export-maintain"]).arg(dir).stdin(Stdio::null())
            .stdout(log.try_clone().map_err(|e| error("E_WITNESS_ARTIFACT", e))?).stderr(log);
        let child = background::spawn_owned(command, export, None, true)?;
        recovery::write(&dir.join("maintenance-launch.json"), &json!({ "process": recovery::identity(child.id()), "at": now() }))
    })();
    if let Err(e) = result { eprintln!("witness: evidence cleanup deferred: {e}; log: {} (Hermes export succeeded)", dir.join("background.log").display()); }
}

pub(super) fn maintain(args: &[String]) -> i32 {
    background::signals();
    let result = (|| -> Result<()> {
        let started = Instant::now();
        let awake = background::sleep_clock();
        if args.len() != 1 { return Err(error("E_WITNESS_INPUT", "export-maintain requires its leased export directory")); }
        let dir = fs::canonicalize(&args[0]).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
        let project = fs::canonicalize(".").map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
        if dir.parent() != Some(project.join("artifacts/native-smoke").as_path()) {
            return Err(error("E_WITNESS_INPUT", "maintenance is not this project's export"));
        }
        let export = background::inherited(3)?;
        let held = export.metadata().map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
        let named = fs::metadata(dir.join("export.lock")).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
        if held.dev() != named.dev() || held.ino() != named.ino() { return Err(error("E_WITNESS_PROCESS", "maintenance does not own this export lease")); }
        export.try_lock().map_err(|e| error("E_WITNESS_PROCESS", e))?;
        let wrapper = recovery::read(&dir.join("live.json"))["wrapper"].clone();
        while wrapper["pid"].as_u64().and_then(|pid| recovery::identity(pid as u32)).as_ref() == Some(&wrapper) {
            interrupted()?;
            if background::slept(awake, background::sleep_clock()) { return Err(error("E_WITNESS_INTERRUPTED", "host slept during evidence retention")); }
            if started.elapsed() >= BUDGET { return Err(error("E_WITNESS_ARTIFACT", "evidence retention exceeded its 30-second deadline waiting for export custody; deferred")); }
            sleep(Duration::from_millis(20));
        }
        // The last scan must be able to prune its own run if newer exports
        // finished first. Keeping this lease during the scan would leave a
        // sixth full snapshot when maintainers finish out of publication order.
        drop(export);
        // Waiting is inside the supervised group and the same 30-second budget.
        // A final skipped export must not lose its scan merely because an older
        // retention scan is still completing. Proof outcomes are never changed.
        run_with_budget(dir.parent().unwrap(), None, || Ok(()), BUDGET.saturating_sub(started.elapsed()), true)
    })();
    match result { Ok(()) => 0, Err(e) => { eprintln!("witness: evidence cleanup deferred: {e}"); 1 } }
}

fn run_with_budget(root: &Path, completed: Option<&Path>, cancelled: impl Fn() -> Result<()>, budget: Duration, wait_lock: bool) -> Result<()> {
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
    if wait_lock { args.push(std::ffi::OsStr::new("--wait-lock")); }
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
