//! Installed-app witness driver. It owns its backend and capture children;
//! simulator operations always name a resolved UDID, never `booted`.
mod protocol;
use protocol::*;
use serde_json::{Value, json};
use std::{collections::BTreeMap, fs::{self, File, OpenOptions}, io::{Read, Write}, path::{Path, PathBuf}, process::{Child, Command, ExitStatus, Stdio}, sync::atomic::{AtomicBool, Ordering}, thread::sleep, time::{Duration, Instant}};

static INTERRUPTED: AtomicBool = AtomicBool::new(false);
extern "C" fn interrupt(_: libc::c_int) { INTERRUPTED.store(true, Ordering::Relaxed); }
fn tick() -> Result<()> {
    if INTERRUPTED.load(Ordering::Relaxed) { return Err(error("E_WITNESS_INTERRUPTED", "witness interrupted; stopping its owned processes")); }
    sleep(Duration::from_millis(100)); Ok(())
}

struct Options {
    bundle: String, udid: Option<String>, segment: String, artifacts: PathBuf,
    port: u16, timeout: Duration, prime: bool, relaunch: bool,
}
impl Options {
    fn parse(args: &[String]) -> Result<Self> {
        if args.first().map(String::as_str) != Some("ios") { return Err(error("E_WITNESS_INPUT", "use snapback4 witness ios --bundle-id <id> --segment <name> --artifacts <dir> [--udid <id>] [--port 4400] [--prime] [--relaunch] [--timeout 120]")); }
        let mut flags = BTreeMap::new();
        let mut iter = args.iter().skip(1);
        while let Some(flag) = iter.next() {
            let Some(key) = flag.strip_prefix("--") else { return Err(error("E_WITNESS_INPUT", format!("unexpected argument {flag}"))); };
            if !["bundle-id", "udid", "segment", "artifacts", "port", "timeout", "prime", "relaunch"].contains(&key) { return Err(error("E_WITNESS_INPUT", format!("unknown flag --{key}"))); }
            let value = if ["prime", "relaunch"].contains(&key) { String::new() } else {
                iter.next().filter(|s| !s.starts_with("--")).cloned().ok_or_else(|| error("E_WITNESS_INPUT", format!("--{key} requires a value")))?
            };
            if flags.insert(key, value).is_some() { return Err(error("E_WITNESS_INPUT", format!("duplicate --{key}"))); }
        }
        let required = |key| flags.get(key).filter(|s| !s.is_empty()).cloned().ok_or_else(|| error("E_WITNESS_INPUT", format!("--{key} is required; see snapback4 guide witness")));
        let bundle = required("bundle-id")?;
        if !bundle.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-') { return Err(error("E_WITNESS_INPUT", "invalid bundle identifier")); }
        let segment = required("segment")?;
        if !name(&segment) || segment == "prime" { return Err(error("E_WITNESS_INPUT", "--segment uses letters, digits, hyphens or underscores; prime is reserved")); }
        let artifacts = PathBuf::from(required("artifacts")?);
        let port = flags.get("port").map_or(Ok(4400), |s| s.parse::<u16>()).ok().filter(|p| *p > 0).ok_or_else(|| error("E_WITNESS_INPUT", "--port must be 1..65535"))?;
        let seconds = flags.get("timeout").map_or(Ok(120), |s| s.parse::<u64>()).ok().filter(|s| *s > 0 && *s <= 86400).ok_or_else(|| error("E_WITNESS_INPUT", "--timeout must be 1..86400 seconds per step"))?;
        Ok(Self { bundle, udid: flags.get("udid").cloned(), segment, artifacts, port, timeout: Duration::from_secs(seconds), prime: flags.contains_key("prime"), relaunch: flags.contains_key("relaunch") })
    }
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
    let mut child = Owned::spawn(&mut command)?;
    let stdout = child.0.stdout.take().unwrap(); let stderr = child.0.stderr.take().unwrap();
    let read = |mut pipe: Box<dyn Read + Send>| std::thread::spawn(move || { let mut text = String::new(); let _ = pipe.read_to_string(&mut text); text });
    let out = read(Box::new(stdout)); let err = read(Box::new(stderr));
    let end = Instant::now() + timeout;
    let status = loop {
        if let Some(status) = child.status()? { break status; }
        if Instant::now() >= end { return Err(error("E_WITNESS_TIMEOUT", format!("xcrun simctl {} timed out", args.join(" ")))); }
        tick()?;
    };
    let text = out.join().unwrap_or_default(); let problem = err.join().unwrap_or_default();
    if !status.success() { return Err(error("E_WITNESS_SIMULATOR", format!("xcrun simctl {}: {}", args.join(" "), problem.trim()))); }
    Ok(text.trim().to_owned())
}

fn output(path: &Path) -> Result<File> { OpenOptions::new().create(true).append(true).open(path).map_err(|e| error("E_WITNESS_ARTIFACT", format!("{}: {e}", path.display()))) }
fn read_rows(path: &Path, final_file: bool) -> Result<Vec<Value>> {
    match fs::read(path) {
        Ok(bytes) => receipts(&bytes, final_file),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound && !final_file => Ok(Vec::new()),
        Err(e) => Err(error("E_WITNESS_RECEIPT", e)),
    }
}

struct Run {
    options: Options, udid: String, container: PathBuf, run: String, dir: PathBuf,
    backend: Option<Owned>, video: Option<Owned>, logs: Option<Owned>, app_pid: Option<u32>,
    manifest: Value, events: Vec<Value>, observed: Vec<Value>,
}
impl Run {
    fn event(&mut self, step: &str) { self.events.push(json!({ "step": step, "at": now() })); eprintln!("witness: {step}"); }
    fn receipts(&self) -> PathBuf { self.dir.join("receipts.jsonl") }
    fn path(&self, suffix: &str) -> PathBuf { self.options.artifacts.join(format!("{}-ios-{suffix}", self.options.segment)) }
    fn running_app(&self) -> Result<Option<u32>> {
        app_pid(&simctl(&["spawn", &self.udid, "launchctl", "list"], self.options.timeout)?, &self.options.bundle)
    }
    fn require_stopped(&self) -> Result<()> {
        if self.running_app()?.is_some() { return Err(error("E_WITNESS_APP", format!("{} is already running on {}; quit it before starting the witness", self.options.bundle, self.udid))); }
        Ok(())
    }
    // @ref LLP 3000.007#20.10 — the launch PID owns cleanup, never the bundle alone
    fn terminate(&mut self) -> Result<()> {
        let Some(pid) = self.app_pid else { return Ok(()); };
        match self.running_app()? {
            None => { self.app_pid = None; return Ok(()); }
            Some(current) if current != pid => {
                self.app_pid = None;
                return Err(error("E_WITNESS_APP", format!("{} on {} was replaced by PID {current}; leaving that instance running", self.options.bundle, self.udid)));
            }
            Some(_) => {}
        }
        simctl(&["spawn", &self.udid, "kill", "-TERM", &pid.to_string()], self.options.timeout)?;
        let end = Instant::now() + self.options.timeout;
        while self.running_app()? == Some(pid) {
            if Instant::now() >= end { return Err(error("E_WITNESS_TIMEOUT", format!("app PID {pid} did not stop"))); }
            tick()?;
        }
        self.app_pid = None;
        self.events.push(json!({ "step": "app-terminated", "pid": pid, "at": now() })); Ok(())
    }
    fn launch(&mut self, prime: bool) -> Result<()> {
        self.require_stopped()?;
        let segment = if prime { "prime" } else { &self.options.segment };
        let config = json!({ "run": self.run, "segment": segment, "timeoutMs": self.options.timeout.as_millis() });
        let mut command = Command::new("xcrun");
        command.args(["simctl", "launch", &self.udid, &self.options.bundle])
            .env("SIMCTL_CHILD_SNAPBACK4_WITNESS", config.to_string())
            .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(output(&self.path("launch.log"))?);
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
        output(&self.path("launch.log"))?.write_all(text.as_bytes()).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
        let status = status?;
        if !status.success() { return Err(error("E_WITNESS_APP", format!("app launch failed ({status}); see {}", self.path("launch.log").display()))); }
        let pid = self.app_pid.ok_or_else(|| error("E_WITNESS_APP", "simctl launch did not report an app PID; cannot claim ownership"))?;
        self.events.push(json!({ "step": if prime { "prime-launched" } else { "offline-launched" }, "pid": pid, "at": now() })); Ok(())
    }
    fn start_backend(&mut self) -> Result<()> {
        let reservation = reserve(self.options.port)?;
        let binary = std::env::current_exe().map_err(|e| error("E_WITNESS_BACKEND", e))?;
        let stdout = self.path("backend-stdout.log");
        let offset = fs::metadata(&stdout).map_or(0, |m| m.len()) as usize;
        let mut command = Command::new(binary);
        command.args(["dev", "--port", &self.options.port.to_string(), "--no-watch"])
            .stdin(Stdio::null()).stdout(output(&stdout)?).stderr(output(&self.path("backend.log"))?);
        drop(reservation);
        self.backend = Some(Owned::spawn(&mut command)?);
        let end = Instant::now() + self.options.timeout;
        loop {
            let child = self.backend.as_mut().unwrap();
            if let Some(status) = child.status()? { return Err(error("E_WITNESS_BACKEND", format!("dev exited ({status}); see {}", self.path("backend.log").display()))); }
            // Only our child's readiness announcement can satisfy startup.
            if fs::read_to_string(&stdout).unwrap_or_default().get(offset..).unwrap_or_default().lines().any(|line| line == format!("http://127.0.0.1:{}", self.options.port)) && !refused(self.options.port)? { break; }
            if Instant::now() >= end { return Err(error("E_WITNESS_BACKEND", "dev did not become ready before the step timeout")); }
            tick()?;
        }
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
            if reached { self.event(expected); return Ok(()); }
            if Instant::now() >= end { return Err(error("E_WITNESS_TIMEOUT", format!("app did not reach {expected} within {} seconds", self.options.timeout.as_secs()))); }
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
        let mut logs = Command::new("xcrun");
        // Only the app's own process: a whole-simulator debug stream is tens of megabytes per segment.
        let executable = self.manifest["appBuild"]["CFBundleExecutable"].as_str().unwrap_or_default().replace('"', "");
        logs.args(["simctl", "spawn", &self.udid, "log", "stream", "--style", "json", "--level", "debug", "--predicate"]).arg(format!("process == \"{executable}\""))
            .stdin(Stdio::null()).stdout(output(&self.path("device.log"))?).stderr(output(&self.path("log-stderr.log"))?);
        self.logs = Some(Owned::spawn(&mut logs)?);
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
        self.require_stopped()?;
        self.start_backend()?;
        if self.options.prime { self.launch(true)?; self.wait_step("primed", false)?; self.terminate()?; }
        self.stop_backend()?;
        self.capture()?;
        self.launch(false)?;
        if self.options.relaunch {
            self.wait_step("relaunch", true)?; self.terminate()?;
            self.launch(false)?; self.event("offline-relaunched");
        }
        self.wait_step("offline-done", true)?;
        self.start_backend()?;
        fs::write(self.dir.join("reconnect"), b"ready\n").map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
        self.event("reconnect-signaled");
        self.wait_step("done", false)?;
        self.finish_capture()?;
        self.terminate()?;
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
        if let Err(e) = read_rows(&self.path("receipts.jsonl"), true).and_then(|rows| {
            if !rows.starts_with(&self.observed) { return Err(error("E_WITNESS_RECEIPT", "previously observed receipts changed during the run")); }
            sequence(&rows, &self.expected(), true)
        }) { if problem.is_none() { problem = Some(e); } }
        if result.is_ok() && let Some(e) = &problem { self.manifest["exitStatus"] = json!(1); self.manifest["error"] = json!(e); }
        fs::write(self.path("run.json"), serde_json::to_vec_pretty(&self.manifest).unwrap()).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
        if let Some(e) = problem { return Err(e); } Ok(())
    }
}
impl Drop for Run {
    fn drop(&mut self) {
        let _ = self.finish_capture();
        if self.app_pid.is_some() { let _ = self.terminate(); }
        if let Some(mut backend) = self.backend.take() { let _ = backend.stop(libc::SIGTERM); }
    }
}

// @ref LLP 3000.007#20.10 — explicit simulator, owned backend and bound artifacts
fn prepare(options: Options) -> Result<Run> {
    platform(std::env::consts::OS)?;
    let list: Value = serde_json::from_str(&simctl(&["list", "devices", "booted", "--json"], options.timeout)?).map_err(|e| error("E_WITNESS_SIMULATOR", e))?;
    let (udid, runtime) = device(&list, options.udid.as_deref())?;
    let app = simctl(&["get_app_container", &udid, &options.bundle, "app"], options.timeout).map_err(|e| error("E_WITNESS_APP", format!("{} is not installed on {udid}: {e}\nBuild and install from your Expo project: npx expo run:ios --configuration Release --device {udid}", options.bundle)))?;
    let container = PathBuf::from(simctl(&["get_app_container", &udid, &options.bundle, "data"], options.timeout)?);
    let plist = Path::new(&app).join("Info.plist");
    let mut build = json!({});
    for key in ["CFBundleIdentifier", "CFBundleVersion", "CFBundleShortVersionString", "CFBundleExecutable"] {
        let output = Command::new("/usr/bin/plutil").args(["-extract", key, "raw", "-o", "-"]).arg(&plist).output().map_err(|e| error("E_WITNESS_APP", e))?;
        if !output.status.success() { return Err(error("E_WITNESS_APP", format!("cannot read {key} from {}", plist.display()))); }
        build[key] = json!(String::from_utf8_lossy(&output.stdout).trim());
    }
    if build["CFBundleIdentifier"] != options.bundle { return Err(error("E_WITNESS_APP", "installed Info.plist bundle identifier does not match --bundle-id")); }
    let _reservation = reserve(options.port)?;
    if app_pid(&simctl(&["spawn", &udid, "launchctl", "list"], options.timeout)?, &options.bundle)?.is_some() {
        return Err(error("E_WITNESS_APP", format!("{} is already running on {udid}; quit it before starting the witness", options.bundle)));
    }
    reserve_artifacts(&options.artifacts, &options.segment)?;
    let run = format!("{}-{}", now(), std::process::id());
    let dir = container.join("Documents/.snapback4-witness").join(&run);
    fs::create_dir_all(&dir).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
    let binary = std::env::current_exe().map_err(|e| error("E_WITNESS_BACKEND", e))?;
    let cwd = std::env::current_dir().map_err(|e| error("E_WITNESS_BACKEND", e))?;
    let project = cwd.ancestors().find(|p| p.join("snapback/schema.q").is_file()).ok_or_else(|| error("E_WITNESS_BACKEND", "no snapback/schema.q here or above; run the witness from your backend project"))?;
    let manifest = json!({ "bundleId": options.bundle, "udid": udid, "runtime": runtime, "appBuild": build, "appPath": app,
        "segment": options.segment, "prime": options.prime, "relaunch": options.relaunch, "startedAt": now(), "timestampUnit": "unix-ms",
        "backend": { "command": [binary.to_string_lossy(), "dev", "--port", options.port.to_string(), "--no-watch"],
            "cwd": cwd, "store": project.join(".snapback4/store.sqlite"), "origin": format!("http://127.0.0.1:{}", options.port), "port": options.port },
        "container": container, "run": run, "reservation": options.artifacts.join(format!("{}-ios-reserved", options.segment)),
        "outputs": OUTPUTS.iter().map(|suffix| options.artifacts.join(format!("{}-ios-{suffix}", options.segment))).collect::<Vec<_>>() });
    Ok(Run { options, udid, container, run, dir, backend: None, video: None, logs: None, app_pid: None, manifest, events: Vec::new(), observed: Vec::new() })
}

pub fn run(args: &[String]) -> i32 {
    let execute = || -> Result<()> {
        let options = Options::parse(args)?;
        #[cfg(unix)]
        unsafe { libc::signal(libc::SIGINT, interrupt as *const () as libc::sighandler_t); libc::signal(libc::SIGTERM, interrupt as *const () as libc::sighandler_t); }
        let mut run = prepare(options)?;
        let result = run.execute();
        INTERRUPTED.store(false, Ordering::Relaxed);
        // On failure finalize capture before collecting and hashing artifacts.
        let cleanup = run.finish_capture();
        let app = if run.app_pid.is_some() { run.terminate() } else { Ok(()) };
        let backend = if run.backend.is_some() { run.stop_backend() } else { Ok(()) };
        let result = result.and(cleanup).and(app).and(backend);
        let saved = run.save(&result);
        result?; saved?;
        println!("witness: complete — {}", run.path("run.json").display());
        Ok(())
    };
    match execute() { Ok(()) => 0, Err(problem) => { eprintln!("{problem}\nsee snapback4 guide witness"); 1 } }
}
