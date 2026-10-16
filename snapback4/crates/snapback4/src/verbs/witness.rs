//! Installed-app witness driver. It owns its backend and capture children;
//! simulator operations always name a resolved UDID, never `booted`.
mod protocol;
mod preparation;
mod preparation_deadline;
mod smoke;
mod acquire;
mod web;
mod simulator;
mod ownership;
mod recovery;
mod retention;
mod cleanup;
mod recorded_process;
pub(crate) mod process_group;
mod publication;
pub(super) mod background;
#[cfg(test)]
mod test_process;
use protocol::*;
use serde_json::{Value, json};
use std::{collections::BTreeMap, fs::{self, File, OpenOptions}, io::{Read, Write}, path::{Path, PathBuf}, process::{Child, Command, ExitStatus, Stdio}, sync::atomic::{AtomicBool, Ordering}, thread::sleep, time::{Duration, Instant}};

static INTERRUPTED: AtomicBool = AtomicBool::new(false);
extern "C" fn interrupt(_: libc::c_int) { INTERRUPTED.store(true, Ordering::Relaxed); }
fn interrupted() -> Result<()> {
    if INTERRUPTED.load(Ordering::Relaxed) { return Err(error("E_WITNESS_INTERRUPTED", "witness interrupted; stopping its owned processes")); }
    Ok(())
}
fn tick() -> Result<()> { interrupted()?; sleep(Duration::from_millis(100)); Ok(())
}

struct Options {
    bundle: String, udid: Option<String>, segment: String, artifacts: PathBuf,
    port: u16, timeout: Duration, prime: bool, relaunch: bool, smoke: bool,
    build: Option<PathBuf>, export: Option<PathBuf>,
}
impl Options {
    fn parse(args: &[String]) -> Result<Self> {
        if args.first().map(String::as_str) != Some("ios") { return Err(error("E_WITNESS_INPUT", "use snapback4 witness acquire --as <persona|principal> [--restart] or snapback4 witness ios --build . --smoke [--udid <id>] [--port N] [--artifacts <dir>]; see snapback4 guide witness for installed-app scenarios")); }
        if args.iter().any(|a| matches!(a.as_str(), "--repack" | "--app-project") || a.starts_with("--repack=") || a.starts_with("--app-project=")) {
            return Err(error("E_WITNESS_INPUT", "repack is withdrawn; use witness ios --build <project> --smoke with a fresh --artifacts directory"));
        }
        let mut flags = BTreeMap::new();
        let mut iter = args.iter().skip(1);
        while let Some(flag) = iter.next() {
            let Some(raw) = flag.strip_prefix("--") else { return Err(error("E_WITNESS_INPUT", "unexpected argument; see snapback4 guide witness")); };
            let key = raw.split('=').next().unwrap();
            if ["token", "token-file"].contains(&key) { return Err(error("E_WITNESS_INPUT", format!("--{key} is unsupported for witness ios"))); }
            if !["bundle-id", "udid", "segment", "artifacts", "port", "timeout", "prime", "relaunch", "smoke", "build", "export"].contains(&key) { return Err(error("E_WITNESS_INPUT", "unknown flag; see snapback4 guide witness")); }
            if raw.contains('=') { return Err(error("E_WITNESS_INPUT", format!("--{key} does not accept equals spelling; see snapback4 guide witness"))); }
            let value = if ["prime", "relaunch", "smoke"].contains(&key) { String::new() } else {
                iter.next().filter(|s| !s.starts_with("--")).cloned().ok_or_else(|| error("E_WITNESS_INPUT", format!("--{key} requires a value")))?
            };
            if flags.insert(key, value).is_some() { return Err(error("E_WITNESS_INPUT", format!("duplicate --{key}"))); }
        }
        let required = |key| flags.get(key).filter(|s| !s.is_empty()).cloned().ok_or_else(|| error("E_WITNESS_INPUT", format!("--{key} is required; see snapback4 guide witness")));
        let selectors = ["bundle-id", "build"].iter().filter(|k| flags.contains_key(**k)).count();
        if selectors == 0 { return Err(error("E_WITNESS_INPUT", "--bundle-id is required for installed-app mode, or use --build <project>")); }
        if selectors != 1 { return Err(error("E_WITNESS_INPUT", "select exactly one of --bundle-id or --build")); }
        if flags.contains_key("export") && (!flags.contains_key("build") || !flags.contains_key("smoke")) {
            return Err(error("E_WITNESS_INPUT", "--export requires --build and --smoke"));
        }
        let bundle = flags.get("bundle-id").cloned().unwrap_or_default();
        if !bundle.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-') { return Err(error("E_WITNESS_INPUT", "--bundle-id must be a valid bundle identifier")); }
        let smoke = flags.contains_key("smoke");
        if !smoke && flags.contains_key("build") {
            return Err(error("E_WITNESS_INPUT", "prepared proof currently requires --smoke; application scenarios use installed-app mode"));
        }
        if smoke && ["segment", "prime", "relaunch"].iter().any(|key| flags.contains_key(key)) {
            return Err(error("E_WITNESS_INPUT", "--smoke owns prime, offline and restart; omit --segment, --prime and --relaunch"));
        }
        let segment = if smoke { "smoke".into() } else { required("segment")? };
        if !name(&segment) || segment == "prime" { return Err(error("E_WITNESS_INPUT", "--segment uses letters, digits, hyphens or underscores; prime is reserved")); }
        let artifacts = flags.get("artifacts").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(format!("artifacts/native-smoke/{}-{}", now(), std::process::id())));
        let port = flags.get("port").map_or(Ok(if flags.contains_key("build") { 0 } else { 4400 }), |s| s.parse::<u16>()).ok().filter(|p| *p > 0 || !flags.contains_key("port")).ok_or_else(|| error("E_WITNESS_INPUT", "--port must be 1..65535"))?;
        let seconds = flags.get("timeout").map_or(Ok(120), |s| s.parse::<u64>()).ok().filter(|s| *s > 0 && *s <= 86400).ok_or_else(|| error("E_WITNESS_INPUT", "--timeout must be 1..86400 seconds per step"))?;
        Ok(Self { bundle, udid: flags.get("udid").cloned(), segment, artifacts, port, timeout: Duration::from_secs(seconds), prime: smoke || flags.contains_key("prime"), relaunch: flags.contains_key("relaunch"), smoke, build: flags.get("build").map(PathBuf::from), export: flags.get("export").map(PathBuf::from) })
    }
}

// @ref LLP 3000.030#8 — legacy execution has unknown preparation, even after repack.
fn artifact_segment(options: &Options) -> String {
    if ["m6", "m8"].contains(&options.segment.as_str()) { format!("installed-{}", options.segment) }
    else { options.segment.clone() }
}

/// A child is reaped before its PID can be reused. Every exit path drops it.
struct Owned(Child);
impl Owned {
    fn spawn(command: &mut Command) -> Result<Self> { command.spawn().map(Self).map_err(|e| error("E_WITNESS_PROCESS", e)) }
    fn status(&mut self) -> Result<Option<ExitStatus>> { self.0.try_wait().map_err(|e| error("E_WITNESS_PROCESS", e)) }
    fn alive(&mut self, label: &str) -> Result<()> {
        if let Some(status) = self.status()? { return Err(error("E_WITNESS_PROCESS", format!("{label} exited early ({status})"))); } Ok(())
    }
    fn stop(&mut self, signal: i32) -> Result<ExitStatus> {
        if let Some(status) = self.status()? { return Ok(status); }
        #[cfg(unix)]
        unsafe { libc::kill(self.0.id() as i32, signal); }
        #[cfg(not(unix))]
        self.0.kill().map_err(|e| error("E_WITNESS_PROCESS", e))?;
        let end = Instant::now() + Duration::from_secs(10);
        loop {
            if let Some(status) = self.status()? { return Ok(status); }
            if Instant::now() >= end {
                let _ = self.0.kill(); let _ = self.0.wait();
                return Err(error("E_WITNESS_PROCESS", "owned process did not stop within 10 seconds; killed it"));
            }
            sleep(Duration::from_millis(50));
        }
    }
}
impl Drop for Owned { fn drop(&mut self) { let _ = self.stop(libc::SIGTERM); } }

fn simctl(args: &[&str], timeout: Duration) -> Result<String> {
    let mut command = Command::new("xcrun");
    command.arg("simctl").args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = Owned(command.spawn().map_err(|e| interrupted().err().unwrap_or_else(|| {
        if e.kind() == std::io::ErrorKind::NotFound {
            error("E_WITNESS_PLATFORM", "xcrun is unavailable; install Xcode and its command line tools")
        } else { error("E_WITNESS_PROCESS", e) }
    }))?);
    let creating = args.first() == Some(&"create");
    let stdout = child.0.stdout.take().unwrap(); let stderr = child.0.stderr.take().unwrap();
    let read = |mut pipe: Box<dyn Read + Send>| std::thread::spawn(move || { let mut text = String::new(); let _ = pipe.read_to_string(&mut text); text });
    let out = read(Box::new(stdout)); let err = read(Box::new(stderr));
    let end = Instant::now() + timeout;
    let status = loop {
        if let Some(status) = child.status().map_err(|e| interrupted().err().unwrap_or(e))? { break status; }
        if Instant::now() >= end { interrupted()?; return Err(error("E_WITNESS_TIMEOUT", "xcrun simctl timed out; check --udid and --timeout")); }
        // Creation must return its identity before cancellation can delete it.
        // Its existing timeout still bounds a stuck simctl.
        if creating { sleep(Duration::from_millis(50)); } else { tick()?; }
    };
    let text = out.join().unwrap_or_default(); let _ = err.join();
    if !creating || !status.success() { interrupted()?; }
    if !status.success() { return Err(error("E_WITNESS_SIMULATOR", format!("xcrun simctl {} failed; check --udid, --bundle-id and the simulator/runtime", args.first().copied().unwrap_or("")))); }
    Ok(text.trim().to_owned())
}

fn command_text(program: &str, args: &[&str], timeout: Duration) -> Result<String> {
    let mut command = Command::new(program);
    command.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
    let mut child = Owned::spawn(&mut command)?;
    let mut pipe = child.0.stdout.take().unwrap();
    let reader = std::thread::spawn(move || { let mut text = String::new(); let _ = pipe.read_to_string(&mut text); text });
    let end = Instant::now() + timeout;
    loop {
        if let Some(status) = child.status()? {
            if !status.success() { return Err(error("E_WITNESS_PLATFORM", "toolchain probe failed")); }
            return Ok(reader.join().unwrap_or_default().trim().to_owned());
        }
        if Instant::now() >= end { return Err(error("E_WITNESS_TIMEOUT", "toolchain probe timed out")); }
        tick()?;
    }
}

fn installed_app(udid: &str, bundle: &str, timeout: Duration) -> Result<String> {
    simctl(&["get_app_container", udid, bundle, "app"], timeout)
}

fn output(path: &Path) -> Result<File> { OpenOptions::new().create(true).append(true).open(path).map_err(|e| error("E_WITNESS_ARTIFACT", format!("cannot open command log; check --artifacts permissions: {e}"))) }
fn read_rows(path: &Path, final_file: bool) -> Result<Vec<Value>> {
    match fs::read(path) {
        Ok(bytes) => receipts(&bytes, final_file),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound && !final_file => Ok(Vec::new()),
        Err(e) => Err(error("E_WITNESS_RECEIPT", e)),
    }
}

struct Run {
    options: Options, udid: String, container: PathBuf, run: String, dir: PathBuf,
    backend: Option<Owned>, video: Option<Owned>, logs: Option<Owned>, app_pid: Option<u32>, app_started: u128,
    manifest: Value, events: Vec<Value>, observed: Vec<Value>,
    _lease: Vec<File>, _project_lease: Vec<File>, proof: Option<Value>, reservation: Option<std::net::TcpListener>,
}
impl Run {
    fn event(&mut self, step: &str) { self.events.push(json!({ "step": step, "at": now() })); eprintln!("witness: {step}"); }
    fn receipts(&self) -> PathBuf { self.dir.join("receipts.jsonl") }
    fn path(&self, suffix: &str) -> PathBuf { self.options.artifacts.join(format!("{}-ios-{suffix}", artifact_segment(&self.options))) }
    fn running_app(&self) -> Result<Option<u32>> {
        app_pid(&simctl(&["spawn", &self.udid, "launchctl", "list"], self.options.timeout)?, &self.options.bundle)
    }
    fn require_stopped(&self) -> Result<()> {
        if self.running_app()?.is_some() { return Err(error("E_WITNESS_APP", "--bundle-id selects an app already running on --udid; quit it before starting the witness")); }
        Ok(())
    }
    // @ref LLP 3000.007#20.10 — the launch PID owns cleanup, never the bundle alone
    fn terminate(&mut self, require_alive: bool) -> Result<()> {
        let Some(pid) = self.app_pid else { return if require_alive { Err(error("E_WITNESS_APP", "successful segment lost its owned PID")) } else { Ok(()) }; };
        match self.running_app()? {
            None => { self.app_pid = None; return if require_alive { Err(error("E_WITNESS_APP", format!("app PID {pid} exited before deliberate termination"))) } else { Ok(()) }; }
            Some(current) if current != pid => {
                self.app_pid = None;
                return Err(error("E_WITNESS_APP", "--bundle-id app on --udid was replaced; leaving that instance running"));
            }
            Some(_) => {}
        }
        // The simulator runtime has no `kill`; `simctl terminate` is the supported
        // mechanism. The check above just confirmed the running instance is ours.
        simctl(&["terminate", &self.udid, &self.options.bundle], self.options.timeout)?;
        let end = Instant::now() + self.options.timeout;
        while self.running_app()? == Some(pid) {
            if Instant::now() >= end { return Err(error("E_WITNESS_TIMEOUT", format!("app PID {pid} did not stop"))); }
            tick()?;
        }
        self.app_pid = None;
        self.events.push(json!({ "step": "app-terminated", "pid": pid, "at": now() })); Ok(())
    }
    fn launch(&mut self, segment: &str) -> Result<()> {
        self.require_stopped()?;
        if let Some(proof) = &self.proof { preparation::verify(&self.options, self.manifest["appPath"].as_str().unwrap(), &proof["installedApp"]["sha256"], &format!("verify-{segment}"))?; }
        let config = json!({ "run": self.run, "segment": segment,
            "smokeAccount": if self.options.smoke && segment == "prime" { Some(json!({ "email": format!("smoke-{}@example.test", self.run), "password": snapback4_core::ids::mint(now() as i64, &mut snapback4_core::ids::Mint::default()).map_err(|e| error("E_WITNESS_AUTH", e))? })) } else { None }, "timeoutMs": self.options.timeout.as_millis(),
            "proof": self.proof.as_ref().map(|p| json!({ "sha256": p["sha256"], "proofKind": p["proofKind"], "nativeBase": p["nativeBase"], "executedApp": { "inventory": { "sha256": p["executedApp"]["inventory"]["sha256"] } } })), "origin": format!("http://127.0.0.1:{}", self.options.port), "smoke": self.options.smoke, "queryFacts": self.manifest["queryFacts"], "queryGeneration": self.manifest["queryGeneration"], "barrierSeq": self.manifest["syncBarrier"]["seq"], "baseline": self.manifest["segments"]["prime"]["receipt"] });
        let mut command = Command::new("xcrun");
        command.args(["simctl", "launch", &self.udid, &self.options.bundle])
            .env("SIMCTL_CHILD_SNAPBACK4_WITNESS", config.to_string())
            .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(output(&self.path("launch.log"))?);
        self.app_started = now();
        let mut child = Owned::spawn(&mut command)?;
        let mut stdout = child.0.stdout.take().unwrap();
        let reader = std::thread::spawn(move || { let mut text = String::new(); let _ = stdout.read_to_string(&mut text); text });
        let end = Instant::now() + self.options.timeout;
        let status = (|| -> Result<ExitStatus> { loop {
            if let Some(status) = child.status()? { return Ok(status); }
            if Instant::now() >= end { return Err(error("E_WITNESS_TIMEOUT", "app launch timed out")); }
            tick()?;
        } })();
        if status.is_err() { let _ = child.stop(libc::SIGTERM); }
        let text = reader.join().unwrap_or_default();
        let prefix = format!("{}: ", self.options.bundle);
        // Even an interrupted or failed simctl may already have reported the
        // app it launched. Record that PID before any fallible log write.
        self.app_pid = text.lines().find_map(|l| l.strip_prefix(&prefix).and_then(|p| p.trim().parse::<u32>().ok())).filter(|p| *p > 0);
        recovery::app(&self.options, self.app_pid, &self.udid, &self.options.bundle, &self.dir)?;
        if background::active() {
            if let Some(pid) = self.app_pid { self.manifest["backgroundPolicies"][segment] = background::lower_app(pid)?; }
        }
        output(&self.path("launch.log"))?.write_all(text.as_bytes()).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
        let status = status?;
        if !status.success() { return Err(error("E_WITNESS_APP", format!("--bundle-id app launch failed ({status}); see the command's own log path: {}", self.path("launch.log").display()))); }
        let pid = self.app_pid.ok_or_else(|| error("E_WITNESS_APP", "simctl launch did not report an app PID; cannot claim ownership"))?;
        self.events.push(json!({ "step": format!("{segment}-launched"), "pid": pid, "at": now() })); Ok(())
    }
    fn start_backend(&mut self) -> Result<()> {
        let reservation = match self.reservation.take() { Some(listener) => listener, None => reserve(self.options.port)? };
        let binary = std::env::current_exe().map_err(|e| error("E_WITNESS_BACKEND", e))?;
        let stdout = self.path("backend-stdout.log");
        let offset = fs::metadata(&stdout).map_or(0, |m| m.len()) as usize;
        let mut command = Command::new(binary);
        command.args(["dev", "--port", &self.options.port.to_string(), "--no-watch"])
            .env("SNAPBACK4_WITNESS_DRIVER", "1")
            .stdin(Stdio::null()).stdout(output(&stdout)?).stderr(output(&self.path("backend.log"))?);
        crate::witness_socket::inherit(&mut command, &reservation);
        self.backend = Some(Owned::spawn(&mut command)?);
        recovery::child(&self.options, "backend", self.backend.as_ref().unwrap().0.id())?;
        drop(reservation);
        let end = Instant::now() + self.options.timeout;
        loop {
            let child = self.backend.as_mut().unwrap();
            if let Some(status) = child.status()? { return Err(error("E_WITNESS_BACKEND", format!("dev exited ({status}); see the command's own log path: {}", self.path("backend.log").display()))); }
            // Only our child's readiness announcement can satisfy startup.
            if fs::read_to_string(&stdout).unwrap_or_default().get(offset..).unwrap_or_default().lines().any(|line| line == format!("http://127.0.0.1:{}", self.options.port)) && !refused(self.options.port)? { break; }
            if Instant::now() >= end { return Err(error("E_WITNESS_BACKEND", "dev did not become ready before the step timeout")); }
            tick()?;
        }
        self.bind_served_queries()?;
        self.event("backend-ready"); Ok(())
    }
    fn stop_backend(&mut self) -> Result<()> {
        if let Some(mut child) = self.backend.take() {
            child.alive("backend").map_err(|e| error("E_WITNESS_BACKEND", e))?;
            child.stop(libc::SIGTERM).map_err(|e| error("E_WITNESS_BACKEND", e))?;
        }
        let end = Instant::now() + self.options.timeout;
        while !refused(self.options.port)? {
            if Instant::now() >= end { return Err(error("E_WITNESS_BACKEND", "backend stopped but the port still accepts connections; no other process was stopped")); }
            tick()?;
        }
        self.event("backend-refuses-connections"); Ok(())
    }
    fn wait_step(&mut self, expected: &str, offline: bool) -> Result<()> {
        self.event(&format!("waiting-{expected}"));
        let end = Instant::now() + self.options.timeout;
        loop {
            if let Some(child) = &mut self.video { child.alive("video recorder")?; }
            if self.app_pid.is_some() && self.running_app()? != self.app_pid {
                if expected == "primed" && read_rows(&self.receipts(), false).is_ok_and(|rows| !rows.iter().any(|r| r["witness"]["step"] == "primed")) {
                    // DiagnosticReports arrives asynchronously after launchctl loses the PID.
                    let deadline = Instant::now() + Duration::from_secs(3);
                    if let Some(home) = std::env::var_os("HOME") {
                        let reports = PathBuf::from(home).join("Library/Logs/DiagnosticReports");
                        loop {
                            if let Some(crash) = scene_crash(&reports, &self.options.bundle, self.app_pid.unwrap(), &self.udid, self.app_started, deadline) {
                                self.manifest["sceneCrash"] = crash;
                                return Err(error("E_WITNESS_SCENE_LIFECYCLE", SCENE_REPAIR));
                            }
                            if Instant::now() >= deadline { break; }
                            tick()?;
                        }
                    }
                }
                return Err(error("E_WITNESS_APP", "owned app exited or was replaced while awaiting its receipt"));
            }
            if let Some(child) = &mut self.logs { child.alive("log capture")?; }
            if let Some(child) = &mut self.backend { child.alive("backend").map_err(|e| error("E_WITNESS_BACKEND", e))?; }
            if offline && !refused(self.options.port)? { return Err(error("E_WITNESS_BACKEND", "backend port became reachable during the offline step")); }
            let rows = read_rows(&self.receipts(), false)?;
            if !rows.starts_with(&self.observed) { return Err(error("E_WITNESS_RECEIPT", "previously observed receipts changed during the run")); }
            sequence(&rows, &self.expected(), false)?;
            let mut reached = false;
            for row in rows.iter().skip(self.observed.len()) {
                let step = row["witness"]["step"].as_str().unwrap();
                if milestone(step) {
                    if reached { return Err(error("E_WITNESS_STEP", "app emitted a later milestone before the driver advanced")); }
                    if step != expected { return Err(error("E_WITNESS_STEP", format!("expected {expected}, received {step}"))); }
                    reached = true;
                }
            }
            self.observed = rows;
            if reached {
                if let Some(proof) = &self.proof {
                    let segment = match expected { "primed" => "prime", "offline-done" if self.options.smoke => "offline", "done" if self.options.smoke => "restart", _ => self.options.segment.as_str() };
                    preparation::binding(&self.observed, proof, &self.run, segment)?;
                }
                self.event(expected); return Ok(());
            }
            if Instant::now() >= end { return Err(error("E_WITNESS_TIMEOUT", format!("app did not reach {expected} within --timeout"))); }
            tick()?;
        }
    }
    fn expected(&self) -> Vec<&str> {
        let mut steps = Vec::new();
        if self.options.prime { steps.push("primed"); }
        if self.options.relaunch { steps.push("relaunch"); }
        steps.extend(["offline-done", "done"]); steps
    }
    fn capture(&mut self) -> Result<()> {
        let mut video = Command::new("xcrun");
        video.args(["simctl", "io", &self.udid, "recordVideo", "--codec=h264"]).arg(self.path("screen.mp4"))
            .stdin(Stdio::null()).stdout(Stdio::null()).stderr(output(&self.path("video.log"))?);
        self.video = Some(Owned::spawn(&mut video)?);
        recovery::child(&self.options, "video", self.video.as_ref().unwrap().0.id())?;
        let mut logs = Command::new("xcrun");
        // Only the app's own process: a whole-simulator debug stream is tens of megabytes per segment.
        let executable = self.manifest["appBuild"]["CFBundleExecutable"].as_str().unwrap_or_default().replace('"', "");
        logs.args(["simctl", "spawn", &self.udid, "log", "stream", "--style", "json", "--level", "debug", "--predicate"]).arg(format!("process == \"{executable}\""))
            .stdin(Stdio::null()).stdout(output(&self.path("device.log"))?).stderr(output(&self.path("log-stderr.log"))?);
        self.logs = Some(Owned::spawn(&mut logs)?);
        recovery::child(&self.options, "logs", self.logs.as_ref().unwrap().0.id())?;
        let end = Instant::now() + self.options.timeout;
        loop {
            self.video.as_mut().unwrap().alive("video recorder")?;
            self.logs.as_mut().unwrap().alive("log capture")?;
            if fs::read_to_string(self.path("video.log")).unwrap_or_default().contains("Recording started") { break; }
            if Instant::now() >= end { return Err(error("E_WITNESS_TIMEOUT", "video recorder did not report Recording started")); }
            tick()?;
        }
        self.event("recording-started"); Ok(())
    }
    fn finish_capture(&mut self) -> Result<()> {
        if self.video.is_none() && self.logs.is_none() { return Ok(()); }
        // SIGINT finalizes the movie before log capture ends. Attempt both
        // stops even if the first fails, then retain the first refusal.
        let stop = |child: &mut Option<Owned>| -> Result<()> {
            if let Some(mut c) = child.take() {
                c.alive("capture")?;
                let status = c.stop(libc::SIGINT)?;
                #[cfg(unix)]
                let interrupted = { use std::os::unix::process::ExitStatusExt; status.signal() == Some(libc::SIGINT) || status.code() == Some(130) };
                #[cfg(not(unix))]
                let interrupted = false;
                if !status.success() && !interrupted { return Err(error("E_WITNESS_PROCESS", format!("capture failed while finalizing ({status})"))); }
            } Ok(())
        };
        let video = stop(&mut self.video); let logs = stop(&mut self.logs);
        video?; logs?; self.event("recording-stopped"); Ok(())
    }
    fn execute(&mut self) -> Result<()> {
        if self.options.smoke { return self.execute_smoke(); }
        self.require_stopped()?;
        self.start_backend()?;
        if self.options.prime { self.launch("prime")?; self.wait_step("primed", false)?; self.terminate(false)?; }
        self.stop_backend()?;
        self.capture()?;
        self.launch(&self.options.segment.clone())?;
        if self.options.relaunch {
            self.wait_step("relaunch", true)?; self.terminate(false)?;
            self.launch(&self.options.segment.clone())?; self.event("offline-relaunched");
        }
        self.wait_step("offline-done", true)?;
        self.start_backend()?;
        fs::write(self.dir.join("reconnect"), b"ready\n").map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
        self.event("reconnect-signaled");
        self.wait_step("done", false)?;
        self.finish_capture()?;
        self.terminate(true)?;
        self.stop_backend()?;
        Ok(())
    }
    fn save(&mut self, result: &Result<()>) -> Result<()> {
        self.manifest["endedAt"] = json!(now());
        self.manifest["events"] = json!(self.events);
        self.manifest["exitStatus"] = json!(if result.is_ok() { 0 } else { 1 });
        self.manifest["error"] = json!(result.as_ref().err());
        self.manifest["artifacts"] = json!({});
        let mut problem = None;
        if let Some(proof) = &self.proof {
            if artifact(&self.options.artifacts.join("proof.json"))?["sha256"] != proof["sha256"] { problem = Some(error("E_WITNESS_PROOF", "sealed proof changed during execution")); }
            if let Err(e) = preparation::verify(&self.options, self.manifest["appPath"].as_str().unwrap(), &proof["installedApp"]["sha256"], "verify-collection") { problem = Some(e); }
            self.manifest["proof"] = artifact(&self.options.artifacts.join("proof.json"))?;
        }
        // Re-resolve the data container at collection, so the path itself is
        // recorded, and never replace a missing export with an empty file.
        match simctl(&["get_app_container", &self.udid, &self.options.bundle, "data"], self.options.timeout) {
            Ok(container) if Path::new(&container) == self.container => {
                if let Err(e) = fs::copy(self.receipts(), self.path("receipts.jsonl")) { problem = Some(error("E_WITNESS_RECEIPT", e)); }
            }
            Ok(_) => problem = Some(error("E_WITNESS_ARTIFACT", "app data container changed during the run")),
            Err(e) => problem = Some(e),
        }
        for suffix in ["screen.mp4", "receipts.jsonl", "device.log"] {
            match artifact(&self.path(suffix)) {
                Ok(value) => self.manifest["artifacts"][suffix] = value,
                Err(e) => { if problem.is_none() { problem = Some(e); } },
            }
        }
        // Empty stderr logs are valid evidence. Keep every driver log bound,
        // while video, receipts and the device log still require nonempty bytes.
        for suffix in ["video.log", "launch.log", "backend.log", "backend-stdout.log", "log-stderr.log"] {
            let path = self.path(suffix);
            if let Ok(bytes) = fs::read(&path) {
                use sha2::{Digest, Sha256};
                self.manifest["artifacts"][suffix] = json!({ "path": path, "bytes": bytes.len(), "sha256": format!("{:x}", Sha256::digest(&bytes)) });
            }
        }
        if let Err(e) = read_rows(&self.path("receipts.jsonl"), true).and_then(|rows| {
            if !rows.starts_with(&self.observed) { return Err(error("E_WITNESS_RECEIPT", "previously observed receipts changed during the run")); }
            sequence(&rows, &self.expected(), true)
        }) { if problem.is_none() { problem = Some(e); } }
        if result.is_ok() && let Some(e) = &problem { self.manifest["exitStatus"] = json!(1); self.manifest["error"] = json!(e); }
        if self.options.smoke { self.save_smoke(&mut problem); }
        if result.is_ok() && let Some(e) = &problem { self.manifest["exitStatus"] = json!(1); self.manifest["error"] = json!(e); }
        self.manifest["endedAt"] = json!(now());
        self.manifest["durationMs"] = json!(now().saturating_sub(self.manifest["invokedAt"].as_u64().unwrap_or(0) as u128));
        fs::write(self.path("run.json"), serde_json::to_vec_pretty(&self.manifest).unwrap()).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
        if let Some(e) = problem { return Err(e); } Ok(())
    }
}
impl Drop for Run {
    fn drop(&mut self) {
        let _ = self.finish_capture();
        if self.app_pid.is_some() { let _ = self.terminate(false); }
        if let Some(mut backend) = self.backend.take() { let _ = backend.stop(libc::SIGTERM); }
        if self.options.export.is_some() { let _ = fs::remove_dir_all(&self.dir); }
    }
}

// @ref LLP 3000.007#20.10 — explicit simulator, owned backend and bound artifacts
fn prepare(mut options: Options, preparation: &mut Value) -> Result<Run> {
    platform(std::env::consts::OS)?;
    if options.build.is_some() && std::env::current_dir().ok().and_then(|p| crate::project::Project::locate(&p)).is_none() {
        return Err(error("E_WITNESS_BUILD", "no snapback/schema.q here or above; run snapback4 init before native smoke"));
    }
    // Only this bounded pre-build stage may classify environment unavailability.
    // App/install/SDK errors after selection always remain failures.
    let (simulator, selection_lease) = match simulator::select(&options, preparation) {
        Ok(value) => value,
        Err(problem) => { if options.export.is_some() && preparation["environmentCondition"].is_string() { preparation["phase"] = json!("environment"); } return Err(problem); }
    };
    recovery::simulator(&options, &simulator)?;
    let udid = simulator["udid"].as_str().unwrap().to_owned();
    let runtime = simulator["runtime"].as_str().unwrap().to_owned();
    preparation["simulator"] = simulator.clone();
    preparation["udid"] = json!(udid);
    preparation["runtime"] = json!(runtime);
    eprintln!("witness: using simulator {} ({udid}), runtime {runtime}", simulator["name"].as_str().unwrap_or("unnamed"));
    // The simulator's data root is shared across callers with different TMPDIRs.
    let home = simctl(&["getenv", &udid, "HOME"], options.timeout)?;
    let lease = preparation::lease(&Path::new(&home).join(".snapback4-witness-owner.lock"))?;
    let _port = reserve(options.port)?;
    options.port = _port.local_addr().map_err(|e| error("E_WITNESS_PORT", e))?.port();
    let project_lease = preparation::check_project(&options)?;
    let proof = preparation::prepare_app(&mut options, &udid)?;
    let app = installed_app(&udid, &options.bundle, options.timeout)?;
    let container = PathBuf::from(simctl(&["get_app_container", &udid, &options.bundle, "data"], options.timeout)?);
    let plist = Path::new(&app).join("Info.plist");
    let mut build = json!({});
    for key in ["CFBundleIdentifier", "CFBundleVersion", "CFBundleShortVersionString", "CFBundleExecutable"] {
        let output = Command::new("/usr/bin/plutil").args(["-extract", key, "raw", "-o", "-"]).arg(&plist).output().map_err(|e| error("E_WITNESS_APP", e))?;
        if !output.status.success() { return Err(error("E_WITNESS_APP", format!("cannot read {key} from installed Info.plist; check --bundle-id"))); }
        build[key] = json!(String::from_utf8_lossy(&output.stdout).trim());
    }
    for key in ["DTXcodeBuild", "DTSDKName", "DTSDKBuild"] {
        let output = Command::new("/usr/bin/plutil").args(["-extract", key, "raw", "-o", "-"]).arg(&plist).output();
        build[key] = output.ok().filter(|o| o.status.success()).map_or(Value::Null, |o| json!(String::from_utf8_lossy(&o.stdout).trim()));
    }
    let toolchain = app_toolchain(&build);
    for key in ["xcodeBuild", "iosSdkVersion", "toolchainSource"] {
        preparation[key] = toolchain[key].clone();
    }
    if build["CFBundleIdentifier"] != options.bundle { return Err(error("E_WITNESS_APP", "installed Info.plist bundle identifier does not match --bundle-id")); }
    let installed = if options.smoke {
        json!({ "executable": artifact(&Path::new(&app).join(build["CFBundleExecutable"].as_str().unwrap()))?,
            "javascript": artifact(&Path::new(&app).join("main.jsbundle"))? })
    } else { Value::Null };
    if app_pid(&simctl(&["spawn", &udid, "launchctl", "list"], options.timeout)?, &options.bundle)?.is_some() {
        return Err(error("E_WITNESS_APP", "--bundle-id selects an app already running on --udid; quit it before starting the witness"));
    }
    let run = format!("{}-{}", now(), std::process::id());
    let dir = container.join("Documents/.snapback4-witness").join(&run);
    fs::create_dir_all(&dir).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
    let binary = std::env::current_exe().map_err(|e| error("E_WITNESS_BACKEND", e))?;
    let cwd = std::env::current_dir().map_err(|e| error("E_WITNESS_BACKEND", e))?;
    let project = cwd.ancestors().find(|p| p.join("snapback/schema.q").is_file()).ok_or_else(|| error("E_WITNESS_BACKEND", "no snapback/schema.q here or above; run the witness from your backend project"))?;
    let manifest = json!({ "xcodeBuild": toolchain["xcodeBuild"], "iosSdkVersion": toolchain["iosSdkVersion"], "toolchainSource": toolchain["toolchainSource"], "bundleId": options.bundle, "udid": udid, "runtime": runtime, "simulator": simulator, "appBuild": build, "appPath": app, "installed": installed, "cliVersion": env!("CARGO_PKG_VERSION"),
        "exported": proof.as_ref().map(|p| p["exported"].clone()),
        "nativeCache": proof.as_ref().map(|p| json!({ "hit": p["cacheHit"], "fingerprint": p["nativeFingerprint"] })),
        "proofKind": proof.as_ref().map_or(json!("installed-application"), |p| p["proofKind"].clone()),
        "queryFacts": Value::Null, "queryGeneration": Value::Null,
        "mode": if options.smoke { "smoke" } else { "application" }, "segment": options.segment, "prime": options.prime, "relaunch": options.relaunch, "startedAt": now(), "timestampUnit": "unix-ms",
        "backend": { "command": [binary.to_string_lossy(), "dev", "--port", options.port.to_string(), "--no-watch"],
            "cwd": cwd, "store": project.join(".snapback4/store.sqlite"), "origin": format!("http://127.0.0.1:{}", options.port), "port": options.port },
        "container": container, "run": run, "reservation": options.artifacts.join(format!("{}-ios-reserved", artifact_segment(&options))),
        "outputs": OUTPUTS.iter().map(|suffix| options.artifacts.join(format!("{}-ios-{suffix}", artifact_segment(&options)))).collect::<Vec<_>>() });
    Ok(Run { options, udid, container, run, dir, backend: None, video: None, logs: None, app_pid: None, app_started: 0, manifest, events: Vec::new(), observed: Vec::new(), _lease: vec![selection_lease, lease], _project_lease: project_lease, proof, reservation: Some(_port) })
}

pub fn run(args: &[String]) -> i32 {
    if args.first().is_some_and(|arg| arg == "status") { return background::status(&args[1..]); }
    if args.first().is_some_and(|arg| arg == "export-skipped") { return background::skipped(&args[1..]); }
    if args.first().is_some_and(|arg| arg == "background-worker") { return background::worker(&args[1..]); }
    if args.first().is_some_and(|arg| arg == "background-run") { return background::driver(&args[1..]); }
    if args.first().is_some_and(|arg| arg == "export-publish") { return publication::command(&args[1..]); }
    if args.first().is_some_and(|arg| arg == "export-lease") { return publication::lease_command(&args[1..]); }
    if args.first().is_some_and(|arg| arg == "export-retain") { return recovery::command(&args[1..]); }
    if args.first().is_some_and(|arg| arg == "export-retain-worker") { return retention::worker(&args[1..]); }
    if args.first().is_some_and(|arg| arg == "export-maintain-scan") { return retention::scan(&args[1..]); }
    if args.first().is_some_and(|arg| arg == "export-maintenance") { return retention::backstop(&args[1..]); }
    if args.first().is_some_and(|arg| arg == "export-maintain") { return retention::maintain(&args[1..]); }
    if args.first().is_some_and(|arg| arg == "export-cleanup") { return recovery::command(&args[1..]); }
    if args.first().is_some_and(|arg| arg == "web") { return web::run(&args[1..]); }
    if args.first().is_some_and(|arg| arg == "acquire") { return acquire::run(&args[1..]); }
    let execute = || -> Result<()> {
        let invoked = now();
        let mut options = Options::parse(args)?;
        fs::create_dir_all(&options.artifacts).map_err(|e| error("E_WITNESS_ARTIFACT", format!("cannot create --artifacts directory: {e}")))?;
        options.artifacts = fs::canonicalize(&options.artifacts).map_err(|e| error("E_WITNESS_ARTIFACT", format!("cannot resolve --artifacts directory: {e}")))?;
        #[cfg(unix)]
        unsafe { libc::signal(libc::SIGINT, interrupt as *const () as libc::sighandler_t); libc::signal(libc::SIGTERM, interrupt as *const () as libc::sighandler_t); }
        platform(std::env::consts::OS)?;
        reserve_artifacts(&options.artifacts, &artifact_segment(&options))?;
        let failure_path = options.artifacts.join(format!("{}-ios-run.json", artifact_segment(&options)));
        let xcode = command_text("xcodebuild", &["-version"], Duration::from_secs(10)).ok();
        let sdk = command_text("xcrun", &["--sdk", "iphonesimulator", "--show-sdk-version"], Duration::from_secs(10)).ok();
        let mut preparation = json!({ "xcodeBuild": xcode.as_deref().and_then(|s| s.lines().find_map(|l| l.strip_prefix("Build version "))),
            "iosSdkVersion": sdk, "toolchainSource": "selected host; no installed product inspected",
            "bundleId": options.bundle, "segment": options.segment,
            "phase": "preparation", "startedAt": now(), "timestampUnit": "unix-ms",
            "cliVersion": env!("CARGO_PKG_VERSION"), "exitStatus": 1,
            "events": [], "artifacts": {} });
        let _run_lease = recovery::begin(&options)?;
        let _temporary = preparation::ExportTemporary::new(&options);
        let mut run = match prepare(options, &mut preparation) {
            Ok(run) => run,
            Err(problem) => {
                preparation["error"] = json!(problem);
                preparation["finishedAt"] = json!(now());
                fs::write(&failure_path, serde_json::to_vec_pretty(&preparation).unwrap())
                    .map_err(|e| error("E_WITNESS_ARTIFACT", format!("{problem}; could not write failure receipt; check --artifacts permissions: {e}")))?;
                return Err(problem);
            }
        };
        run.manifest["invokedAt"] = json!(invoked);
        let result = run.execute();
        INTERRUPTED.store(false, Ordering::Relaxed);
        // On failure finalize capture before collecting and hashing artifacts.
        let cleanup = run.finish_capture();
        let app = if run.app_pid.is_some() { run.terminate(false) } else { Ok(()) };
        let backend = if run.backend.is_some() { run.stop_backend() } else { Ok(()) };
        let result = result.and(cleanup).and(app).and(backend);
        let saved = run.save(&result);
        result?; saved?;
        let label = match (run.options.smoke, run.manifest["proofKind"].as_str()) {
            (true, Some("application-release" | "application-export")) => "Own Release smoke passed",
            (true, _) => "Installed-app smoke passed (preparation unknown)",
            _ => "Installed-app scenario complete (preparation unknown)",
        };
        if run.options.export.is_none() { println!("witness: {label} — command's own receipt path: {}", run.path("run.json").display()); }
        Ok(())
    };
    match execute() { Ok(()) => 0, Err(problem) => { if problem.starts_with("E_WITNESS_PLATFORM") { eprintln!("{problem}"); } else { eprintln!("{problem}; see snapback4 guide witness"); } 1 } }
}

#[cfg(test)]
mod lookup_tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn app_lookup_preserves_safe_simctl_diagnostics() {
        const MODE: &str = "SNAPBACK4_TEST_APP_LOOKUP";
        if let Ok(mode) = std::env::var(MODE) {
            // A separate test process owns PATH and the interruption flag.
            if mode.starts_with("interrupted") { INTERRUPTED.store(true, Ordering::Relaxed); }
            let timeout = if mode == "timeout" { Duration::ZERO } else { Duration::from_secs(30) };
            let result = installed_app("private-udid-value", "private-bundle-value", timeout);
            if mode == "success" {
                assert_eq!(result.unwrap(), "/fixture/app");
                return;
            }
            let problem = result.unwrap_err();
            let expected = match mode.as_str() {
                "timeout" => "E_WITNESS_TIMEOUT: xcrun simctl timed out; check --udid and --timeout",
                "interrupted" | "interrupted-spawn" => "E_WITNESS_INTERRUPTED: witness interrupted; stopping its owned processes",
                "unavailable" | "missing" => "E_WITNESS_SIMULATOR: xcrun simctl get_app_container failed; check --udid, --bundle-id and the simulator/runtime",
                "spawn" => "E_WITNESS_PLATFORM:",
                _ => panic!("unknown fixture mode"),
            };
            assert!(problem.starts_with(expected), "{mode}: {problem}");
            for private in ["private-udid-value", "private-bundle-value", "private-tool-output"] {
                assert!(!problem.contains(private), "argument or tool output leaked");
            }
            assert!(!problem.contains("is not installed"), "lookup failure must not invent a cause");
            return;
        }
        let dir = std::env::temp_dir().join(format!("sb4-app-lookup-{}-{}", std::process::id(), now()));
        fs::create_dir(&dir).unwrap();
        let tool = dir.join("xcrun");
        fs::write(&tool, r#"#!/bin/sh
case "$SNAPBACK4_TEST_APP_LOOKUP" in
  success) printf '/fixture/app\n' ;;
  timeout|interrupted) printf 'private-tool-output\n' >&2; exec /bin/sleep 30 ;;
  missing) printf 'No such app: private-tool-output %s\n' "$*" >&2; exit 1 ;;
  *) printf 'Simulator unavailable: private-tool-output %s\n' "$*"; exit 1 ;;
esac
"#).unwrap();
        fs::set_permissions(&tool, fs::Permissions::from_mode(0o755)).unwrap();
        let mut failures = Vec::new();
        for mode in ["success", "timeout", "interrupted", "interrupted-spawn", "unavailable", "missing", "spawn"] {
            let output = Command::new(std::env::current_exe().unwrap())
                .args(["--exact", "verbs::witness::lookup_tests::app_lookup_preserves_safe_simctl_diagnostics", "--nocapture"])
                .env(MODE, mode).env("PATH", if mode.ends_with("spawn") { dir.join("absent") } else { dir.clone() })
                .output().unwrap();
            if !output.status.success() {
                failures.push(format!("{mode}: {}{}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr)));
            }
        }
        fs::remove_dir_all(dir).unwrap();
        assert!(failures.is_empty(), "{}", failures.join("\n"));
    }
}

#[cfg(test)]
mod naming_tests {
    use super::*;
    fn options(args: &[&str]) -> Options {
        Options::parse(&args.iter().map(|s| (*s).to_string()).collect::<Vec<_>>()).unwrap()
    }
    #[test]
    fn installed_runs_cannot_emit_reserved_native_names() {
        for segment in ["m6", "m8"] {
            let o = options(&["ios", "--bundle-id", "app.test", "--segment", segment, "--artifacts", "unused"]);
            assert_eq!(o.segment, segment, "application protocol stays unchanged");
            assert_eq!(artifact_segment(&o), format!("installed-{segment}"));
        }
        let o = options(&["ios", "--build", ".", "--smoke", "--artifacts", "unused"]);
        assert_eq!(artifact_segment(&o), "smoke");
    }
    #[test]
    fn prepared_scenario_scope_is_explicit() {
        let args = ["ios", "--build", ".", "--segment", "m6", "--artifacts", "unused"].map(String::from);
        assert!(Options::parse(&args).err().unwrap().contains("requires --smoke"));
    }
}
