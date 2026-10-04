//! @ref LLP 3000.030#15 — retention has the same owner-death custody as preparation.
use super::*;

const BUDGET: Duration = Duration::from_secs(30);

pub(super) fn run(root: &Path, completed: Option<&Path>, cancelled: impl Fn() -> Result<()>) -> Result<()> {
    run_with_budget(root, completed, cancelled, BUDGET)
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
    let mut args = vec![std::ffi::OsStr::new("witness"), std::ffi::OsStr::new("export-retain"), root.as_os_str()];
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
