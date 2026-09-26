//! The host owns exactly one application worker and only stops the child it started.
use crate::{project::Project, serve::{Shared, lock}};
use sha2::{Digest, Sha256};
use snapback4_core::{Store, RuntimeError, identity};
use std::{path::PathBuf, process::{Child, Command, Stdio}, sync::Arc, time::{Duration, Instant}};

#[path = "worker_environment.rs"]
mod environment;
pub(crate) use environment::validate_environment;

const CHILD_WINDOW: Duration = Duration::from_secs(24 * 60 * 60);

// Called only while the host holds the store's deployment lock. A previous
// supervisor cannot still own this store; revoke its child's whole refresh
// family, including an orphan left behind by SIGKILL. Manual seats survive.
pub(crate) fn clear_child_session(store: &Store) -> Result<(), RuntimeError> {
    let tx = store.conn().unchecked_transaction()?;
    tx.execute("DELETE FROM _sessions WHERE principal = 'service:worker' AND COALESCE(family, token_digest) = (SELECT value FROM _meta WHERE key = 'worker:session-family')", [])?;
    tx.execute("DELETE FROM _meta WHERE key IN ('worker:session-family', 'worker:session-revision')", [])?;
    tx.commit()?;
    Ok(())
}

pub(crate) fn child_session(store: &Store, now: i64, revision: usize) -> Result<identity::Session, RuntimeError> {
    // Credential and ownership marker commit together, so a crash cannot
    // strand a credential that the next supervisor cannot identify.
    let tx = store.conn().unchecked_transaction()?;
    let session = identity::service_session(store, "worker", now, 1)?;
    let digest = format!("{:x}", Sha256::digest(session.token.as_bytes()));
    store.set_meta("worker:session-family", &digest)?;
    store.set_meta("worker:session-revision", &revision.to_string())?;
    tx.commit()?;
    Ok(session)
}

pub(crate) fn source(project: &Project) -> Option<PathBuf> {
    server_source(project).or_else(|| ["snapback/worker.ts", "snapback/worker.mts", "snapback/worker.mjs"].into_iter().map(|p| project.root.join(p)).find(|p| p.is_file()))
}

pub(crate) fn server_source(project: &Project) -> Option<PathBuf> {
    project.server_source()
}

pub(crate) fn node() -> PathBuf {
    crate::project::node()
}

// @ref LLP 3000.019#3.6 — worker status and revocation may wait for adoption; HTTP admission must not.
pub(crate) struct Supervisor {
    stop: Arc<std::sync::atomic::AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl Supervisor {
    pub(crate) fn start(project: Project, shared: Arc<Shared>, url: String, dev: bool, mut worker: Option<DevWorker>) -> Result<Self, String> {
        let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let stopping = stop.clone();
        let mut revision = shared.worker_revision.load(std::sync::atomic::Ordering::Acquire);
        let thread = crate::lifecycle::background("worker", move || {
            // This thread owns DevWorker, including its durable revocation and
            // child cleanup on every return or unwind. The host joins it on exit.
            while !stopping.load(std::sync::atomic::Ordering::Acquire) && !crate::lifecycle::stopping() {
                let next = shared.worker_revision.load(std::sync::atomic::Ordering::Acquire);
                if worker.is_none() && dev && next != revision {
                    revision = next;
                    match DevWorker::start(&project, shared.clone(), url.clone()) {
                        Ok(next) => worker = next,
                        Err(error) => eprintln!("snapback4 worker: {error}"),
                    }
                }
                if let Some(worker) = &mut worker { worker.tick(); }
                std::thread::park_timeout(Duration::from_millis(100));
            }
        })?;
        Ok(Self { stop, thread: Some(thread) })
    }

    pub(crate) fn is_finished(&self) -> bool { self.thread.as_ref().unwrap().is_finished() }
}

impl Drop for Supervisor {
    fn drop(&mut self) {
        self.stop.store(true, std::sync::atomic::Ordering::Release);
        if let Some(thread) = self.thread.take() {
            thread.thread().unpark();
            if thread.join().is_err() { eprintln!("snapback4 worker: supervisor panicked"); }
        }
    }
}

pub(crate) struct DevWorker {
    project: Project,
    source: PathBuf,
    node: PathBuf,
    url: String,
    explicit_env: bool,
    starts: u64,
    crashes: u64,
    shared: Arc<Shared>,
    child: Option<Child>,
    // Each child gets its own session, closed when that child exits: a dead
    // child's long poll then fails its next reauthentication instead of
    // claiming work for a connection nobody reads.
    child_expires_at: Option<i64>,
    restart: Instant,
    started: Instant,
    backoff: Duration,
    revision: usize,
}

impl DevWorker {
    // @ref LLP 3000.007#9.2 — dev supervises the application's Node worker, outside the engine.
    pub(crate) fn start(project: &Project, shared: Arc<Shared>, url: String) -> Result<Option<Self>, String> {
        let Some(source) = source(project) else { return Ok(None) };
        Self::start_source(project, shared, url, source, false).map(Some)
    }

    // @ref LLP 3000.009#5.3 — serve constructs the child environment explicitly.
    pub(crate) fn start_source(project: &Project, shared: Arc<Shared>, url: String, source: PathBuf, explicit_env: bool) -> Result<Self, String> {
        let source = source.canonicalize().map_err(|e| format!("worker {}: {e}", source.display()))?;
        if !source.is_file() { return Err(format!("worker {} is not a file", source.display())); }
        warn_if_esm_entry_is_not_declared(&source);
        validate_environment(&lock(&shared.bound).schema)?;
        let node = node();
        let version = command(&node).arg("--version").output().map_err(|e| format!("worker needs Node 24: {e}"))?;
        if !version.status.success() || !String::from_utf8_lossy(&version.stdout).starts_with("v24.") { return Err("worker needs Node 24; put it on PATH or set SNAPBACK_NODE to its executable".into()); }
        let revision = shared.worker_revision.load(std::sync::atomic::Ordering::Acquire);
        let worker = Self { project: Project { root: project.root.clone() }, source, node, url, explicit_env, starts: 0, crashes: 0, shared, child: None, child_expires_at: None, restart: Instant::now(), started: Instant::now(), backoff: Duration::from_millis(250), revision };
        crate::lifecycle::worker_cleanup();
        // The host's first tick follows its listening URL; keep that readiness line first on stdout.
        Ok(worker)
    }

    pub(crate) fn tick(&mut self) {
        let revision = self.shared.worker_revision.load(std::sync::atomic::Ordering::Acquire);
        if !self.explicit_env && revision != self.revision {
            self.revision = revision;
            self.close_child_session(); self.stop_child();
            if let Some(source) = source(&self.project) { self.source = source; }
            self.restart = Instant::now();
        }
        // Renew through a new child, so the process receives its new token.
        // Check both clocks: a wall-clock correction cannot extend a child
        // beyond the supervision window. Allow two seconds for shutdown.
        if self.child.is_some() && (self.started.elapsed() >= CHILD_WINDOW - Duration::from_secs(2)
            || self.child_expires_at.is_some_and(|at| self.shared.now() >= at.saturating_sub(2_000))) {
            eprintln!("snapback4 worker: supervision window ended; replacing child");
            self.close_child_session();
            self.stop_child();
            self.restart = Instant::now();
        }
        if let Some(child) = &mut self.child {
            match child.try_wait() {
                Ok(None) => return,
                Err(error) => { eprintln!("snapback4 worker: wait failed: {error}"); return; }
                Ok(Some(status)) => eprintln!("snapback4 worker: exited {status}; restarting in {} ms", self.backoff.as_millis()),
            }
            self.child = None;
            self.crashes += 1;
            self.record_status("waiting");
            self.close_child_session();
            if self.started.elapsed() > Duration::from_secs(30) { self.backoff = Duration::from_millis(250); }
            self.restart = Instant::now() + self.backoff;
            self.backoff = (self.backoff * 2).min(Duration::from_secs(5));
        }
        if crate::lifecycle::stopping() || Instant::now() < self.restart { return; }
        if !self.explicit_env && source(&self.project).is_none() { return; }
        // @ref LLP 3000.007#9.2 — a restarted worker's orphaned claim poll must not lease work to the dead child.
        let session = {
            let engine = lock(&self.shared.engine);
            clear_child_session(engine.store()).and_then(|()| child_session(engine.store(), self.shared.now(), self.revision))
        };
        let session = match session {
            Ok(session) => session,
            Err(error) => { eprintln!("snapback4 worker: cannot mint the child's session: {error}"); self.restart = Instant::now() + self.backoff; return; }
        };
        let token = session.token;
        self.child_expires_at = Some(session.expires_at);
        // Witness artifacts must not contain the supervisor's bearer. The child
        // still receives it through its environment and its output is redacted below.
        if !self.explicit_env && self.starts == 0 && server_source(&self.project).is_none()
            && std::env::var_os("SNAPBACK4_WITNESS_DRIVER").is_none() {
            println!("snapback4 dev worker: service:worker token (printed once): {token}");
        }
        let secrets = { environment::values(&lock(&self.shared.bound).schema) };
        let secrets = match secrets {
            Ok(values) => values,
            Err(error) => { eprintln!("snapback4 worker: {error}"); self.close_child_session(); self.restart = Instant::now() + self.backoff; return; }
        };
        let mut redact: Vec<Vec<u8>> = secrets.values().map(|s| s.as_bytes().to_vec()).collect(); redact.push(token.as_bytes().to_vec());
        match command(&self.node).arg(&self.source).current_dir(&self.project.root).envs(secrets).env("SNAPBACK_URL", &self.url).env("SNAPBACK_SERVICE_TOKEN", &token).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn() {
            Ok(mut child) => {
                environment::pipe(child.stdout.take().expect("piped stdout"), redact.clone());
                environment::pipe(child.stderr.take().expect("piped stderr"), redact);
                eprintln!("snapback4 worker: {} (pid {})", self.source.display(), child.id()); self.child = Some(child); self.started = Instant::now(); self.starts += 1; self.record_status("running");
            }
            Err(error) => { eprintln!("snapback4 worker: cannot start: {error}"); self.close_child_session(); self.restart = Instant::now() + self.backoff; self.backoff = (self.backoff * 2).min(Duration::from_secs(5)); }
        }
    }

    fn record_status(&self, state: &str) {
        let record = serde_json::json!({ "source": self.source, "mode": if self.explicit_env { "serve" } else { "dev" }, "state": state, "starts": self.starts, "restarts": self.starts.saturating_sub(1), "crashes": self.crashes, "pid": self.child.as_ref().map(Child::id) });
        if let Err(error) = lock(&self.shared.engine).store().set_meta("worker:status", &record.to_string()) {
            eprintln!("snapback4 worker: cannot record status: {error}");
        }
    }

    fn close_child_session(&mut self) {
        if self.child_expires_at.take().is_some() {
            if let Err(error) = clear_child_session(lock(&self.shared.engine).store()) {
                eprintln!("snapback4 worker: cannot close the child's session: {error}");
            }
        }
    }

    fn stop_child(&mut self) {
        if let Some(mut child) = self.child.take() {
            // Give the worker's AbortSignal cleanup a turn, then stop only
            // this child if it ignores termination.
            unsafe { libc::kill(child.id() as libc::pid_t, libc::SIGTERM); }
            let until = Instant::now() + Duration::from_secs(2);
            while Instant::now() < until {
                if child.try_wait().ok().flatten().is_some() { break; }
                std::thread::sleep(Duration::from_millis(20));
            }
            if child.try_wait().ok().flatten().is_none() { let _ = child.kill(); }
            let _ = child.wait();
        }
    }
}

impl Drop for DevWorker {
    fn drop(&mut self) {
        self.close_child_session();
        self.stop_child();
        self.record_status("stopped");
    }
}

/// `init` scopes ESM to what it generates — `snapback/generated/package.json`
/// is `{"type":"module"}` — and deliberately leaves the application's own module
/// type alone (@ref LLP 3000.007#20.2). The documented worker entry,
/// `snapback/server.ts`, sits one directory *above* that island, so in a project
/// that does not declare `"type": "module"` Node reads it as CommonJS and the
/// guide's own ESM example fails to load. Say which repair fixes it before Node
/// says it eight frames deep; a 0.2.28 calibration builder spent seven restarts
/// and an untyped stack trace arriving at `server.mts` unaided.
///
/// Advisory, not a refusal: Node still gets its attempt, so a loader or a
/// future type-stripping default cannot be locked out by this heuristic.
fn warn_if_esm_entry_is_not_declared(source: &std::path::Path) {
    // `.mts` and `.mjs` are ES modules whatever any package.json says.
    if !matches!(source.extension().and_then(|e| e.to_str()), Some("ts" | "js")) { return; }
    let Ok(text) = std::fs::read_to_string(source) else { return };
    if !text.lines().any(|line| line.starts_with("import ") || line.starts_with("export ")) { return; }
    // Node resolves the *nearest* package.json walking up from the file.
    let declares_module = source.ancestors().skip(1).find_map(|dir| {
        let package = dir.join("package.json");
        std::fs::read_to_string(&package).ok().map(|text| {
            serde_json::from_str::<serde_json::Value>(&text).ok().is_some_and(|v| v["type"] == "module")
        })
    });
    // No package.json at all fails the same way: CommonJS is Node's default.
    if declares_module == Some(true) { return; }
    // Name the rename by file, not by absolute path: it is a rename in place, and the
    // repair should read the way the author would perform it.
    let renamed = source.with_extension("mts");
    let renamed = renamed.file_name().unwrap_or(renamed.as_os_str()).to_string_lossy().into_owned();
    let reason = if declares_module.is_some() { "the nearest package.json does not declare them" } else { "no package.json above it declares them" };
    eprintln!("snapback4 worker: {} uses ES modules but {reason}, so Node will read it as CommonJS", source.display());
    eprintln!("snapback4 worker:   rewrite: rename it to {renamed} — or declare \"type\": \"module\" for it");
}

fn command(node: &std::path::Path) -> Command {
    let mut command = Command::new(node);
    command.env_clear();
    for name in ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "TZ", "NODE_OPTIONS"] {
        if let Some(value) = std::env::var_os(name) { command.env(name, value); }
    }
    command
}
