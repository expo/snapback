//! The host owns exactly one application worker and only stops the child it started.
use crate::{project::Project, serve::{Shared, lock}};
use sha2::{Digest, Sha256};
use snapback4_core::{Store, RuntimeError, identity};
use std::{path::PathBuf, process::{Child, Command, Stdio}, sync::Arc, time::{Duration, Instant}};

const CHILD_WINDOW: Duration = Duration::from_secs(24 * 60 * 60);

// Called only while the host holds the store's deployment lock. A previous
// supervisor cannot still own this store; revoke its child's whole refresh
// family, including an orphan left behind by SIGKILL. Manual seats survive.
pub(crate) fn clear_child_session(store: &Store) -> Result<(), RuntimeError> {
    let tx = store.conn().unchecked_transaction()?;
    tx.execute("DELETE FROM _sessions WHERE principal = 'service:worker' AND COALESCE(family, token_digest) = (SELECT value FROM _meta WHERE key = 'worker:session-family')", [])?;
    tx.execute("DELETE FROM _meta WHERE key = 'worker:session-family'", [])?;
    tx.commit()?;
    Ok(())
}

fn child_session(store: &Store, now: i64) -> Result<identity::Session, RuntimeError> {
    // Credential and ownership marker commit together, so a crash cannot
    // strand a credential that the next supervisor cannot identify.
    let tx = store.conn().unchecked_transaction()?;
    let session = identity::service_session(store, "worker", now, 1)?;
    let digest = format!("{:x}", Sha256::digest(session.token.as_bytes()));
    store.set_meta("worker:session-family", &digest)?;
    tx.commit()?;
    Ok(session)
}

pub(crate) fn source(project: &Project) -> Option<PathBuf> {
    ["snapback/worker.ts", "snapback/worker.mts", "snapback/worker.mjs"].into_iter().map(|p| project.root.join(p)).find(|p| p.is_file())
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
        let pinned = std::env::var_os("HOME").map(PathBuf::from).map(|p| p.join(".volta/tools/image/node/24.18.0/bin/node"));
        let node = std::env::var_os("SNAPBACK_NODE").map(PathBuf::from).or_else(|| pinned.filter(|p| p.is_file())).unwrap_or_else(|| PathBuf::from("node"));
        let version = command(&node, explicit_env).arg("--version").output().map_err(|e| format!("worker needs Node 24: {e}"))?;
        if !version.status.success() || !String::from_utf8_lossy(&version.stdout).starts_with("v24.") { return Err("worker needs Node 24; put it on PATH or set SNAPBACK_NODE to its executable".into()); }
        let mut worker = Self { project: Project { root: project.root.clone() }, source, node, url, explicit_env, starts: 0, crashes: 0, shared, child: None, child_expires_at: None, restart: Instant::now(), started: Instant::now(), backoff: Duration::from_millis(250) };
        crate::lifecycle::worker_cleanup();
        worker.tick();
        Ok(worker)
    }

    pub(crate) fn tick(&mut self) {
        // Renew through a new child, so the process receives its new token.
        // Check both clocks: a wall-clock correction cannot extend a child
        // beyond the supervision window. Allow two seconds for shutdown.
        if self.child.is_some() && (self.started.elapsed() >= CHILD_WINDOW - Duration::from_secs(2)
            || self.child_expires_at.is_some_and(|at| self.shared.now() >= at.saturating_sub(2_000))) {
            eprintln!("snapback4 worker: supervision window ended; replacing child");
            self.stop_child();
            self.close_child_session();
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
        // @ref LLP 3000.007#9.2 — a restarted worker's orphaned claim poll must not lease work to the dead child.
        let session = {
            let engine = lock(&self.shared.engine);
            clear_child_session(engine.store()).and_then(|()| child_session(engine.store(), self.shared.now()))
        };
        let session = match session {
            Ok(session) => session,
            Err(error) => { eprintln!("snapback4 worker: cannot mint the child's session: {error}"); self.restart = Instant::now() + self.backoff; return; }
        };
        let token = session.token;
        self.child_expires_at = Some(session.expires_at);
        if !self.explicit_env && self.starts == 0 {
            eprintln!("snapback4 dev worker: service:worker token (printed once): {token}");
        }
        match command(&self.node, self.explicit_env).arg(&self.source).current_dir(&self.project.root).env("SNAPBACK_URL", &self.url).env("SNAPBACK_SERVICE_TOKEN", &token).stdin(Stdio::null()).stdout(Stdio::from(std::io::stderr())).stderr(Stdio::inherit()).spawn() {
            Ok(child) => { eprintln!("snapback4 worker: {} (pid {})", self.source.display(), child.id()); self.child = Some(child); self.started = Instant::now(); self.starts += 1; self.record_status("running"); }
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
        self.stop_child();
        self.close_child_session();
        self.record_status("stopped");
    }
}

fn command(node: &std::path::Path, explicit_env: bool) -> Command {
    let mut command = Command::new(node);
    if explicit_env {
        command.env_clear();
        for name in ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "TZ", "NODE_OPTIONS"] {
            if let Some(value) = std::env::var_os(name) { command.env(name, value); }
        }
    }
    command
}
