//! @ref LLP 3000.030#15 — retention has the same owner-death custody as preparation.
use super::*;
use std::os::unix::fs::MetadataExt;
use std::sync::atomic::AtomicU64;

const BUDGET: Duration = Duration::from_secs(30);
const OBSERVER_BUDGET: Duration = Duration::from_secs(60 * 60);

// Compile out argument evaluation too: release custody does no diagnostic work.
#[cfg(debug_assertions)]
#[path = "retention_trace.rs"]
mod trace_writer;
macro_rules! trace {
    ($root:expr, $step:expr, $detail:expr) => {
        #[cfg(debug_assertions)]
        if std::env::var_os("SNAPBACK4_DEBUG_RETENTION").is_some() {
            trace_writer::emit($root, $step, $detail);
        }
    };
}

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
// Complete records become visible in one rename. Unique temporary names also
// prevent two producers from truncating each other's in-progress write.
static RECORD: AtomicU64 = AtomicU64::new(0);
fn atomic_record(path: &Path, value: &Value) -> Result<()> {
    let temporary = path.with_extension(format!("{}-{}-{}.tmp", std::process::id(), now(), RECORD.fetch_add(1, Ordering::Relaxed)));
    let mut file = OpenOptions::new().create_new(true).write(true).open(&temporary).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
    if path.file_name().is_some_and(|n| n == "maintenance-request.json") { checkpoint(path.parent().unwrap(), "request-created"); }
    file.write_all(&serde_json::to_vec(value).unwrap()).and_then(|_| file.sync_all()).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
    if path.file_name().is_some_and(|n| n == "maintenance-request.json") { checkpoint(path.parent().unwrap(), "request-prepared"); }
    fs::rename(temporary, path).map_err(|e| error("E_WITNESS_ARTIFACT", e))
}
pub(super) fn request(root: &Path) -> Result<()> {
    atomic_record(&root.join("maintenance-request.json"), &json!({ "state": "pending", "attempts": 0, "producer": recovery::identity(std::process::id()) }))?;
    checkpoint(root, "request-committed");
    Ok(())
}
fn runnable(root: &Path) -> bool { ["maintenance-request.json", "maintenance-claimed.json"].iter().any(|n| root.join(n).exists()) }
fn pending(root: &Path) -> bool { runnable(root) || root.join("maintenance-parked.json").exists() }
fn acknowledge(root: &Path) -> Result<()> {
    fs::rename(root.join("maintenance-claimed.json"), root.join("maintenance-done.json")).map_err(|e| error("E_WITNESS_ARTIFACT", e))
}
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
    checkpoint(root, "claim-renamed");
    let previous = recovery::read(&root.join("maintenance-claimed.json"));
    if !fresh && !root.join("maintenance-claimed.json").exists() { return Err(error("E_WITNESS_ARTIFACT", "missing maintenance claim")); }
    // The pathname authorizes the claim. Upgrading metadata is idempotent even
    // for a legacy empty claim left by a killed pre-atomic producer.
    let attempts = if fresh { 0 } else { previous["attempts"].as_u64().unwrap_or(0) };
    // Persist the retry bound across either peer's death. A fresh publication
    // supersedes the old claim and can authorize a new attempt.
    if attempts >= 3 {
        park(root)?;
        return Err(error("E_WITNESS_ARTIFACT", "maintenance claim interrupted three times; request parked for a later export"));
    }
    atomic_record(&root.join("maintenance-claimed.json"), &json!({ "state": "claimed", "attempts": attempts + 1 }))?;
    checkpoint(root, "claim-recorded");
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
    if !try_lock(&initializing)? { trace!(root, "wait-initialization", Value::Null); return Ok(false); }
    drop(initializing);
    let publication = lock_file(root, "publication.lock")?;
    if !try_lock(&publication)? { trace!(root, "wait-publication", Value::Null); return Ok(false); }
    drop(publication);
    for entry in fs::read_dir(root).map_err(|e| error("E_WITNESS_ARTIFACT", e))? {
        let entry = entry.map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if !entry.file_type().is_ok_and(|t| t.is_dir()) || !name.split_once('-').is_some_and(|(a,b)| a.parse::<u128>().is_ok() && b.parse::<u32>().is_ok()) { continue; }
        if !ready_run(&entry.path())? { trace!(root, "wait-run", json!(entry.path())); return Ok(false); }
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
        #[cfg(debug_assertions)]
        if name == "export.lock" && dir.join("publication-pending.json").exists() {
            checkpoint(dir.parent().unwrap(), "ready-pending-export");
        }
    }
    let journal = recovery::read(&dir.join("live.json"));
    Ok(!recovery::alive(&journal["owner"]) && !recovery::alive(&journal["wrapper"]))
}
// @ref LLP 3000.030#15 — expiry and sleep baseline belong to the same intent.
// Internal children inherit the sample separately from argv, preserving the
// exact witness command forms used by process-identity checks. A direct leased
// invocation without this environment starts a new observation at entry.
const AWAKE_ENV: &str = "SNAPBACK4_INTERNAL_RETENTION_AWAKE";
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Observation { expires: u128, awake: u64 }
impl Observation {
    fn fresh() -> Self { Self { expires: now() + OBSERVER_BUDGET.as_millis(), awake: background::sleep_clock() } }
    fn inherited(expires: u128) -> Result<Self> {
        let awake = match std::env::var(AWAKE_ENV) {
            Ok(value) => value.parse::<u64>().map_err(|e| error("E_WITNESS_INPUT", e))?,
            Err(std::env::VarError::NotPresent) => background::sleep_clock(),
            Err(e) => return Err(error("E_WITNESS_INPUT", e)),
        };
        Ok(Self { expires, awake })
    }
    fn check(self) -> Result<()> {
        if now() >= self.expires {
            return Err(error("E_WITNESS_ARTIFACT", "retention observation exceeded its 60-minute deadline; request parked for a later export"));
        }
        if background::slept(self.awake, background::sleep_clock()) { return Err(error("E_WITNESS_INTERRUPTED", "host slept during pending evidence retention")); }
        Ok(())
    }
}
fn kick(root: &Path) -> Result<Value> { kick_with(root, Observation::fresh(), true) }
fn kick_until(root: &Path, intent: Observation) -> Result<Value> { kick_with(root, intent, false) }
// @ref LLP 3000.030#15 — publish a fresh wake before trusting a busy observer.
// Its successful guard consumes this bit before looking at runnable work. A
// stopping holder releases custody before checking it; the producer retries the
// lease after publication, covering a holder that already finished its check.
fn kick_with(root: &Path, mut intent: Observation, fresh: bool) -> Result<Value> {
    let mut notified = false;
    loop {
        if !runnable(root) { return Ok(Value::Null); }
        adopt_later(root, &mut intent);
        intent.check()?;
        let queued = lock_file(root, "maintenance-next.lock")?;
        if !try_lock(&queued)? {
            if fresh && !notified {
                checkpoint(root, "kick-notifying");
                publish_wakeup(root, intent)?;
                notified = true;
                checkpoint(root, "kick-notified");
                continue;
            }
            checkpoint(root, "kick-coalesced");
            return Ok(recovery::read(&root.join("maintenance-next.json")));
        }
        checkpoint(root, "kick-locked");
        if !runnable(root) {
            checkpoint(root, "kick-empty");
            // No child inherits this lease. Any producer that saw it busy must be
            // covered by our post-release check, or acquire it on its own retry.
            drop(queued);
            adopt_later(root, &mut intent);
            continue;
        }
        // The successful holder may have gone idle before a producer coalesced.
        // Select the latest valid intent while holding the lease, before spawn.
        adopt_later(root, &mut intent);
        let log = OpenOptions::new().create(true).append(true).open(root.join("maintenance.log")).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
        let mut command = background::export_command();
        command.args(["witness", "export-maintain"]).arg(root).arg(intent.expires.to_string()).env(AWAKE_ENV, intent.awake.to_string()).stdin(Stdio::piped())
            .stdout(log.try_clone().map_err(|e| error("E_WITNESS_ARTIFACT", e))?).stderr(log);
        let mut child = background::spawn_owned(command, &queued, None, true)?;
        let record = json!({ "state": "pending", "process": recovery::identity(child.id()), "at": now(), "expiresAt": intent.expires, "awake": intent.awake });
        atomic_record(&root.join("maintenance-next.json"), &record)?;
        trace!(root, "observer-launched", record.clone());
        drop(queued);
        child.stdin.take().unwrap().write_all(b"s").map_err(|e| error("E_WITNESS_PROCESS", e))?;
        return Ok(record);
    }
}

// @ref LLP 3000.030#15 — serialize producer comparisons, not observer custody.
// Consumers only move/remove records; the receipt protects against their unlink.
// Other producers must not replace the compared record before our rename.
fn publish_wakeup(root: &Path, intent: Observation) -> Result<()> {
    let publication = lock_file(root, "maintenance-wakeup.lock")?;
    let started = Instant::now();
    loop {
        intent.check()?;
        interrupted()?;
        if try_lock(&publication)? { break; }
        if started.elapsed() >= Duration::from_secs(5) {
            return Err(error("E_WITNESS_ARTIFACT", "maintenance wakeup publication lock busy; request preserved for a later export"));
        }
        checkpoint(root, "wakeup-publication-busy");
        sleep(Duration::from_millis(20));
    }
    intent.check()?;
    if unobserved_intent(root).is_some_and(|current| current.expires >= intent.expires) { return Ok(()); }
    checkpoint(root, "wakeup-publishing");
    intent.check()?;
    atomic_record(&root.join("maintenance-wakeup.json"), &json!({ "expiresAt": intent.expires, "awake": intent.awake }))
}

fn unobserved_intent(root: &Path) -> Option<Observation> {
    ["maintenance-wakeup.json", "maintenance-wakeup-reading.json"].into_iter().filter_map(|name| {
        let wake = recovery::read(&root.join(name));
        let intent = Observation { expires: wake["expiresAt"].as_u64()? as u128, awake: wake["awake"].as_u64()? };
        intent.check().ok().map(|_| intent)
    }).max_by_key(|intent| intent.expires)
}
// Only a strictly later, still-valid producer intent can extend observation.
// Adopt the pair, never a later expiry with an earlier sleep baseline.
fn adopt_later(root: &Path, intent: &mut Observation) -> bool {
    if let Some(later) = unobserved_intent(root).filter(|later| later.expires > intent.expires) {
        *intent = later;
        trace!(root, "observer-intent-adopted", json!({ "expiresAt": intent.expires, "awake": intent.awake }));
        return true;
    }
    false
}
fn refresh_guard(root: &Path, intent: &mut Observation, started: &mut Instant) -> Result<()> {
    // A new producer may arrive at the end of an hour. Give its accepted intent
    // its own monotonic ceiling, without changing the recorded absolute expiry.
    if adopt_later(root, intent) { *started = Instant::now(); }
    observation_guard(*started, *intent)
}
// @ref LLP 3000.030#15 — consuming a notification cannot unlink a replacement.
// Only the pending-lease owner renames/removes the receipt. A guard refusal
// leaves it available to the post-release handoff, alongside any newer wakeup.
fn consume_wakeup(root: &Path, intent: &mut Observation, started: &mut Instant) -> Result<()> {
    refresh_guard(root, intent, started)?;
    let reading = root.join("maintenance-wakeup-reading.json");
    recovery::remove(&reading)?; // a recovered receipt has been considered above
    match fs::rename(root.join("maintenance-wakeup.json"), &reading) {
        Ok(()) => {},
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(error("E_WITNESS_ARTIFACT", e)),
    }
    checkpoint(root, "wakeup-taking");
    refresh_guard(root, intent, started)?;
    recovery::remove(&reading)?;
    checkpoint(root, "wakeup-consumed");
    Ok(())
}
fn resume_unobserved(root: &Path) -> Result<()> {
    if let Some(intent) = unobserved_intent(root) { kick_until(root, intent)?; }
    Ok(())
}

// Called after publication releases its lock. A busy request records pending
// and returns. Only one pending observer and one active scan may exist.
pub(super) fn schedule(dir: &Path, _export: &File) {
    let root = dir.parent().unwrap();
    let result = (|| -> Result<()> {
        request(root)?;
        let record = kick(root)?;
        atomic_record(&dir.join("maintenance-launch.json"), &json!({ "state": "pending", "process": record["process"], "queue": root.join("maintenance-request.json"), "at": now() }))
    })();
    if let Err(e) = result { eprintln!("witness: evidence cleanup deferred: {e}; log: {} (Hermes export succeeded)", root.join("maintenance.log").display()); }
}

fn observation_guard(started: Instant, intent: Observation) -> Result<()> {
    interrupted()?;
    if started.elapsed() >= OBSERVER_BUDGET {
        return Err(error("E_WITNESS_ARTIFACT", "retention observation exceeded its 60-minute deadline; request parked for a later export"));
    }
    intent.check()
}

pub(super) fn maintain(args: &[String]) -> i32 {
    background::signals();
    let result = (|| -> Result<()> {
        if args.len() != 2 { return Err(error("E_WITNESS_INPUT", "export-maintain requires its leased queue and deadline")); }
        let expires = args[1].parse::<u128>().map_err(|e| error("E_WITNESS_INPUT", e))?.min(now() + OBSERVER_BUDGET.as_millis());
        let mut intent = Observation::inherited(expires)?;
        let mut started = Instant::now();
        let root = fs::canonicalize(&args[0]).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
        let project = fs::canonicalize(".").map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
        if root != project.join("artifacts/native-smoke") { return Err(error("E_WITNESS_INPUT", "maintenance is not this project's queue")); }
        let queued = background::inherited(3)?;
        let held = queued.metadata().map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
        let named = fs::metadata(root.join("maintenance-next.lock")).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
        if held.dev() != named.dev() || held.ino() != named.ino() || !try_lock(&queued)? { return Err(error("E_WITNESS_PROCESS", "maintenance does not own the pending queue lease")); }
        let result = observe(&root, &mut intent, &mut started);
        if result.is_ok() { checkpoint(&root, "observer-idle-exit"); }
        // Release before EVERY ordinary/error exit recheck. No failed guard or
        // I/O error can coalesce a producer against a lease we are abandoning.
        drop(queued);
        let handoff = if result.is_ok() { kick_until(&root, intent).map(|_| ()) } else { Ok(()) };
        if let Err(e) = resume_unobserved(&root) { eprintln!("witness: evidence cleanup deferred: {e}"); }
        result.and(handoff)
    })();
    match result { Ok(()) => 0, Err(e) => { eprintln!("witness: evidence cleanup deferred: {e}"); 1 } }
}

// The caller owns the queue lease until this entire observation returns.
fn observe(root: &Path, intent: &mut Observation, started: &mut Instant) -> Result<()> {
    let mut gate = libc::pollfd { fd: 0, events: libc::POLLIN, revents: 0 };
    loop {
        refresh_guard(root, intent, started)?;
        let polled = unsafe { libc::poll(&mut gate, 1, 100) };
        if polled > 0 { break; }
        if polled < 0 && std::io::Error::last_os_error().kind() != std::io::ErrorKind::Interrupted {
            return Err(error("E_WITNESS_PROCESS", std::io::Error::last_os_error()));
        }
    }
    let mut start = [0];
    std::io::stdin().read_exact(&mut start).map_err(|e| error("E_WITNESS_PROCESS", e))?;
    if start != [b's'] { return Err(error("E_WITNESS_PROCESS", "missing maintenance launch gate")); }
    trace!(&root, "observer-started", json!({ "expiresAt": intent.expires, "awake": intent.awake }));
    let mut failed_starts = 0;
    let mut retiring: Vec<Child> = Vec::new();
    loop {
        checkpoint(root, "observer-wakeup");
        if let Err(e) = consume_wakeup(root, intent, started) {
            checkpoint(root, "observer-guard-failed");
            return Err(e);
        }
        retiring.retain_mut(|child| !child.try_wait().is_ok_and(|status| status.is_some()));
        if !runnable(&root) {
            trace!(&root, "observer-idle", Value::Null);
            return Ok(());
        }
        let active = lock_file(&root, "maintenance.lock")?;
        if !try_lock(&active)? { trace!(&root, "wait-active", Value::Null); sleep(Duration::from_millis(100)); continue; }
        let available = lock_file(&root, "retention.lock")?;
        if !try_lock(&available)? { trace!(&root, "wait-retention", Value::Null); drop(active); sleep(Duration::from_millis(100)); continue; }
        if !ready(&root)? { drop(available); drop(active); sleep(Duration::from_millis(100)); continue; }
        drop(available);
        let mut command = Command::new(background::executable());
        command.args(["witness", "export-maintain-scan"]).arg(&root).arg(intent.expires.to_string()).env(AWAKE_ENV, intent.awake.to_string());
        // Keep the pending lease here. The separate scan custodian owns
        // native work; either peer survives the other's unexpected death.
        let mut child = background::spawn_owned(command, &active, None, false)?;
        trace!(&root, "scan-launched", json!(child.id()));
        drop(active);
        let scan_started = Instant::now();
        let mut cancellation = None;
        let mut handed_off = false;
        let mut forced = false;
        loop {
            if let Some(status) = child.try_wait().map_err(|e| error("E_WITNESS_PROCESS", e))? {
                trace!(&root, "scan-exited", json!({ "pid": child.id(), "success": status.success() }));
                failed_starts = if status.success() { 0 } else { failed_starts + 1 };
                break;
            }
            let handoff = recovery::read(&root.join("maintenance-active.json"));
            if handoff["process"] == recovery::identity(child.id()).unwrap_or(Value::Null) && handoff["state"] == "handoff" {
                // Native work has drained. Keep this peer alive while we
                // probe readiness; it retires only after the next live scan
                // owns the baton, or after the queue is completely covered.
                handed_off = true; failed_starts = 0; break;
            }
            if cancellation.is_none() {
                cancellation = observation_guard(*started, *intent).err();
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
        if handed_off { retiring.push(child); }
        if let Some(e) = cancellation {
            return Err(e);
        }
        if failed_starts >= 3 {
            if root.join("maintenance-claimed.json").exists() { park(&root)?; }
            return Err(error("E_WITNESS_ARTIFACT", "maintenance custodian failed three times; request parked for a later export"));
        }
        // Even a lock acquired after readiness cannot create a hot loop.
        sleep(Duration::from_millis(100));
    }
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
        let intent = Observation::inherited(expires)?;
        let started = Instant::now();
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
        observation_guard(started, intent)?;
        claim(&root)?;
        checkpoint(&root, "scan-starting");
        let count = recovery::read(&root.join("maintenance-active.json"))["attempt"].as_u64().unwrap_or(0).saturating_add(1);
        atomic_record(&root.join("maintenance-active.json"), &json!({ "process": recovery::identity(std::process::id()), "at": now(), "attempt": count, "state": "scanning" }))?;
        let observer = recovery::read(&root.join("maintenance-next.json"))["process"].clone();
        let result = run_with_budget(&root, None, || {
            if !recovery::alive(&observer) { return Err(error("E_WITNESS_INTERRUPTED", "maintenance observer exited; resuming claim after drain")); }
            observation_guard(started, intent)
        }, BUDGET);
        checkpoint(&root, "scan-complete");
        let busy = result.as_ref().err().is_some_and(|e| e.contains("retention lock busy"));
        if result.is_ok() {
            checkpoint(&root, "done-before");
            acknowledge(&root)?;
            checkpoint(&root, "done-after");
        }
        else if busy { request(&root)?; acknowledge(&root)?; }
        else if recovery::alive(&observer) && !INTERRUPTED.load(Ordering::Relaxed) { park(&root)?; }
        atomic_record(&root.join("maintenance-result.json"), &json!({ "finishedAt": now(), "error": result.as_ref().err(), "pending": pending(&root) }))?;
        atomic_record(&root.join("maintenance-active.json"), &json!({ "process": recovery::identity(std::process::id()), "at": now(), "attempt": count, "state": "handoff" }))?;
        drop(active);
        trace!(&root, "scan-handoff", json!({ "error": result.as_ref().err().map(|e| e.chars().take(256).collect::<String>()) }));
        // A busy queue lease is not an acknowledgement. Stay as the observer's
        // backup until a live successor scan exists. The observer recognizes
        // this atomic record and can launch that scan without waiting for exit.
        while runnable(&root) {
            observation_guard(started, intent)?;
            let successor = recovery::read(&root.join("maintenance-active.json"));
            if successor["process"]["pid"].as_u64() != Some(std::process::id() as u64) && recovery::alive(&successor["process"]) { break; }
            checkpoint(&root, "handoff-pending");
            if let Err(e) = kick_until(&root, intent) { eprintln!("witness: evidence cleanup deferred: {e}"); return Err(e); }
            checkpoint(&root, "handoff-busy");
            sleep(Duration::from_millis(100));
        }
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
    trace!(root, "work-start", Value::Null);
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
    trace!(&root, "worker-launched", json!(dir));
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
    trace!(&root, "work-ended", json!({ "error": result.as_ref().err().map(|e| e.chars().take(256).collect::<String>()), "elapsedMs": started.elapsed().as_millis() }));
    child.cleanup()?;
    trace!(&root, "cleanup-ended", json!({ "elapsedMs": started.elapsed().as_millis() }));
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

// Deterministic crash barriers exist only in debug builds. They are one-shot
// per fixture, never affect release binaries, and expire even if a test dies.
pub(super) fn checkpoint(root: &Path, point: &'static str) {
    trace!(root, point, Value::Null);
    #[cfg(debug_assertions)]
    if let Ok(points) = std::env::var("SNAPBACK4_TEST_RETENTION_POINT") {
        if points.split(',').any(|p| p == point) {
            let (marker, resume) = if points.contains(',') {
                (format!("maintenance-test-{point}.json"), format!("maintenance-test-{point}-resume"))
            } else { ("maintenance-test-point.json".into(), "maintenance-test-resume".into()) };
            let path = root.join(marker);
            if let Ok(mut file) = OpenOptions::new().create_new(true).write(true).open(&path) {
                let _ = write!(file, "{}", json!({ "point": point, "process": recovery::identity(std::process::id()), "darwinBackground": background::own_policy() }));
                let started = Instant::now();
                while !root.join(resume.as_str()).exists() && started.elapsed() < Duration::from_secs(20) { sleep(Duration::from_millis(20)); }
            }
        }
    }
    let _ = (root, point);
}

// Every wrapper calls this before doing export work. Fresh pending work
// supersedes a parked/stranded claim without waiting for any maintenance lease.
pub(super) fn backstop(args: &[String]) -> i32 {
    let result = (|| -> Result<()> {
        if args.len() != 1 { return Err(error("E_WITNESS_INPUT", "export-maintenance requires this project's evidence root")); }
        let root = fs::canonicalize(&args[0]).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
        if root != fs::canonicalize(".").map_err(|e| error("E_WITNESS_ARTIFACT", e))?.join("artifacts/native-smoke") { return Err(error("E_WITNESS_INPUT", "maintenance is not this project's queue")); }
        let prepared = fs::read_dir(&root).map_err(|e| error("E_WITNESS_ARTIFACT", e))?.filter_map(|entry| entry.ok()).filter(|entry| {
            let name = entry.file_name(); let name = name.to_string_lossy();
            name.starts_with("maintenance-request.") && name.ends_with(".tmp")
        }).map(|entry| entry.path()).collect::<Vec<_>>();
        if recovery::maintenance_needed(&root)? || pending(&root) || !prepared.is_empty() {
            request(&root)?; kick(&root)?;
            // The replacement request is durable before removing a dead
            // producer's record. A crash before JSON is written has only the
            // writer PID in our exact private temporary name. Check that no
            // such process is live; this authorizes only unlinking this temp,
            // never signalling or touching a process/simulator.
            for path in prepared {
                let producer = recovery::read(&path)["producer"].clone();
                let name = path.file_name().unwrap().to_string_lossy();
                let fields = name.strip_prefix("maintenance-request.").and_then(|n| n.strip_suffix(".tmp"))
                    .map(|n| n.split('-').collect::<Vec<_>>()).unwrap_or_default();
                let dead_writer = fields.len() == 3 && fields[1].parse::<u128>().is_ok() && fields[2].parse::<u64>().is_ok()
                    && fields[0].parse::<u32>().is_ok_and(|pid| pid > 0 && recovery::identity(pid).is_none());
                if (!producer.is_null() && !recovery::alive(&producer)) || (producer.is_null() && dead_writer) { recovery::remove(&path)?; }
            }
        }
        Ok(())
    })();
    match result { Ok(()) => 0, Err(e) => { eprintln!("witness: evidence cleanup deferred: {e}"); 1 } }
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
    fn fresh_wakeup_preserves_its_deadline_and_expired_wakeup_cannot_restart() {
        let root = std::env::temp_dir().join(format!("sb4-retention-wakeup-{}-{}", std::process::id(), now()));
        fs::create_dir_all(&root).unwrap();
        request(&root).unwrap();
        assert!(unobserved_intent(&root).is_none());
        let expires = now() + 60_000;
        let awake = background::sleep_clock();
        atomic_record(&root.join("maintenance-wakeup.json"), &json!({ "expiresAt": expires, "awake": awake })).unwrap();
        assert_eq!(unobserved_intent(&root), Some(Observation { expires, awake }));
        atomic_record(&root.join("maintenance-wakeup.json"), &json!({ "expiresAt": now() - 1, "awake": background::sleep_clock() })).unwrap();
        assert!(unobserved_intent(&root).is_none());
        resume_unobserved(&root).unwrap();
        assert!(runnable(&root));
        assert!(!root.join("maintenance-next.json").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn wakeup_publication_preserves_equal_or_later_valid_intent() {
        let root = std::env::temp_dir().join(format!("sb4-retention-publish-{}-{}", std::process::id(), now()));
        fs::create_dir_all(&root).unwrap();
        let intent = Observation { expires: now() + 60_000, awake: background::sleep_clock() };
        let record = |expires| json!({ "expiresAt": expires, "awake": intent.awake });
        let path = root.join("maintenance-wakeup.json");
        for expires in [intent.expires, intent.expires + 60_000] {
            atomic_record(&path, &record(expires)).unwrap();
            publish_wakeup(&root, intent).unwrap();
            assert_eq!(recovery::read(&path), record(expires));
        }
        for expires in [now() - 1, intent.expires - 1] {
            atomic_record(&path, &record(expires)).unwrap();
            publish_wakeup(&root, intent).unwrap();
            assert_eq!(recovery::read(&path), record(intent.expires));
        }
        let before = recovery::read(&path);
        assert!(publish_wakeup(&root, Observation { expires: now() - 1, ..intent }).is_err());
        assert_eq!(recovery::read(&path), before);
        fs::rename(&path, root.join("maintenance-wakeup-reading.json")).unwrap();
        publish_wakeup(&root, intent).unwrap();
        assert!(!path.exists(), "an equal valid receipt already covers publication");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn only_a_later_valid_intent_resets_the_observation_ceiling() {
        let root = std::env::temp_dir().join(format!("sb4-retention-adopt-{}-{}", std::process::id(), now()));
        fs::create_dir_all(&root).unwrap();
        let original = Observation { expires: now() + 60_000, awake: background::sleep_clock() };
        let mut intent = original;
        let old_start = Instant::now() - OBSERVER_BUDGET;
        let mut started = old_start;
        for expires in [original.expires - 1, original.expires] {
            atomic_record(&root.join("maintenance-wakeup.json"), &json!({ "expiresAt": expires, "awake": original.awake })).unwrap();
            assert!(refresh_guard(&root, &mut intent, &mut started).is_err());
            assert_eq!(intent, original);
            assert_eq!(started, old_start, "equal/earlier intent cannot renew the monotonic budget");
        }
        let later = Observation { expires: original.expires + 60_000, awake: original.awake };
        atomic_record(&root.join("maintenance-wakeup-reading.json"), &json!({ "expiresAt": later.expires, "awake": later.awake })).unwrap();
        refresh_guard(&root, &mut intent, &mut started).unwrap();
        assert_eq!(intent, later, "a receipt left by a stopped guard remains adoptable");
        assert!(started > old_start);
        let accepted_start = started;
        consume_wakeup(&root, &mut intent, &mut started).unwrap();
        assert_eq!(intent, later, "consuming an earlier wakeup must not shorten the accepted intent");
        assert_eq!(started, accepted_start);
        assert!(!root.join("maintenance-wakeup.json").exists());
        assert!(!root.join("maintenance-wakeup-reading.json").exists());
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
