//! @ref LLP 3000.030#5 — one simulator owner across preparation and execution.
use super::*;
use std::os::unix::process::CommandExt;

pub(super) fn lease(path: &Path) -> Result<File> {
    if let Some(parent) = path.parent() { fs::create_dir_all(parent).map_err(|e| error("E_WITNESS_ARTIFACT", e))?; }
    let file = OpenOptions::new().create(true).truncate(false).read(true).write(true).open(path).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
    file.try_lock().map_err(|_| error("E_WITNESS_PROCESS", format!("witness owner already holds {}; leaving it untouched", path.display())))?;
    Ok(file)
}

fn node(options: &Options, args: &[&str], label: &str) -> Result<()> {
    let mut cmd = Command::new("node");
    cmd.args(args).process_group(0).stdin(Stdio::null())
        .stdout(output(&options.artifacts.join(format!("{label}-stdout.log")))?)
        .stderr(output(&options.artifacts.join(format!("{label}-stderr.log")))?);
    let mut child = Owned::spawn(&mut cmd)?;
    let end = Instant::now() + Duration::from_secs(900);
    let result = loop {
        if let Some(status) = child.status()? { break if status.success() { Ok(()) } else {
            let detail = fs::read_to_string(options.artifacts.join(format!("{label}-stderr.log"))).unwrap_or_default();
            Err(if let Some(start) = detail.find("E_WITNESS_") { detail[start..].trim().to_owned() }
                else { error("E_WITNESS_BUILD", format!("{label} exited {status}: {detail}")) })
        }; }
        if Instant::now() >= end { break Err(error("E_WITNESS_BUILD", "preparation exceeded its 900-second deadline")); }
        if let Err(e) = tick() { break Err(e); }
    };
    if result.is_err() {
        // The helper and all compiler/pod children share our new process group.
        unsafe { libc::kill(-(child.0.id() as i32), libc::SIGTERM); }
        let _ = child.stop(libc::SIGTERM);
    }
    result
}

pub(super) fn prepare_app(options: &mut Options, udid: &str) -> Result<Option<Value>> {
    let Some(project) = options.build.as_ref().or(options.app_project.as_ref()) else { return Ok(None); };
    let project = fs::canonicalize(project).map_err(|e| error("E_WITNESS_BUILD", e))?;
    let _project_lease = lease(&project.join(".snapback4-witness/owner.lock"))?;
    let helper = options.artifacts.join("prepare.mjs");
    fs::write(&helper, include_str!("prepare.mjs")).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
    fs::write(options.artifacts.join("payload.mjs"), include_str!("payload.mjs")).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
    let mode = if options.build.is_some() { "build" } else { "repack" };
    let origin = format!("http://127.0.0.1:{}", options.port);
    node(options, &[helper.to_str().unwrap(), mode, project.to_str().unwrap(), options.artifacts.to_str().unwrap(), udid, &origin,
        options.repack.as_ref().and_then(|p| p.to_str()).unwrap_or("")], "preparation")?;
    let receipt = options.artifacts.join(if mode == "build" { "build.json" } else { "repack.json" });
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
        "installedApp": installed,
        "executedApp": prepared["executedApp"], "javascript": prepared["executedApp"]["javascript"], "compiler": prepared["compiler"],
        "nativeFingerprint": prepared["nativeFingerprint"], "preparation": artifact(&receipt)?, "runtime": { "udid": udid, "toolchain": prepared["toolchain"] },
        "scope": { "scenario": options.segment, "backendOrigin": origin, "preparationMs": prepared["durationMs"],
            "installation": { "startedAt": install_started, "durationMs": now() - install_started, "command": ["xcrun", "simctl", "install", udid, app] },
            "fixture": "application-provided; driver injects no application rows",
            "authentication": "normal application flow; driver provides no credentials/session",
            "reset": "one install before prime, existing data/keychain preserved; no reset or reinstall between segments",
            "limits": "Native smoke only; authentication and nonempty fixture are application responsibilities. No M6/M8 admission." } });
    if mode == "build" { proof["nativeBase"] = json!({ "app": prepared["executedApp"]["inventory"]["sha256"], "build": artifact(&receipt)?["sha256"], "fingerprint": prepared["nativeFingerprint"]["fingerprint"]["hash"] }); }
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

pub(super) fn binding(rows: &[Value], proof: &Value, run: &str, segment: &str) -> Result<()> {
    let startup = rows.iter().rev().find(|r| r["startup"]["segment"] == segment).map(|r| &r["startup"])
        .ok_or_else(|| error("E_WITNESS_PROOF", "missing native startup observation; rebuild with the preparation helper"))?;
    let exe = proof["executedApp"]["info"]["CFBundleExecutable"].as_str().unwrap_or_default();
    let native = proof["executedApp"]["native"].as_array().and_then(|a| a.iter().find(|r| r["path"] == exe));
    if startup["format"] != 1 || startup["run"] != run || startup["proofSha256"] != proof["sha256"]
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
        let proof = json!({ "sha256": "proof", "nativeBase": { "app": "base" }, "javascript": { "sha256": "js" },
            "executedApp": { "inventory": { "sha256": "output" }, "info": { "CFBundleExecutable": "App", "CFBundleIdentifier": "test.app" },
                "native": [{ "path": "App", "sha256": "exe" }] } });
        let startup = json!({ "format": 1, "segment": "offline", "run": "run", "proofSha256": "proof", "nativeBase": "base", "output": "output",
            "javascriptSha256": "js", "executableSha256": "exe", "bundleId": "test.app", "release": true, "hermes": true });
        assert!(binding(&[json!({"startup": startup})], &proof, "run", "offline").is_ok());
        for key in ["format", "run", "proofSha256", "nativeBase", "output", "javascriptSha256", "executableSha256", "bundleId", "release", "hermes"] {
            let mut changed = startup.clone(); changed[key] = Value::Null;
            assert!(binding(&[json!({"startup": changed})], &proof, "run", "offline").is_err(), "{key}");
        }
        assert!(binding(&[json!({"startup": startup})], &proof, "run", "restart").is_err());
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
