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
    let file = OpenOptions::new().create(true).truncate(false).read(true).write(true).open(path).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
    file.try_lock().map_err(|_| error("E_WITNESS_PROCESS", "another witness holds the project or --udid lease; leaving it untouched"))?;
    Ok(file)
}

// Keep the unreaped leader (and thus its process-group identity) until every
// live member has stopped. Parent exit alone says nothing about compilers.
struct PreparationProcess { child: Child, cleaned: bool }
impl PreparationProcess {
    fn status(&self) -> Result<Option<ExitStatus>> {
        use std::os::unix::process::ExitStatusExt;
        let mut info: libc::siginfo_t = unsafe { std::mem::zeroed() };
        if unsafe { libc::waitid(libc::P_PID, self.child.id(), &mut info, libc::WEXITED | libc::WNOHANG | libc::WNOWAIT) } != 0 {
            return Err(error("E_WITNESS_PROCESS", std::io::Error::last_os_error()));
        }
        if unsafe { info.si_pid() } == 0 { return Ok(None); }
        let code = unsafe { info.si_status() };
        Ok(Some(ExitStatus::from_raw(if info.si_code == libc::CLD_EXITED { code << 8 } else { code })))
    }
    fn live_group(&self) -> Result<bool> {
        let output = Command::new("ps").args(["-axo", "pgid=,stat="]).output().map_err(|e| error("E_WITNESS_PROCESS", e))?;
        if !output.status.success() { return Err(error("E_WITNESS_PROCESS", "cannot inspect owned preparation group")); }
        Ok(String::from_utf8_lossy(&output.stdout).lines().any(|line| {
            let mut fields = line.split_whitespace();
            fields.next().and_then(|s| s.parse::<u32>().ok()) == Some(self.child.id())
                && fields.next().is_some_and(|s| !s.starts_with('Z'))
        }))
    }
    fn cleanup(&mut self) -> Result<()> {
        if self.cleaned { return Ok(()); }
        for signal in [libc::SIGTERM, libc::SIGKILL] {
            unsafe { libc::kill(-(self.child.id() as i32), signal); }
            let end = Instant::now() + Duration::from_secs(2);
            loop {
                if !self.live_group()? {
                    self.child.wait().map_err(|e| error("E_WITNESS_PROCESS", e))?;
                    self.cleaned = true; return Ok(());
                }
                if Instant::now() >= end { break; }
                sleep(Duration::from_millis(50));
            }
        }
        Err(error("E_WITNESS_PROCESS", "owned preparation group survived SIGKILL cleanup"))
    }
}
impl Drop for PreparationProcess { fn drop(&mut self) { let _ = self.cleanup(); } }

fn node(options: &Options, args: &[&str], label: &str) -> Result<()> {
    let mut cmd = Command::new("node");
    cmd.args(args).process_group(0).stdin(Stdio::null())
        .stdout(output(&options.artifacts.join(format!("{label}-stdout.log")))?)
        .stderr(output(&options.artifacts.join(format!("{label}-stderr.log")))?);
    let mut child = PreparationProcess { child: cmd.spawn().map_err(|e| error("E_WITNESS_PROCESS", e))?, cleaned: false };
    recovery::child(options, "preparation", child.child.id())?;
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
    let mut command = Command::new(binary);
    command.arg("check").process_group(0).stdin(Stdio::null())
        .stdout(output(&options.artifacts.join("check-stdout.log"))?)
        .stderr(output(&options.artifacts.join("check-stderr.log"))?);
    let mut child = PreparationProcess { child: command.spawn().map_err(|e| error("E_WITNESS_PROCESS", e))?, cleaned: false };
    recovery::child(options, "preparation", child.child.id())?;
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
        let path = std::env::temp_dir().join(format!("np-lease-{}", std::process::id()));
        let owner = lease(&path).unwrap();
        assert!(lease(&path).is_err());
        drop(owner);
        assert!(lease(&path).is_ok());
        let _ = fs::remove_file(path);
    }
}
