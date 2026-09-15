//! Dev owns exactly one application worker and only stops the child it started.
use crate::{project::Project, serve::{Shared, lock}};
use std::{path::PathBuf, process::{Child, Command, Stdio}, sync::Arc, time::{Duration, Instant}};

pub(crate) fn source(project: &Project) -> Option<PathBuf> {
    ["snapback/worker.ts", "snapback/worker.mts", "snapback/worker.mjs"].into_iter().map(|p| project.root.join(p)).find(|p| p.is_file())
}

pub(crate) struct DevWorker {
    project: Project,
    source: PathBuf,
    node: PathBuf,
    url: String,
    token: String,
    shared: Arc<Shared>,
    child: Option<Child>,
    // Each child gets its own session, closed when that child exits: a dead
    // child's long poll then fails its next reauthentication instead of
    // claiming work for a connection nobody reads.
    child_token: Option<String>,
    restart: Instant,
    started: Instant,
    backoff: Duration,
}

impl DevWorker {
    // @ref LLP 3000.007#9.2 — dev supervises the application's Node worker, outside the engine.
    pub(crate) fn start(project: &Project, shared: Arc<Shared>, url: String) -> Result<Option<Self>, String> {
        let Some(source) = source(project) else { return Ok(None) };
        let pinned = std::env::var_os("HOME").map(PathBuf::from).map(|p| p.join(".volta/tools/image/node/24.18.0/bin/node"));
        let node = std::env::var_os("SNAPBACK_NODE").map(PathBuf::from).or_else(|| pinned.filter(|p| p.is_file())).unwrap_or_else(|| PathBuf::from("node"));
        let version = Command::new(&node).arg("--version").output().map_err(|e| format!("worker needs Node 24: {e}"))?;
        if !version.status.success() || !String::from_utf8_lossy(&version.stdout).starts_with("v24.") { return Err("worker needs Node 24; put it on PATH or set SNAPBACK_NODE to its executable".into()); }
        let session = snapback4_core::identity::service_session(lock(&shared.engine).store(), "worker", shared.now(), 365).map_err(|e| e.to_string())?;
        eprintln!("snapback4 dev worker: service:worker token (printed once): {}", session.token);
        let mut worker = Self { project: Project { root: project.root.clone() }, source, node, url, token: session.token, shared, child: None, child_token: None, restart: Instant::now(), started: Instant::now(), backoff: Duration::from_millis(250) };
        crate::lifecycle::worker_cleanup();
        worker.tick();
        Ok(Some(worker))
    }

    pub(crate) fn tick(&mut self) {
        if let Some(child) = &mut self.child {
            match child.try_wait() {
                Ok(None) => return,
                Err(error) => { eprintln!("snapback4 dev worker: wait failed: {error}"); return; }
                Ok(Some(status)) => eprintln!("snapback4 dev worker: exited {status}; restarting in {} ms", self.backoff.as_millis()),
            }
            self.child = None;
            self.close_child_session();
            if self.started.elapsed() > Duration::from_secs(30) { self.backoff = Duration::from_millis(250); }
            self.restart = Instant::now() + self.backoff;
            self.backoff = (self.backoff * 2).min(Duration::from_secs(5));
        }
        if crate::lifecycle::stopping() || Instant::now() < self.restart { return; }
        // @ref LLP 3000.007#9.2 — a restarted worker's orphaned claim poll must not lease work to the dead child.
        let token = match snapback4_core::identity::service_session(lock(&self.shared.engine).store(), "worker", self.shared.now(), 365) {
            Ok(session) => session.token,
            Err(error) => { eprintln!("snapback4 dev worker: cannot mint the child's session: {error}"); self.restart = Instant::now() + self.backoff; return; }
        };
        self.child_token = Some(token.clone());
        match Command::new(&self.node).arg(&self.source).current_dir(&self.project.root).env("SNAPBACK_URL", &self.url).env("SNAPBACK_SERVICE_TOKEN", &token).stdin(Stdio::null()).stdout(Stdio::from(std::io::stderr())).stderr(Stdio::inherit()).spawn() {
            Ok(child) => { eprintln!("snapback4 dev worker: {} (pid {})", self.source.display(), child.id()); self.child = Some(child); self.started = Instant::now(); }
            Err(error) => { eprintln!("snapback4 dev worker: cannot start: {error}"); self.close_child_session(); self.restart = Instant::now() + self.backoff; self.backoff = (self.backoff * 2).min(Duration::from_secs(5)); }
        }
    }

    fn close_child_session(&mut self) {
        if let Some(token) = self.child_token.take() {
            let _ = snapback4_core::identity::close_session(lock(&self.shared.engine).store(), &token);
        }
    }
}

impl Drop for DevWorker {
    fn drop(&mut self) {
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
        self.close_child_session();
        let _ = snapback4_core::identity::close_session(lock(&self.shared.engine).store(), &self.token);
    }
}
