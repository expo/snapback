//! @ref LLP 3000.030#5 — one simulator owner across preparation and execution.
use super::*;
use std::os::unix::process::CommandExt;

// Drops after bounded child/app/backend cleanup on every export outcome.
pub(super) struct ExportTemporary(Option<PathBuf>);
impl ExportTemporary {
    pub(super) fn new(options: &Options) -> Self { Self(options.export.as_ref().map(|_| options.artifacts.clone())) }
}
impl Drop for ExportTemporary {
    fn drop(&mut self) {
        if let Some(root) = &self.0 {
            for name in ["preparation-tmp", "base.app", "export.app", "build.xcresult"] {
                if let Err(e) = fs::remove_dir_all(root.join(name)) {
                    if e.kind() != std::io::ErrorKind::NotFound { eprintln!("witness: could not remove temporary {}: {e}", root.join(name).display()); }
                }
            }
        }
    }
}

pub(super) fn lease(path: &Path) -> Result<File> {
    if let Some(parent) = path.parent() { fs::create_dir_all(parent).map_err(|e| error("E_WITNESS_ARTIFACT", e))?; }
    // Rust opens this descriptor close-on-exec. A concurrent fork can still
    // retain it until exec/exit, so last-owner drop need not release immediately.
    // Production children proceed directly to exec (no waiting pre_exec hook);
    // a contender in that window conservatively refuses/defer-cleans, never
    // takes custody. Retry after child exec/exit is safe. The wrapper's explicit
    // fd-3 export lease is separately and intentionally inherited.
    let file = OpenOptions::new().create(true).truncate(false).read(true).write(true).open(path).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
    file.try_lock().map_err(|_| error("E_WITNESS_PROCESS", "another witness holds the project or --udid lease; leaving it untouched"))?;
    Ok(file)
}

// @ref LLP 3000.030#15 — resolution has the same native custody as preparation.
pub(super) fn node_runtime(options: &Options, node: &std::ffi::OsStr) -> Result<PathBuf> {
    // Respect a shorter per-step timeout; first-use version-manager downloads
    // otherwise get 30 seconds before the builder must provision Node explicitly.
    let budget = options.timeout.min(Duration::from_secs(30));
    let end = Instant::now() + budget;
    let mut resolver = PreparationProcess::launch(options, node,
        &[std::ffi::OsStr::new("-p"), std::ffi::OsStr::new("JSON.stringify(process.execPath)")], "runtime-resolution")?;
    let result = (|| {
        loop {
            interrupted()?;
            if let Some(status) = resolver.status()? {
                if !status.success() { return Err(error("E_WITNESS_PROCESS", format!("cannot resolve Node runtime through launcher {}; run that launcher in this project to install/repair its pinned Node, then retry", node.to_string_lossy()))); }
                let bytes = fs::read(options.artifacts.join("runtime-resolution-stdout.log")).map_err(|e| error("E_WITNESS_PROCESS", e))?;
                let path = serde_json::from_slice::<String>(&bytes).map(PathBuf::from)
                    .map_err(|_| error("E_WITNESS_PROCESS", "node launcher returned an invalid runtime path"))?;
                if !path.is_absolute() { return Err(error("E_WITNESS_PROCESS", "node runtime path must be absolute")); }
                return Ok(path);
            }
            if Instant::now() >= end { return Err(error("E_WITNESS_PROCESS", format!("Node launcher {} exceeded its {}-second runtime-resolution deadline; run that launcher in this project to finish installing/downloading its pinned Node, then retry", node.to_string_lossy(), budget.as_secs()))); }
            tick()?;
        }
    })();
    resolver.cleanup()?;
    result
}

// The native supervisor owns the unreaped anchor. Its owner-exit watcher drains
// the group even if this driver is SIGKILLed before the journal/start handshake.
struct PreparationProcess { child: Child, cleaned: bool, result: PathBuf, group: Value, cleanup_deadline: Option<cleanup::Deadline> }
impl PreparationProcess {
    fn spawn(options: &Options, command: &std::ffi::OsStr, args: &[&std::ffi::OsStr], label: &str) -> Result<Self> {
        Self::spawn_with_node(options, std::ffi::OsStr::new("node"), command, args, label)
    }
    fn spawn_with_node(options: &Options, node: &std::ffi::OsStr, command: &std::ffi::OsStr, args: &[&std::ffi::OsStr], label: &str) -> Result<Self> {
        let runtime = node_runtime(options, node)?;
        let command = if command == "node" { runtime.as_os_str() } else { command };
        Self::launch(options, command, args, label)
    }
    fn launch(options: &Options, command: &std::ffi::OsStr, args: &[&std::ffi::OsStr], label: &str) -> Result<Self> {
        interrupted()?;
        let result = options.artifacts.join(format!("{label}-status.json"));
        let ready = options.artifacts.join(format!("{label}-group.json"));
        for path in [&result, &ready] { let _ = fs::remove_file(path); }
        let parent = std::process::id().to_string();
        let mut argv = vec![std::ffi::OsStr::new("supervisor"), parent.as_ref(), ready.as_os_str(), result.as_os_str(), command];
        argv.extend_from_slice(args);
        let child = process_group::helper(&argv).process_group(0).stdin(Stdio::piped())
            .stdout(File::create(options.artifacts.join(format!("{label}-stdout.log"))).map_err(|e| error("E_WITNESS_ARTIFACT", e))?)
            .stderr(output(&options.artifacts.join(format!("{label}-stderr.log")))?)
            .spawn().map_err(|e| error("E_WITNESS_PROCESS", e))?;
        let mut owned = Self { child, cleaned: false, result, group: Value::Null, cleanup_deadline: None };
        let end = Instant::now() + Duration::from_secs(5);
        loop {
            if let Ok(bytes) = fs::read(&ready) {
                owned.group = serde_json::from_slice(&bytes).map_err(|e| error("E_WITNESS_PROCESS", e))?;
                break;
            }
            if owned.status()?.is_some() || Instant::now() >= end { return Err(error("E_WITNESS_PROCESS", "native preparation supervisor did not establish custody")); }
            tick()?;
        }
        // The resolver/worker is still behind a pipe gate. Durably journal the
        // anchor, guardian and reaping lock before releasing arbitrary code.
        recovery::group_record(options, label, &owned.group)?;
        owned.child.stdin.as_mut().unwrap().write_all(b"s").map_err(|e| error("E_WITNESS_PROCESS", e))?;
        Ok(owned)
    }
    fn status(&self) -> Result<Option<ExitStatus>> {
        use std::os::unix::process::ExitStatusExt;
        if let Ok(bytes) = fs::read(&self.result) {
            let value: Value = serde_json::from_slice(&bytes).map_err(|e| error("E_WITNESS_PROCESS", e))?;
            if let Some(status) = value["status"].as_i64() { return Ok(Some(ExitStatus::from_raw((status as i32) << 8))); }
        }
        let mut info: libc::siginfo_t = unsafe { std::mem::zeroed() };
        if unsafe { libc::waitid(libc::P_PID, self.child.id(), &mut info, libc::WEXITED | libc::WNOHANG | libc::WNOWAIT) } != 0 {
            return Err(error("E_WITNESS_PROCESS", std::io::Error::last_os_error()));
        }
        if unsafe { info.si_pid() } == 0 { return Ok(None); }
        // A supervisor exit without a worker receipt is always a failure.
        Ok(Some(ExitStatus::from_raw(1 << 8)))
    }
    fn live_group(&self) -> Result<bool> {
        Ok(self.group["group"].as_u64().map(|g| recovery::members(g as u32)).transpose()?.is_some_and(|m| !m.is_empty()))
    }
    fn cleanup(&mut self) -> Result<()> {
        if self.cleaned { return Ok(()); }
        // EOF requests cleanup. A kernel owner watcher also covers inherited
        // control pipes and SIGKILL; this pipe is only the normal-path request.
        self.child.stdin.take();
        // Keep the same budget across a failed call and Drop: a real stall
        // must not gain a fresh deadline merely because cleanup was retried.
        self.cleanup_deadline.get_or_insert_with(|| cleanup::Deadline::new(Instant::now()));
        loop {
            if self.child.try_wait().map_err(|e| error("E_WITNESS_PROCESS", e))?.is_some() {
                if self.live_group()? { recovery::stop_group_with(&self.group, || {})?; }
                self.cleaned = true;
                return Ok(());
            }
            let deadline = self.cleanup_deadline.as_mut().unwrap();
            if let Some(group) = self.group["group"].as_u64() {
                deadline.observe(Instant::now(), recovery::members(group as u32)?.len());
            }
            if deadline.expired(Instant::now()) { return Err(error("E_WITNESS_PROCESS", "native preparation watchdog cleanup stopped making progress; recovery required")); }
            sleep(Duration::from_millis(20));
        }
    }
}
impl Drop for PreparationProcess { fn drop(&mut self) { let _ = self.cleanup(); } }

#[cfg(test)]
mod cleanup_tests {
    use super::*;
    fn keeper(label: &str) -> (PathBuf, PreparationProcess) {
        let dir = std::env::temp_dir().join(format!("sb4-wd-{label}-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let args: Vec<String> = ["ios", "--build", ".", "--smoke", "--artifacts", dir.to_str().unwrap()].into_iter().map(String::from).collect();
        let options = Options::parse(&args).unwrap();
        let keeper = PreparationProcess::launch(&options, std::ffi::OsStr::new("sleep"), &[std::ffi::OsStr::new("60")], "preparation").unwrap();
        (dir, keeper)
    }
    struct Resume(u32);
    impl Drop for Resume { fn drop(&mut self) { unsafe { libc::kill(self.0 as i32, libc::SIGCONT); } } }

    #[test]
    fn shrinking_group_extends_cleanup_until_supervisor_exits() {
        let (dir, mut keeper) = keeper("progress");
        // Pause our still-unreaped supervisor; live members leave in stages.
        // Use the actual product's 5 s idle/60 s hard caps, including under load.
        let step = Duration::from_secs(2);
        let idle = Duration::from_secs(5);
        unsafe { libc::kill(keeper.child.id() as i32, libc::SIGSTOP); }
        let resume = Resume(keeper.child.id());
        let group = keeper.group["group"].as_u64().unwrap() as i32;
        let mut departing: Vec<_> = (0..3).map(|_| Owned::spawn(Command::new("sleep").arg("60").process_group(group)).unwrap()).collect();
        keeper.cleanup_deadline = Some(cleanup::Deadline::with_limits(Instant::now(), idle, Duration::from_secs(60)));
        let start = Instant::now();
        let result = std::thread::scope(|scope| {
            scope.spawn(move || {
                for child in &mut departing {
                    sleep(step);
                    child.0.kill().unwrap(); child.0.wait().unwrap();
                }
                sleep(step);
                drop(resume);
            });
            keeper.cleanup()
        });
        result.unwrap();
        assert!(start.elapsed() > idle, "cleanup must survive its original idle deadline");
        assert!(!keeper.live_group().unwrap());
        eprintln!("WD shrinking cleanup completed in {:?} (idle {:?})", start.elapsed(), idle);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn stopped_supervisor_without_exits_requires_recovery_and_keeps_its_deadline() {
        let (dir, mut keeper) = keeper("stalled");
        unsafe { libc::kill(keeper.child.id() as i32, libc::SIGSTOP); }
        let resume = Resume(keeper.child.id());
        keeper.cleanup_deadline = Some(cleanup::Deadline::with_limits(Instant::now(), Duration::from_millis(200), Duration::from_secs(2)));
        let start = Instant::now();
        let first = keeper.cleanup().unwrap_err();
        assert!(first.contains("recovery required"), "{first}");
        assert!(start.elapsed() >= Duration::from_millis(200));
        assert!(start.elapsed() < Duration::from_secs(2), "a stopped supervisor must refuse at the idle deadline");
        let deadline = keeper.cleanup_deadline.as_ref().unwrap();
        assert!(deadline.expired(Instant::now()));
        assert!(keeper.cleanup().unwrap_err().contains("recovery required"));
        drop(resume);
        // Reap only our supervisor after allowing its real watchdog to finish.
        assert!(keeper.child.wait().unwrap().success());
        keeper.cleanup().unwrap();
        assert!(!keeper.live_group().unwrap());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn direct_enumeration_resizes_and_keeps_births_in_the_selected_group() {
        let (dir, mut keeper) = keeper("members");
        let group = keeper.group["group"].as_u64().unwrap() as u32;
        // More than the initial Darwin PID buffer; no host-wide scan needed.
        let mut children: Vec<_> = (0..40).map(|_| Owned::spawn(Command::new("sleep").arg("60").process_group(group as i32)).unwrap()).collect();
        let mut outside = Owned::spawn(Command::new("sleep").arg("60").process_group(0)).unwrap();
        let members = recovery::members(group).unwrap();
        for child in &children { assert!(members.contains(&recovery::identity(child.0.id()).unwrap())); }
        assert!(!members.contains(&recovery::identity(outside.0.id()).unwrap()));
        assert!(recovery::members(0).is_err());
        assert!(recovery::members(u32::MAX).is_err());
        keeper.cleanup().unwrap();
        for child in &mut children { child.0.wait().unwrap(); }
        assert!(outside.status().unwrap().is_none());
        outside.0.kill().unwrap(); outside.0.wait().unwrap();
        assert!(recovery::members(group).unwrap().is_empty());
        fs::remove_dir_all(dir).unwrap();
    }
}

fn node(options: &Options, args: &[&str], label: &str) -> Result<()> {
    let args: Vec<_> = args.iter().map(std::ffi::OsStr::new).collect();
    let mut child = PreparationProcess::spawn(options, std::ffi::OsStr::new("node"), &args, label)?;
    let end = Instant::now() + Duration::from_secs(900);
    let mut announced = false;
    let result = loop {
        let notice = options.artifacts.join("cache-miss.json");
        if !announced && label == "preparation" && notice.is_file() {
            let reason = fs::read(&notice).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()).unwrap_or(Value::Null);
            eprintln!("native-cache miss: {}; a Release build takes about three to four minutes. Opt out with SNAPBACK4_NATIVE_SMOKE=off.", reason["reason"].as_str().unwrap_or("native inputs changed"));
            announced = true;
        }
        if let Err(e) = interrupted() { break Err(e); }
        if let Some(status) = child.status()? { break if status.success() { Ok(()) } else {
            let detail = fs::read_to_string(options.artifacts.join(format!("{label}-stderr.log"))).unwrap_or_default();
            // Helper/tool prose stays in its separate raw log, never in a refusal.
            let (code, reason) = if detail.contains("E_WITNESS_NATIVE_COMPAT:") { ("E_WITNESS_NATIVE_COMPAT", "--build has unsupported native inputs") }
                else if detail.contains("E_WITNESS_HERMES:") { ("E_WITNESS_HERMES", "--build Hermes bytecode or compiler differs") }
                else if detail.contains("E_WITNESS_PROOF:") { ("E_WITNESS_PROOF", "--build inputs or prepared app changed") }
                else { ("E_WITNESS_BUILD", "--build preparation failed") };
            Err(error(code, format!("{reason}; see the command's own raw log path: {}", options.artifacts.join(format!("{label}-stderr.log")).display())))
        }; }
        if Instant::now() >= end { break Err(error("E_WITNESS_BUILD", "preparation exceeded its 900-second deadline")); }
        if let Err(e) = tick() { break Err(e); }
    };
    // Also clean descendants after success. The caller still holds its lease.
    let cleanup = child.cleanup();
    if let Err(problem) = cleanup { return Err(problem); }
    result
}

pub(super) fn check_project(options: &Options) -> Result<Vec<File>> {
    let Some(project) = options.build.as_ref() else { return Ok(Vec::new()); };
    let project = fs::canonicalize(project).map_err(|e| error("E_WITNESS_BUILD", format!("cannot resolve --build project: {e}")))?;
    let backend = crate::project::Project::locate(&std::env::current_dir().map_err(|e| error("E_WITNESS_BUILD", e))?)
        .ok_or_else(|| error("E_WITNESS_BUILD", "no snapback/schema.q here or above; run snapback4 init before native smoke"))?;
    let mut roots = vec![project, fs::canonicalize(backend.root).map_err(|e| error("E_WITNESS_BUILD", e))?];
    roots.sort(); roots.dedup();
    let leases = roots.iter().map(|p| lease(&p.join(".snapback4-witness/owner.lock"))).collect::<Result<Vec<_>>>()?;
    let binary = std::env::current_exe().map_err(|e| error("E_WITNESS_BUILD", e))?;
    let mut child = PreparationProcess::spawn(options, binary.as_os_str(), &[std::ffi::OsStr::new("check")], "check")?;
    let end = Instant::now() + Duration::from_secs(900);
    loop {
        if let Some(status) = child.status()? {
            if !status.success() {
                return Err(error("E_WITNESS_BUILD", format!("backend check failed; see the command's own raw log path: {}", options.artifacts.join("check-stderr.log").display())));
            }
            break;
        }
        if Instant::now() >= end { return Err(error("E_WITNESS_BUILD", "backend check exceeded 900 seconds")); }
        tick()?;
    }
    child.cleanup()?;
    Ok(leases)
}

pub(super) fn prepare_app(options: &mut Options, udid: &str) -> Result<Option<Value>> {
    let Some(project) = options.build.as_ref() else { return Ok(None); };
    let project = fs::canonicalize(project).map_err(|e| error("E_WITNESS_BUILD", format!("cannot resolve --build project: {e}")))?;
    let helper = options.artifacts.join("prepare.mjs");
    fs::write(&helper, include_str!("prepare.mjs")).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
    fs::write(options.artifacts.join("payload.mjs"), include_str!("payload.mjs")).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
    fs::write(options.artifacts.join("native-inputs.mjs"), include_str!("native-inputs.mjs")).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
    for (name, contents) in [("native-closure.mjs", include_str!("native-closure.mjs")), ("native-scripts.mjs", include_str!("native-scripts.mjs")), ("export-cache.mjs", include_str!("export-cache.mjs")), ("effective-config.mjs", include_str!("effective-config.mjs")), ("native-mods.json", include_str!("native-mods.json"))] {
        fs::write(options.artifacts.join(name), contents).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
    }
    let origin = format!("http://127.0.0.1:{}", options.port);
    let exported = options.export.as_ref().map(|p| fs::canonicalize(p).map_err(|e| error("E_WITNESS_BUILD", e))).transpose()?;
    node(options, &[helper.to_str().unwrap(), "build", project.to_str().unwrap(), options.artifacts.to_str().unwrap(), udid, &origin,
        exported.as_ref().map_or("", |p| p.to_str().unwrap())], "preparation")?;
    let receipt = options.artifacts.join("build.json");
    let prepared: Value = serde_json::from_slice(&fs::read(&receipt).map_err(|e| error("E_WITNESS_PROOF", e))?).map_err(|e| error("E_WITNESS_PROOF", e))?;
    options.bundle = prepared["executedApp"]["info"]["CFBundleIdentifier"].as_str().ok_or_else(|| error("E_WITNESS_BUILD", "prepared app has no bundle identifier"))?.to_owned();
    if app_pid(&simctl(&["spawn", udid, "launchctl", "list"], options.timeout)?, &options.bundle)?.is_some() {
        return Err(error("E_WITNESS_APP", "app is running; refusing replacement"));
    }
    let app = prepared["executedApp"]["path"].as_str().ok_or_else(|| error("E_WITNESS_PROOF", "missing prepared app path"))?;
    verify(options, app, &prepared["executedApp"]["inventory"]["sha256"], "before-install")?;
    let install_started = now();
    simctl(&["install", udid, app], options.timeout)?;
    let installed_path = simctl(&["get_app_container", udid, &options.bundle, "app"], options.timeout)?;
    let check = options.artifacts.join("install-check.mjs");
    fs::write(&check, "import {inventory,installedInventory,readJSON,seal} from './payload.mjs'; const p=readJSON(process.argv[2]); seal(process.argv[4],installedInventory(p.executedApp.inventory,inventory(process.argv[3]),p.executedApp.native));").map_err(|e| error("E_WITNESS_PROOF", e))?;
    let installed_receipt = options.artifacts.join("installed.json");
    node(options, &[check.to_str().unwrap(), receipt.to_str().unwrap(), &installed_path, installed_receipt.to_str().unwrap()], "verify-install")?;
    let installed: Value = serde_json::from_slice(&fs::read(&installed_receipt).map_err(|e| error("E_WITNESS_PROOF", e))?).map_err(|e| error("E_WITNESS_PROOF", e))?;
    let mut proof = json!({ "format": 1, "proofKind": prepared["proofKind"], "nativeBase": prepared["nativeBase"],
        "installedApp": installed, "installedBundlePath": fs::canonicalize(Path::new(&installed_path).join("main.jsbundle")).map_err(|e| error("E_WITNESS_PROOF", e))?,
        "executedApp": prepared["executedApp"], "javascript": prepared["executedApp"]["javascript"], "compiler": prepared["compiler"],
        "nativeFingerprint": prepared["nativeFingerprint"], "exported": prepared["exported"], "cacheHit": prepared["cacheHit"], "preparation": artifact(&receipt)?, "runtime": { "udid": udid, "toolchain": prepared["toolchain"] },
        "scope": { "scenario": options.segment, "backendOrigin": origin, "preparationMs": prepared["durationMs"],
            "installation": { "startedAt": install_started, "durationMs": now() - install_started, "command": ["xcrun", "simctl", "install", udid, app] },
            "fixture": "application-provided; driver injects no application rows",
            "authentication": "normal application flow; driver provides no credentials/session",
            "reset": "one install before prime, existing data/keychain preserved; no reset or reinstall between segments",
            "limits": "Native smoke only; authentication and nonempty fixture are application responsibilities. No M6/M8 admission." } });
    if proof["nativeBase"].is_null() { proof["nativeBase"] = json!({ "app": prepared["executedApp"]["inventory"]["sha256"], "build": artifact(&receipt)?["sha256"], "fingerprint": prepared["nativeFingerprint"]["fingerprint"]["hash"] }); }
    let path = options.artifacts.join("proof.json");
    let mut file = OpenOptions::new().create_new(true).write(true).open(&path).map_err(|e| error("E_WITNESS_PROOF", e))?;
    file.write_all(&serde_json::to_vec_pretty(&proof).unwrap()).map_err(|e| error("E_WITNESS_PROOF", e))?;
    use std::os::unix::fs::PermissionsExt;
    file.set_permissions(fs::Permissions::from_mode(0o444)).map_err(|e| error("E_WITNESS_PROOF", e))?;
    proof["sha256"] = artifact(&path)?["sha256"].clone();
    Ok(Some(proof))
}

pub(super) fn verify(options: &Options, app: &str, expected: &Value, label: &str) -> Result<()> {
    let check = options.artifacts.join("verify.mjs");
    if !check.exists() { fs::write(&check, "import {inventory,fail} from './payload.mjs'; if(inventory(process.argv[2]).sha256!==process.argv[3]) fail('E_WITNESS_PROOF','app inventory differs from preparation');").map_err(|e| error("E_WITNESS_PROOF", e))?; }
    node(options, &[check.to_str().unwrap(), app, expected.as_str().unwrap_or_default()], label).map_err(|e| error("E_WITNESS_PROOF", e))
}

fn selected_file(url: &Value) -> Option<String> {
    let value = url.as_str()?.strip_prefix("file://")?;
    let value = value.strip_prefix("localhost/").map_or_else(|| value.to_owned(), |p| format!("/{p}"));
    if !value.starts_with('/') || value.contains(['?', '#']) { return None; }
    let mut bytes = Vec::new();
    let mut chars = value.bytes();
    while let Some(b) = chars.next() {
        bytes.push(if b == b'%' {
            let hex = [chars.next()?, chars.next()?];
            u8::from_str_radix(std::str::from_utf8(&hex).ok()?, 16).ok()?
        } else { b });
    }
    if bytes.contains(&0) { return None; }
    String::from_utf8(bytes).ok()
}

pub(super) fn binding(rows: &[Value], proof: &Value, run: &str, segment: &str) -> Result<()> {
    let startup = rows.iter().rev().find(|r| r["startup"]["segment"] == segment).map(|r| &r["startup"])
        .ok_or_else(|| error("E_WITNESS_PROOF", "missing native startup observation; rebuild with the preparation helper"))?;
    let exe = proof["executedApp"]["info"]["CFBundleExecutable"].as_str().unwrap_or_default();
    let native = proof["executedApp"]["native"].as_array().and_then(|a| a.iter().find(|r| r["path"] == exe));
    if startup["format"] != 2 || startup["helper"] != "native-proof-v2"
        || startup["launcherManifestPresent"] != false || startup["updatesPresent"] != false || startup["updatesManifestPresent"] != false
        || startup["dev"] != false || startup["selectedBundlePath"] != proof["installedBundlePath"]
        || selected_file(&startup["scriptURL"]).as_deref() != proof["installedBundlePath"].as_str()
        || !proof["installedBundlePath"].as_str().is_some_and(|p| p.starts_with('/') && p.ends_with("/main.jsbundle")) || startup["run"] != run || startup["proofSha256"] != proof["sha256"]
        || startup["javascriptSha256"] != proof["javascript"]["sha256"] || Some(&startup["executableSha256"]) != native.map(|n| &n["sha256"])
        || startup["bundleId"] != proof["executedApp"]["info"]["CFBundleIdentifier"] || startup["release"] != true
        || startup["hermes"] != true || startup["nativeBase"] != proof["nativeBase"]["app"] || startup["output"] != proof["executedApp"]["inventory"]["sha256"] {
        return Err(error("E_WITNESS_PROOF", "native startup does not match sealed proof"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn recovery_with_late_member(launcher: &str, final_empty: bool) {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("sb4-node-anchor-{}-{launcher}-{final_empty}", std::process::id()));
        fs::create_dir_all(dir.join("export.app")).unwrap();
        let args: Vec<String> = ["ios", "--build", ".", "--smoke", "--export", ".", "--artifacts", dir.to_str().unwrap()].into_iter().map(String::from).collect();
        let options = Options::parse(&args).unwrap();
        recovery::begin_wrapper(&dir).unwrap();
        let runtime = node_runtime(&options, std::ffi::OsStr::new("node")).unwrap();
        let shim = dir.join("node");
        let launches = dir.join("launcher-calls");
        match launcher {
            // Like Volta, this launcher keeps its own PID while it waits for
            // Node. The shell case separately covers a non-exec script shim.
            "volta-style" => fs::write(&shim, format!(
                "#!{}\nconst fs=require('node:fs');const cp=require('node:child_process');fs.appendFileSync({},'call\\n');const r=cp.spawnSync({},process.argv.slice(2),{{stdio:'inherit'}});process.exit(r.status??1);\n",
                runtime.display(), json!(launches), json!(runtime))).unwrap(),
            "shell" => fs::write(&shim, format!(
                "#!/bin/sh\nprintf 'call\\n' >> '{}'\n'{}' \"$@\"\nexit $?\n",
                launches.display().to_string().replace('\'', "'\\''"), runtime.display().to_string().replace('\'', "'\\''"))).unwrap(),
            "direct" => {},
            _ => unreachable!(),
        }
        if launcher != "direct" { fs::set_permissions(&shim, fs::Permissions::from_mode(0o755)).unwrap(); }
        let selected = if launcher == "direct" { &runtime } else { &shim };
        let ready = dir.join("ready.json");
        let code = "const fs=require('node:fs'),p=process.argv[1];fs.writeFileSync(p+'.tmp',JSON.stringify({pid:process.pid,parent:process.ppid,runtime:process.execPath}));fs.renameSync(p+'.tmp',p);setInterval(()=>{},1000)";
        let args: Vec<String> = ["ios", "--build", ".", "--smoke", "--export", ".", "--artifacts", dir.to_str().unwrap()].into_iter().map(String::from).collect();
        let options = Options::parse(&args).unwrap();
        recovery::begin_wrapper(&dir).unwrap();
        let mut keeper = PreparationProcess::spawn_with_node(&options, selected.as_os_str(), std::ffi::OsStr::new("node"),
            &[std::ffi::OsStr::new("-e"), std::ffi::OsStr::new(code), ready.as_os_str()], "preparation").unwrap();
        let end = Instant::now() + Duration::from_secs(10);
        while !ready.exists() && Instant::now() < end { sleep(Duration::from_millis(10)); }
        let worker: Value = serde_json::from_slice(&fs::read(&ready).expect("worker started")).unwrap();
        assert_eq!(worker["parent"], keeper.group["group"], "recorded leader must be the runner, not a launcher");
        assert_eq!(worker["runtime"], json!(runtime));
        if launcher != "direct" { assert_eq!(fs::read_to_string(&launches).unwrap(), "call\n", "resolve through the shim exactly once"); }
        let journal: Value = serde_json::from_slice(&fs::read(dir.join("live.json")).unwrap()).unwrap();
        let group = &journal["children"]["preparation"];
        assert_eq!(group["group"], keeper.group["group"]);
        let pgid = group["group"].as_u64().unwrap() as u32;
        assert_eq!(group["leader"], recovery::identity(pgid).unwrap());
        if final_empty {
            // Remove the worker first: Astra's boundary is the final snapshot
            // containing only the anchor, not the earlier nonempty snapshot.
            let pid = worker["pid"].as_u64().unwrap() as u32;
            recorded_process::stop(&recovery::identity(pid).unwrap(), libc::SIGKILL).unwrap();
            assert_eq!(recovery::members(pgid).unwrap(), vec![group["leader"].clone()]);
        }
        let mut late: Option<Owned> = None;
        let mut snapshots = 0;
        recovery::stop_group_with(group, || {
            snapshots += 1;
            if late.is_none() {
                // Deterministically join AFTER the member snapshot. Recovery
                // must retain the anchor and enumerate again to find this PID.
                late = Some(Owned::spawn(Command::new("sleep").arg("60").process_group(pgid as i32)).unwrap());
            }
        }).unwrap();
        assert!(snapshots >= 1);
        assert!(late.as_mut().unwrap().status().unwrap().is_some(), "late member must drain before cleanup succeeds");
        keeper.cleanup().unwrap();
        assert!(!keeper.live_group().unwrap());
        // Retry and ordinary abandoned-output recovery must remain idempotent.
        recovery::stop_group_with(group, || panic!("empty group must already be drained")).unwrap();
        recovery::cleanup(&dir, Some(&dir)).unwrap();
        recovery::cleanup(&dir, Some(&dir)).unwrap();
        assert!(!dir.join("export.app").exists());
        assert!(dir.join("finished.json").exists());
        eprintln!("{launcher}: native leader; late member drained; retry and output cleanup passed");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn recovery_direct_node_drains_late_group_member() { recovery_with_late_member("direct", false); }
    #[test]
    fn recovery_volta_style_shim_drains_late_group_member() { recovery_with_late_member("volta-style", false); }
    #[test]
    fn recovery_shell_shim_drains_late_group_member() { recovery_with_late_member("shell", false); }

    #[test]
    fn recovery_direct_node_drains_final_empty_snapshot_joiner() { recovery_with_late_member("direct", true); }
    #[test]
    fn recovery_volta_style_shim_drains_final_empty_snapshot_joiner() { recovery_with_late_member("volta-style", true); }
    #[test]
    fn recovery_shell_shim_drains_final_empty_snapshot_joiner() { recovery_with_late_member("shell", true); }

    // A separate owner process permits real SIGTERM/INT/KILL without touching
    // the parallel test runner's signal state. It executes the actual resolver.
    #[test]
    fn stalled_resolver_owner() {
        let Some(dir) = std::env::var_os("SB4_RESOLVER_FIXTURE") else { return; };
        let dir = PathBuf::from(dir);
        for signal in [libc::SIGTERM, libc::SIGINT] { unsafe { libc::signal(signal, interrupt as *const () as usize); } }
        let seconds = std::env::var("SB4_RESOLVER_TIMEOUT").unwrap();
        let args: Vec<String> = ["ios", "--build", ".", "--smoke", "--export", ".", "--timeout", &seconds, "--artifacts", dir.to_str().unwrap()].into_iter().map(String::from).collect();
        let options = Options::parse(&args).unwrap();
        let _run = recovery::begin(&options).unwrap();
        let result = node_runtime(&options, dir.join("node").as_os_str());
        fs::write(dir.join("outcome"), result.unwrap_err()).unwrap();
    }
    fn stalled_resolver(signal: Option<i32>) {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("sb4-stalled-resolver-{}", std::process::id())).join(format!("{signal:?}"));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("node"), "#!/bin/sh\nprintf '%s' \"$$\" > \"$SB4_RESOLVER_FIXTURE/launcher.pid\"\nsleep 60 &\nprintf '%s' \"$!\" > \"$SB4_RESOLVER_FIXTURE/descendant.pid.tmp\"\nmv \"$SB4_RESOLVER_FIXTURE/descendant.pid.tmp\" \"$SB4_RESOLVER_FIXTURE/descendant.pid\"\nwait\n").unwrap();
        fs::set_permissions(dir.join("node"), fs::Permissions::from_mode(0o755)).unwrap();
        let mut owner = Owned::spawn(Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "verbs::witness::preparation::tests::stalled_resolver_owner", "--nocapture"])
            .env("SB4_RESOLVER_FIXTURE", &dir).env("SB4_RESOLVER_TIMEOUT", if signal.is_some() { "30" } else { "3" }).stdout(Stdio::null()).stderr(Stdio::null())).unwrap();
        let end = Instant::now() + Duration::from_secs(10);
        while !dir.join("descendant.pid").exists() && Instant::now() < end { sleep(Duration::from_millis(10)); }
        assert!(dir.join("descendant.pid").exists());
        let journal: Value = serde_json::from_slice(&fs::read(dir.join("live.json")).unwrap()).unwrap();
        let group = &journal["children"]["runtime-resolution"];
        assert!(group["leader"].is_object(), "resolver must be journalled before the launcher starts");
        let launcher: u32 = fs::read_to_string(dir.join("launcher.pid")).unwrap().parse().unwrap();
        let descendant: u32 = fs::read_to_string(dir.join("descendant.pid")).unwrap().parse().unwrap();
        let births = [recovery::identity(launcher).unwrap(), recovery::identity(descendant).unwrap()];
        assert_eq!(unsafe { libc::getpgid(launcher as i32) }, group["group"].as_i64().unwrap() as i32);
        let start = Instant::now();
        if let Some(signal) = signal { unsafe { libc::kill(owner.0.id() as i32, signal); } }
        while owner.status().unwrap().is_none() && start.elapsed() < Duration::from_secs(5) { sleep(Duration::from_millis(20)); }
        assert!(owner.status().unwrap().is_some(), "resolver owner must answer cancellation promptly");
        // SIGKILL does not run Rust Drop: the native watchdog must do this
        // before recovery, including through a stalled spawn-and-wait launcher.
        let end = Instant::now() + Duration::from_secs(5);
        while !recovery::members(group["group"].as_u64().unwrap() as u32).unwrap().is_empty() && Instant::now() < end { sleep(Duration::from_millis(20)); }
        for record in births { assert_ne!(recovery::identity(record["pid"].as_u64().unwrap() as u32).as_ref(), Some(&record)); }
        if signal != Some(libc::SIGKILL) {
            let outcome = fs::read_to_string(dir.join("outcome")).unwrap();
            if signal.is_some() { assert!(outcome.contains("E_WITNESS_INTERRUPTED"), "{outcome}"); }
            else { assert!(outcome.contains("E_WITNESS_PROCESS") && outcome.contains("3-second") && outcome.contains("installing/downloading") && outcome.contains(dir.join("node").to_str().unwrap()), "{outcome}"); }
        }
        eprintln!("stalled resolver {signal:?}: owner completed in {:?}; launcher and descendant drained before recovery", start.elapsed());
        recovery::cleanup(&dir, Some(&dir)).unwrap();
        assert!(dir.join("finished.json").exists());
        assert!(recovery::members(group["group"].as_u64().unwrap() as u32).unwrap().is_empty());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test] fn stalled_resolver_sigterm_is_bounded_journalled_and_drained() { stalled_resolver(Some(libc::SIGTERM)); }
    #[test] fn stalled_resolver_sigint_is_bounded_journalled_and_drained() { stalled_resolver(Some(libc::SIGINT)); }
    #[test] fn stalled_resolver_sigkill_triggers_watchdog_before_recovery() { stalled_resolver(Some(libc::SIGKILL)); }
    #[test] fn stalled_resolver_timeout_is_bounded_journalled_and_drained() { stalled_resolver(None); }

    #[test]
    fn recovery_keeps_group_custody_after_anchor_exit() {
        let dir = std::env::temp_dir().join(format!("sb4-dead-anchor-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let args: Vec<String> = ["ios", "--build", ".", "--smoke", "--artifacts", dir.to_str().unwrap()].into_iter().map(String::from).collect();
        let options = Options::parse(&args).unwrap();
        let mut keeper = PreparationProcess::launch(&options, std::ffi::OsStr::new("sleep"), &[std::ffi::OsStr::new("60")], "preparation").unwrap();
        // Pause our guardian so recovery, not the watchdog, performs the drain.
        unsafe { libc::kill(keeper.child.id() as i32, libc::SIGSTOP); }
        let pgid = keeper.group["group"].as_u64().unwrap() as u32;
        unsafe { libc::kill(pgid as i32, libc::SIGKILL); }
        let end = Instant::now() + Duration::from_secs(5);
        while recovery::identity(pgid).is_some() && Instant::now() < end { sleep(Duration::from_millis(10)); }
        assert!(recovery::identity(pgid).is_none());
        assert_eq!(recovery::birth(pgid).as_ref(), Some(&keeper.group["leader"]));
        let mut late = Owned::spawn(Command::new("sleep").arg("60").process_group(pgid as i32)).unwrap();
        let result = recovery::stop_group_with(&keeper.group, || {});
        unsafe { libc::kill(keeper.child.id() as i32, libc::SIGCONT); }
        result.unwrap();
        assert!(late.status().unwrap().is_some());
        keeper.cleanup().unwrap();
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn startup_binds_each_independent_identity() {
        let proof = json!({ "sha256": "proof", "installedBundlePath": "/app/main.jsbundle", "nativeBase": { "app": "base" }, "javascript": { "sha256": "js" },
            "executedApp": { "inventory": { "sha256": "output" }, "info": { "CFBundleExecutable": "App", "CFBundleIdentifier": "test.app" },
                "native": [{ "path": "App", "sha256": "exe" }] } });
        let startup = json!({ "format": 2, "helper": "native-proof-v2", "dev": false, "launcherManifestPresent": false, "updatesPresent": false, "updatesManifestPresent": false, "selectedBundlePath": "/app/main.jsbundle", "scriptURL": "file:///app/main.jsbundle", "segment": "offline", "run": "run", "proofSha256": "proof", "nativeBase": "base", "output": "output",
            "javascriptSha256": "js", "executableSha256": "exe", "bundleId": "test.app", "release": true, "hermes": true });
        assert!(binding(&[json!({"startup": startup})], &proof, "run", "offline").is_ok());
        for key in ["launcherManifestPresent", "updatesPresent", "updatesManifestPresent", "helper", "dev", "selectedBundlePath", "scriptURL", "format", "run", "proofSha256", "nativeBase", "output", "javascriptSha256", "executableSha256", "bundleId", "release", "hermes"] {
            let mut changed = startup.clone(); changed[key] = Value::Null;
            assert!(binding(&[json!({"startup": changed})], &proof, "run", "offline").is_err(), "{key}");
        }
        for url in ["file:///other/main.jsbundle", "http://localhost/main.jsbundle", "file://remote/app/main.jsbundle", "file:///app/main.jsbundle?other", "file:///app/%00main.jsbundle"] {
            let mut changed = startup.clone(); changed["scriptURL"] = json!(url);
            assert!(binding(&[json!({"startup": changed})], &proof, "run", "offline").is_err(), "{url}");
        }
        let mut dev = startup.clone(); dev["dev"] = json!(true);
        assert!(binding(&[json!({"startup": dev})], &proof, "run", "offline").is_err());
        assert!(binding(&[json!({"startup": startup})], &proof, "run", "restart").is_err());
    }
    #[test]
    fn preparation_cleans_term_resistant_descendants_before_releasing_lease() {
        let dir = std::env::temp_dir().join(format!("np-group-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let helper = dir.join("parent.js");
        let heartbeat = dir.join("heartbeat");
        fs::write(&helper, r#"const {spawn}=require('node:child_process');
const fs=require('node:fs');
const code="process.on('SIGTERM',()=>{}); const fs=require('node:fs'); setInterval(()=>fs.appendFileSync(process.argv[1],'x'),30); console.log('ready')";
const child=spawn(process.execPath,['-e',code,process.argv[2]],{stdio:['ignore','pipe','ignore']});
child.stdout.once('data',()=>process.exit(0));
"#).unwrap();
        let args: Vec<String> = ["ios", "--build", ".", "--smoke", "--artifacts", dir.to_str().unwrap()].into_iter().map(String::from).collect();
        let options = Options::parse(&args).unwrap();
        let lock = dir.join("owner.lock");
        let held = lease(&lock).unwrap();
        std::thread::scope(|scope| {
            let worker = scope.spawn(|| {
                let result = node(&options, &[helper.to_str().unwrap(), heartbeat.to_str().unwrap()], "descendant");
                drop(held); result
            });
            let end = Instant::now() + Duration::from_secs(5);
            while !heartbeat.exists() && Instant::now() < end { sleep(Duration::from_millis(20)); }
            assert!(heartbeat.exists(), "child reached its SIGTERM-resistant write loop");
            assert!(lease(&lock).is_err(), "lease remains held during group cleanup");
            worker.join().unwrap().unwrap();
        });
        let size = fs::metadata(&heartbeat).unwrap().len();
        sleep(Duration::from_millis(200));
        assert_eq!(fs::metadata(&heartbeat).unwrap().len(), size, "descendant must stop writing before return");
        assert!(lease(&lock).is_ok());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn lease_preserves_an_existing_owner_and_releases_on_drop() {
        // Other tests fork in parallel. Run the release assertion in a process
        // where every inherited holder is known and reaped before reacquiring.
        let output = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "verbs::witness::preparation::tests::lease_fork_fixture", "--nocapture"])
            .env("SB4_LEASE_FORK_FIXTURE", "1").output().unwrap();
        assert!(output.status.success(), "{}\n{}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr));
    }
    #[test]
    fn lease_fork_fixture() {
        if std::env::var_os("SB4_LEASE_FORK_FIXTURE").is_none() { return; }
        use std::os::fd::AsRawFd;
        let path = std::env::temp_dir().join(format!("np-lease-{}", std::process::id()));
        let owner = lease(&path).unwrap();
        assert_ne!(unsafe { libc::fcntl(owner.as_raw_fd(), libc::F_GETFD) } & libc::FD_CLOEXEC, 0);
        assert!(lease(&path).is_err());
        let mut pipe = [0; 2];
        assert_eq!(unsafe { libc::pipe(pipe.as_mut_ptr()) }, 0);
        let pid = unsafe { libc::fork() };
        assert!(pid >= 0);
        if pid == 0 {
            // Only async-signal-safe operations in the pre-exec child.
            unsafe {
                libc::close(pipe[1]);
                let mut byte = 0u8;
                libc::read(pipe[0], &mut byte as *mut _ as *mut _, 1);
                libc::_exit(0);
            }
        }
        unsafe { libc::close(pipe[0]); }
        drop(owner);
        assert!(lease(&path).is_err(), "fork-inherited descriptor still owns the flock");
        unsafe { libc::close(pipe[1]); }
        let mut status = 0;
        assert_eq!(unsafe { libc::waitpid(pid, &mut status, 0) }, pid);
        assert_eq!(status, 0);
        assert!(lease(&path).is_ok());
        let _ = fs::remove_file(path);
    }
}
