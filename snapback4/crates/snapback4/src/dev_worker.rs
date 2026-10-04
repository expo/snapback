//! The host owns its declared workers and only stops the children it started.
use crate::{project::Project, serve::{Shared, lock}};
use sha2::{Digest, Sha256};
use snapback4_core::{Store, RuntimeError, identity};
use std::{path::PathBuf, process::{Child, Command, Stdio}, sync::Arc, time::{Duration, Instant}};

#[path = "worker_environment.rs"]
mod environment;
pub(crate) use environment::validate_environment;
#[path = "worker_declarations.rs"]
mod declarations;
#[path = "worker_process.rs"]
pub(crate) mod process;
pub(crate) use declarations::package;
pub(crate) fn declared(project: &Project) -> Result<std::collections::BTreeMap<String, PathBuf>, String> { declarations::declared(project) }

const CHILD_WINDOW: Duration = Duration::from_secs(24 * 60 * 60);

// Called only while the host holds the store's deployment lock. A previous
// supervisor cannot still own this store; revoke its child's whole refresh
// family, including an orphan left behind by SIGKILL. Manual seats survive.
pub(crate) fn clear_child_session(store: &Store) -> Result<(), RuntimeError> {
    let tx = store.conn().unchecked_transaction()?;
    tx.execute("DELETE FROM _sessions WHERE principal = 'service:worker' AND COALESCE(family, token_digest) = (SELECT value FROM _meta WHERE key = 'worker:session-family')", [])?;
    tx.execute("DELETE FROM _meta WHERE key IN ('worker:session-family', 'worker:session-revision')", [])?;
    tx.execute("DELETE FROM _sessions WHERE COALESCE(family, token_digest) IN (SELECT substr(key, 15) FROM _meta WHERE key LIKE 'worker:family:%')", [])?;
    tx.execute("DELETE FROM _meta WHERE key LIKE 'worker:family:%'", [])?;
    // The next supervisor owns fresh reports; a removed declaration must not
    // inherit a running row from the host whose credentials just retired.
    tx.execute("DELETE FROM _meta WHERE key = 'worker:status' OR key LIKE 'worker:status:%'", [])?;
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
        let mut named = Self::named(&project, &shared, &url, dev)?;
        let mut pending = std::collections::BTreeMap::new();
        let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let stopping = stop.clone();
        let mut revision = shared.worker_revision.load(std::sync::atomic::Ordering::Acquire);
        let thread = crate::lifecycle::background("worker", move || {
            // This thread owns DevWorker, including its durable revocation and
            // child cleanup on every return or unwind. The host joins it on exit.
            while !stopping.load(std::sync::atomic::Ordering::Acquire) && !crate::lifecycle::stopping() {
                let next = shared.worker_revision.load(std::sync::atomic::Ordering::Acquire);
                let changed = next != revision;
                if dev && changed {
                    revision = next;
                    match declared(&project) {
                        Ok(entries) => {
                            pending.retain(|name, _| entries.contains_key(name));
                            for (name, worker) in &mut named {
                                worker.retiring = !entries.contains_key(name);
                                if worker.retiring { worker.begin_stop(); }
                            }
                            for (name, source) in entries {
                                if let Some(worker) = named.get_mut(&name) { worker.source = source; }
                                else { match DevWorker::start_named(&project, shared.clone(), url.clone(), source, !dev, name.clone()) {
                                    Ok(worker) => { named.insert(name, worker); }
                                    Err(error) => {
                                        snapback4_core::diagnostic!("snapback4 worker: {error}; declaration will retry");
                                        pending.insert(name, (Instant::now() + Duration::from_millis(250), Duration::from_millis(250)));
                                    },
                                } }
                            }
                        }
                        Err(error) => snapback4_core::diagnostic!("snapback4 worker: {error}"),
                    }
                }
                if worker.is_none() && dev && changed {
                    match DevWorker::start(&project, shared.clone(), url.clone()) {
                        Ok(next) => worker = next,
                        Err(error) => snapback4_core::diagnostic!("snapback4 worker: {error}"),
                    }
                }
                if let Some(worker) = &mut worker { worker.tick(); }
                for worker in named.values_mut() { worker.tick(); }
                // Removed declarations remain owned until deletion commits.
                named.retain(|_, worker| !worker.retiring || worker.child_expires_at.is_some());
                pending.retain(|name, (at, backoff)| {
                    if named.contains_key(name) { return false; }
                    if Instant::now() < *at { return true; }
                    // Rediscover on every retry: a formerly valid pathname is
                    // never sufficient custody for a new declaration either.
                    let result = declared(&project).and_then(|mut entries| entries.remove(name).ok_or_else(|| format!("worker {name}: declaration is absent")))
                        .and_then(|source| DevWorker::start_named(&project, shared.clone(), url.clone(), source, !dev, name.clone()));
                    match result {
                        Ok(worker) => { named.insert(name.clone(), worker); false }
                        Err(error) => {
                            snapback4_core::diagnostic!("snapback4 worker: {error}; declaration will retry");
                            *backoff = (*backoff * 2).min(Duration::from_secs(5));
                            *at = Instant::now() + *backoff;
                            true
                        }
                    }
                });
                std::thread::park_timeout(Duration::from_millis(100));
            }
            // Start all group grace periods before waiting/revoking any one
            // worker; a hung handler cannot add two seconds per declaration.
            if let Some(worker) = &mut worker { worker.begin_stop(); }
            for worker in named.values_mut() { worker.begin_stop(); }
        })?;
        Ok(Self { stop, thread: Some(thread) })
    }

    fn named(project: &Project, shared: &Arc<Shared>, url: &str, dev: bool) -> Result<std::collections::BTreeMap<String, DevWorker>, String> {
        declared(project)?.into_iter().map(|(name, source)| {
            DevWorker::start_named(project, shared.clone(), url.to_owned(), source, !dev, name.clone()).map(|worker| (name, worker))
        }).collect()
    }

    pub(crate) fn is_finished(&self) -> bool { self.thread.as_ref().unwrap().is_finished() }
}

impl Drop for Supervisor {
    fn drop(&mut self) {
        self.stop.store(true, std::sync::atomic::Ordering::Release);
        if let Some(thread) = self.thread.take() {
            thread.thread().unpark();
            if thread.join().is_err() { snapback4_core::diagnostic!("snapback4 worker: supervisor panicked"); }
        }
    }
}

pub(crate) struct DevWorker {
    project: Project,
    name: Option<String>,
    family: Option<String>,
    ledger: PathBuf,
    source: PathBuf,
    snapshot: Option<declarations::Snapshot>,
    retiring: bool,
    node: PathBuf,
    url: String,
    explicit_env: bool,
    starts: u64,
    crashes: u64,
    shared: Arc<Shared>,
    child: Option<Child>,
    worker_pid: Option<u32>,
    // Each child gets its own session, closed when that child exits: a dead
    // child's long poll then fails its next reauthentication instead of
    // claiming work for a connection nobody reads.
    child_expires_at: Option<i64>,
    child_revision: Option<usize>,
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
        // @ref LLP 3000.009#5.3 — a stable application-file base, separate from
        // the disposable module snapshot and unchanged if Node later chdirs.
        let project = Project { root: project.root.canonicalize().map_err(|e| format!("worker project: {e}"))? };
        // Preserve the automatic entry spelling. Canonicalizing it here would
        // forget a symlink before the per-launch no-follow snapshot validates it.
        let source = if explicit_env { source.canonicalize().map_err(|e| format!("worker {}: {e}", source.display()))? } else { source };
        if !source.is_file() { return Err(format!("worker {} is not a file", source.display())); }
        warn_if_esm_entry_is_not_declared(&source);
        validate_environment(&lock(&shared.bound).schema)?;
        let node = node();
        let version = command(&node).arg("--version").output().map_err(|e| format!("worker needs Node 24: {e}"))?;
        if !version.status.success() || !String::from_utf8_lossy(&version.stdout).starts_with("v24.") { return Err("worker needs Node 24; put it on PATH or set SNAPBACK_NODE to its executable".into()); }
        let revision = shared.worker_revision.load(std::sync::atomic::Ordering::Acquire);
        // @ref LLP 3000.009#5.2 — a new store can reuse sequence/ordinal effect ids.
        let ledger = {
            let engine = lock(&shared.engine);
            let path = engine.store().conn().path().filter(|s| !s.is_empty()).ok_or("worker ledger needs a file-backed store")?;
            let identity = engine.store().meta("store_id").map_err(|e| e.to_string())?.ok_or("worker ledger needs a store identity")?;
            let namespace = format!("{:x}", Sha256::digest(identity.as_bytes()));
            PathBuf::from(path).canonicalize().map_err(|e| e.to_string())?.parent().ok_or("store parent")?.join(format!("worker-ledger-{namespace}.sqlite"))
        };
        let worker = Self { name: None, family: None, ledger, project: Project { root: project.root.clone() }, source, snapshot: None, retiring: false, node, url, explicit_env, starts: 0, crashes: 0, shared, child: None, worker_pid: None, child_expires_at: None, child_revision: None, restart: Instant::now(), started: Instant::now(), backoff: Duration::from_millis(250), revision };
        crate::lifecycle::managed_cleanup();
        // The host's first tick follows its listening URL; keep that readiness line first on stdout.
        Ok(worker)
    }

    fn start_named(project: &Project, shared: Arc<Shared>, url: String, source: PathBuf, explicit_env: bool, name: String) -> Result<Self, String> {
        let mut worker = Self::start_source(project, shared, url, source, explicit_env)?;
        worker.name = Some(name);
        Ok(worker)
    }

    pub(crate) fn tick(&mut self) {
        if self.retiring {
            self.stop_child();
            if Instant::now() >= self.restart {
                if self.close_child_session() { self.record_status("stopped"); }
                else { self.record_status("revocation-blocked"); self.retry_later(); }
            }
            return;
        }
        let revision = self.shared.worker_revision.load(std::sync::atomic::Ordering::Acquire);
        if revision != self.revision {
            self.revision = revision;
            self.stop_child(); self.close_child_session();
            if !self.explicit_env && self.name.is_none() { if let Some(source) = source(&self.project) { self.source = source; } }
            self.restart = Instant::now();
        }
        // Renew through a new child, so the process receives its new token.
        // Check both clocks: a wall-clock correction cannot extend a child
        // beyond the supervision window. Allow two seconds for shutdown.
        if self.child.is_some() && (self.started.elapsed() >= CHILD_WINDOW - Duration::from_secs(2)
            || self.child_expires_at.is_some_and(|at| self.shared.now() >= at.saturating_sub(2_000))) {
            snapback4_core::diagnostic!("snapback4 worker: supervision window ended; replacing child");
            self.stop_child();
            self.close_child_session();
            self.restart = Instant::now();
        }
        if let Some(child) = &mut self.child {
            let ledger_unavailable;
            match child.try_wait() {
                Ok(None) => return,
                Err(error) => { snapback4_core::diagnostic!("snapback4 worker: wait failed: {error}"); return; }
                Ok(Some(status)) => {
                    ledger_unavailable = status.code() == Some(78);
                    use std::os::unix::process::ExitStatusExt;
                    if status.signal().is_some() { self.kill_worker_group(); }
                    else { self.worker_pid = None; }
                    snapback4_core::diagnostic!("snapback4 worker: exited {status}; restarting in {} ms", self.backoff.as_millis());
                }
            }
            self.child = None;
            self.snapshot = None;
            self.crashes += 1;
            // @ref LLP 3000.019#3.6 — revoke on the first writer turn: claims queued behind exit
            // detection must not lease work to this dead child during backoff.
            let retired = self.close_child_session();
            self.record_status(if !retired { "revocation-blocked" } else if ledger_unavailable { "ledger-unavailable" } else { "waiting" });
            if self.started.elapsed() > Duration::from_secs(30) { self.backoff = Duration::from_millis(250); }
            self.restart = Instant::now() + self.backoff;
            self.backoff = (self.backoff * 2).min(Duration::from_secs(5));
        }
        if crate::lifecycle::stopping() || Instant::now() < self.restart { return; }
        // Keep custody of the old family across failed transactions. No mint
        // may overtake retirement, including rotation and spawn failures.
        if !self.close_child_session() {
            self.record_status("revocation-blocked");
            self.retry_later();
            return;
        }
        if !self.explicit_env && self.name.is_none() && source(&self.project).is_none() { return; }
        // Never reopen a cached declaration pathname at exec time. Validate
        // the whole declaration tree for every attempt and keep the copy alive.
        self.snapshot = match self.name.as_deref() {
            Some(name) => match declarations::Snapshot::new(&self.project, name) {
                Ok(snapshot) => Some(snapshot),
                Err(error) => { snapback4_core::diagnostic!("snapback4 worker: {error}"); self.record_status("source-blocked"); self.retry_later(); return; }
            },
            None => {
                if let Err(error) = declared(&self.project) { snapback4_core::diagnostic!("snapback4 worker: {error}"); self.retry_later(); return; }
                if self.explicit_env { None } else {
                    match declarations::Snapshot::automatic(&self.project, &self.source) {
                        Ok(snapshot) => Some(snapshot),
                        Err(error) => { snapback4_core::diagnostic!("snapback4 worker: {error}"); self.record_status("source-blocked"); self.retry_later(); return; }
                    }
                }
            }
        };
        // @ref LLP 3000.007#9.2 — a restarted worker's orphaned claim poll must not lease work to the dead child.
        let session = {
            let engine = lock(&self.shared.engine);
            self.revision = self.shared.worker_revision.load(std::sync::atomic::Ordering::Acquire);
            if let Some(name) = &self.name {
                (|| -> Result<identity::Session, RuntimeError> {
                    let tx = engine.store().conn().unchecked_transaction()?;
                    let session = identity::service_session(engine.store(), name, self.shared.now(), 1)?;
                    let family = format!("{:x}", Sha256::digest(session.token.as_bytes()));
                    engine.store().set_meta(&format!("worker:family:{family}"), &self.revision.to_string())?;
                    tx.commit()?;
                    self.family = Some(family);
                    Ok(session)
                })()
            } else { child_session(engine.store(), self.shared.now(), self.revision) }
        };
        let session = match session {
            Ok(session) => session,
            Err(error) => { snapback4_core::diagnostic!("snapback4 worker: cannot mint the child's session: {error}"); self.retry_later(); return; }
        };
        let token = session.token;
        self.child_expires_at = Some(session.expires_at);
        self.child_revision = Some(self.revision);
        let secrets = { environment::values(&lock(&self.shared.bound).schema) };
        let secrets = match secrets {
            Ok(values) => values,
            Err(error) => { snapback4_core::diagnostic!("snapback4 worker: {error}"); self.close_child_session(); self.retry_later(); return; }
        };
        let mut redact: Vec<Vec<u8>> = secrets.values().map(|s| s.as_bytes().to_vec()).collect(); redact.push(token.as_bytes().to_vec());
        let entry = self.snapshot.as_ref().map(|s| &s.entry).unwrap_or(&self.source);
        let secrets = if self.name.is_some() { environment::for_entry(entry, &secrets) } else { Ok(secrets) };
        let secrets = match secrets {
            Ok(values) => values,
            Err(error) => { snapback4_core::diagnostic!("snapback4 worker: {error}"); self.close_child_session(); self.retry_later(); return; }
        };
        let mut child_command = command(&process::executable());
        process::isolate(&mut child_command);
        child_command.arg("--internal-worker-watchdog").arg(&self.node).arg(entry);
        process::retain_owner(&mut child_command, self.shared.worker_owner());
        match child_command.current_dir(&self.project.root).envs(secrets).env("SNAPBACK_PROJECT_DIR", &self.project.root).env("SNAPBACK_URL", &self.url).env("SNAPBACK_SERVICE_TOKEN", &token).env("SNAPBACK_WORKER_LEDGER", &self.ledger).env("SNAPBACK_WORKER_SUPERVISED", "1").stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn() {
            Ok(mut child) => {
                use std::io::BufRead;
                let mut stdout = std::io::BufReader::new(child.stdout.take().expect("piped stdout"));
                let mut pid = String::new();
                self.worker_pid = stdout.read_line(&mut pid).ok().and_then(|_| crate::thread_priority::worker_started(&pid));
                environment::pipe(stdout, redact.clone(), self.name.as_deref().unwrap_or("worker").to_owned());
                environment::pipe(child.stderr.take().expect("piped stderr"), redact, self.name.as_deref().unwrap_or("worker").to_owned());
                snapback4_core::diagnostic!("snapback4 worker: {} (pid {})", self.source.display(), self.worker_pid.unwrap_or(0)); self.child = Some(child); self.started = Instant::now(); self.starts += 1; self.record_status("running");
            }
            Err(error) => { snapback4_core::diagnostic!("snapback4 worker: cannot start: {error}"); self.close_child_session(); self.retry_later(); }
        }
    }

    fn retry_later(&mut self) {
        self.restart = Instant::now() + self.backoff;
        self.backoff = (self.backoff * 2).min(Duration::from_secs(5));
    }

    fn record_status(&self, state: &str) {
        let record = serde_json::json!({ "name": self.name.as_deref().unwrap_or("worker"), "source": self.source, "mode": if self.explicit_env { "serve" } else { "dev" }, "state": state, "starts": self.starts, "restarts": self.starts.saturating_sub(1), "crashes": self.crashes, "pid": self.worker_pid });
        if let Err(error) = lock(&self.shared.engine).store().set_meta(&self.name.as_ref().map(|name| format!("worker:status:{name}")).unwrap_or_else(|| "worker:status".into()), &record.to_string()) {
            snapback4_core::diagnostic!("snapback4 worker: cannot record status: {error}");
        }
    }

    fn close_child_session(&mut self) -> bool {
        if self.child_expires_at.is_none() { return true; }
        let engine = lock(&self.shared.engine);
        let result = (|| -> Result<(), RuntimeError> {
            let tx = engine.store().conn().unchecked_transaction()?;
            if let Some(family) = &self.family {
                tx.execute("DELETE FROM _sessions WHERE COALESCE(family, token_digest) = ?1", [family])?;
                tx.execute("DELETE FROM _meta WHERE key = ?1", [format!("worker:family:{family}")])?;
            } else {
                tx.execute("DELETE FROM _sessions WHERE principal = 'service:worker' AND COALESCE(family, token_digest) = (SELECT value FROM _meta WHERE key = 'worker:session-family')", [])?;
                tx.execute("DELETE FROM _meta WHERE key IN ('worker:session-family', 'worker:session-revision')", [])?;
            }
            tx.commit()?;
            Ok(())
        })();
        if let Err(error) = result {
            // @ref LLP 3000.009#5.3 — failed retirement fences the original revision once.
            // A blocked DELETE cannot keep the retired credential current.
            // Fence its revision once, including on serve. Other supervised
            // children renew under the new revision; manual seats are unchanged.
            // Keep the child's original revision across every retirement retry.
            if let Some(revision) = self.child_revision {
                let _ = self.shared.worker_revision.compare_exchange(revision, revision + 1, std::sync::atomic::Ordering::AcqRel, std::sync::atomic::Ordering::Acquire);
            }
            snapback4_core::diagnostic!("snapback4 worker: cannot close the child's session; worker stopped, replacement suspended: {error}");
            return false;
        }
        self.child_expires_at = None;
        self.child_revision = None;
        self.family = None;
        true
    }

    fn begin_stop(&mut self) {
        if let Some(child) = &mut self.child { drop(child.stdin.take()); }
    }

    fn stop_child(&mut self) {
        self.begin_stop();
        if let Some(mut child) = self.child.take() {
            // EOF reaches the watchdog even on abrupt host death. It owns
            // bounded graceful termination and the final descendant kill.
            let status = child.wait();
            // A killed watchdog cannot clean up. Its Node group still belongs
            // to us; terminate it before forgetting the PID or source bytes.
            use std::os::unix::process::ExitStatusExt;
            if status.as_ref().map_or(true, |s| s.signal().is_some()) { self.kill_worker_group(); }
            else { self.worker_pid = None; }
        }
        self.snapshot = None;
    }

    fn kill_worker_group(&mut self) {
        if let Some(pid) = self.worker_pid.take() { unsafe { libc::kill(-(pid as libc::pid_t), libc::SIGKILL); } }
    }
}

impl Drop for DevWorker {
    fn drop(&mut self) {
        self.stop_child();
        let retired = self.close_child_session();
        self.record_status(if retired { "stopped" } else { "revocation-blocked" });
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
    snapback4_core::diagnostic!("snapback4 worker: {} uses ES modules but {reason}, so Node will read it as CommonJS", source.display());
    snapback4_core::diagnostic!("snapback4 worker:   rewrite: rename it to {renamed} — or declare \"type\": \"module\" for it");
}

fn command(node: &std::path::Path) -> Command {
    let mut command = Command::new(node);
    command.env_clear();
    for name in ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "TZ"] {
        if let Some(value) = std::env::var_os(name) { command.env(name, value); }
    }
    command
}
