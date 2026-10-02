//! @ref LLP 3000.030#15 — recover abandoned exports only under leases and process birth identities.
use super::*;

fn identity(pid: u32) -> Option<Value> {
    if pid == 0 { return None; }
    #[cfg(target_os = "macos")]
    {
        let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
        let size = std::mem::size_of_val(&info) as i32;
        if unsafe { libc::proc_pidinfo(pid as i32, libc::PROC_PIDTBSDINFO, 0, &mut info as *mut _ as *mut _, size) } != size || info.pbi_status == 5 { return None; }
        Some(json!({ "pid": pid, "start": [info.pbi_start_tvsec, info.pbi_start_tvusec] }))
    }
    #[cfg(target_os = "linux")]
    {
        let text = fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
        let fields: Vec<_> = text.rsplit_once(')')?.1.split_whitespace().collect();
        if fields.first() == Some(&"Z") { return None; }
        Some(json!({ "pid": pid, "start": [fs::read_to_string("/proc/sys/kernel/random/boot_id").ok()?, fields.get(19)?] }))
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    { None }
}
fn alive(record: &Value) -> bool {
    record["pid"].as_u64().and_then(|pid| identity(pid as u32)).as_ref() == Some(record) && !record.is_null()
}
fn read(path: &Path) -> Value { fs::read(path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or(Value::Null) }
fn write(path: &Path, value: &Value) -> Result<()> {
    let temp = path.with_extension("json.tmp");
    let mut file = File::create(&temp).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
    file.write_all(&serde_json::to_vec(value).unwrap()).and_then(|_| file.sync_all()).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
    fs::rename(temp, path).map_err(|e| error("E_WITNESS_ARTIFACT", e))
}
fn update(options: &Options, change: impl FnOnce(&mut Value)) -> Result<()> {
    if options.export.is_none() { return Ok(()); }
    let path = options.artifacts.join("live.json");
    let mut value = read(&path);
    if value.is_null() { return Err(error("E_WITNESS_ARTIFACT", "export has no process ownership record")); }
    change(&mut value); write(&path, &value)
}
pub(super) fn child(options: &Options, label: &str, pid: u32) -> Result<()> {
    let id = identity(pid);
    update(options, |value| value["children"][label] = id.map_or(Value::Null, |id| id))
}
pub(super) fn simulator(options: &Options, simulator: &Value) -> Result<()> {
    update(options, |value| value["simulator"] = simulator.clone())
}
pub(super) fn app(options: &Options, pid: Option<u32>, udid: &str, bundle: &str, dir: &Path) -> Result<()> {
    update(options, |value| {
        value["app"] = pid.and_then(identity).unwrap_or(Value::Null);
        value["udid"] = json!(udid); value["bundle"] = json!(bundle); value["staging"] = json!(dir);
    })
}
pub(super) fn begin(options: &Options) -> Result<Option<File>> {
    if options.export.is_none() { return Ok(None); }
    if let Some(root) = options.artifacts.parent() {
        if let Err(e) = cleanup(root, None) { eprintln!("witness: evidence cleanup deferred: {e}"); }
    }
    let lease = preparation::lease(&options.artifacts.join("run.lock"))?;
    let owner = identity(std::process::id()).ok_or_else(|| error("E_WITNESS_PROCESS", "cannot record driver process start time"))?;
    let wrapper = std::env::var("SNAPBACK4_EXPORT_WRAPPER_PID").ok().and_then(|s| s.parse().ok()).and_then(identity);
    write(&options.artifacts.join("live.json"), &json!({ "owner": owner, "wrapper": wrapper, "children": {}, "startedAt": now() }))?;
    Ok(Some(lease))
}
fn stop(record: &Value, signal: i32) -> Result<()> {
    if !alive(record) { return Ok(()); }
    let pid = record["pid"].as_u64().unwrap() as i32;
    unsafe { libc::kill(pid, signal); }
    let end = Instant::now() + Duration::from_secs(10);
    while alive(record) {
        if Instant::now() >= end {
            // Recheck the start time immediately before every signal.
            if alive(record) { unsafe { libc::kill(pid, libc::SIGKILL); } }
            let killed = Instant::now() + Duration::from_secs(2);
            while alive(record) && Instant::now() < killed { sleep(Duration::from_millis(20)); }
            if alive(record) { return Err(error("E_WITNESS_PROCESS", "recorded abandoned process did not stop")); }
            break;
        }
        sleep(Duration::from_millis(50));
    }
    Ok(())
}
fn recover(dir: &Path) -> Result<bool> {
    let mut record = read(&dir.join("live.json"));
    if alive(&record["owner"]) {
        // A wrapper killed with SIGKILL cannot forward cancellation. Request
        // cleanup from its still-live driver, by its recorded birth identity.
        if record["wrapper"].is_null() || alive(&record["wrapper"]) { return Ok(false); }
        stop(&record["owner"], libc::SIGTERM)?;
    }
    let Ok(_run) = preparation::lease(&dir.join("run.lock")) else { return Ok(false); };
    record = read(&dir.join("live.json"));
    if alive(&record["owner"]) { return Ok(false); }
    if record.is_null() {
        // Legacy runs have no start-time record: never infer process ownership
        // from a PID in a directory name. Leave them alone unless completed.
        return Ok(false);
    }
    // If the driver died during create, its isolated child may have printed
    // the identity after the last journal update. Stop that exact child first,
    // then recover the printed identity together with the pre-create intent.
    if record["simulator"]["selection"] == "created" && record["simulator"]["udid"].is_null() {
        stop(&record["children"]["create"], libc::SIGTERM)?;
        let text = fs::read_to_string(dir.join("simulator-create.stdout")).unwrap_or_default();
        if let Some(id) = simulator::created_udid(&text) {
            record["simulator"]["udid"] = json!(id);
            write(&dir.join("live.json"), &record)?;
        }
    }
    let simulator = &record["simulator"];
    let mut owners = ownership::Records::open(simulator::owners()?);
    let udid = simulator["udid"].as_str().filter(|s| name(s));
    let _simulator_lease = match udid { Some(id) => match owners.lease(id) { Ok(l) => Some(l), Err(_) => return Ok(false) }, None => None };
    // Do not stop a replacement app, even on our simulator. Both PID and birth
    // time must match, and the simulator lease stays held through shutdown.
    if let Some(children) = record["children"].as_object() {
        for process in children.values() { stop(process, libc::SIGTERM)?; }
    }
    if let Some(udid) = udid {
        let mut owned = owners.read(udid);
        if owned.is_null() && simulator["selection"] == "created" && simulator["ready"] == false {
            owners.write(udid, simulator)?;
            owned = simulator.clone();
        }
        if owned["udid"] == udid && owned["name"] == simulator["name"] && owned["runtime"] == simulator["runtime"] && !owned["prefix"].is_null() {
            if owned["ready"] == false {
                simctl(&["delete", udid], Duration::from_secs(10))?;
                owners.remove(udid)?;
            } else {
            // Respect the legacy simulator-home lease as well as the lease
            // available before boot. If HOME cannot be resolved, no shutdown.
            if let Ok(home) = simctl(&["getenv", udid, "HOME"], Duration::from_secs(10)) {
                let Ok(_home_lease) = preparation::lease(&Path::new(&home).join(".snapback4-witness-owner.lock")) else { return Ok(false); };
                if alive(&record["app"]) {
                    let bundle = record["bundle"].as_str().unwrap_or_default();
                    if app_pid(&simctl(&["spawn", udid, "launchctl", "list"], Duration::from_secs(10))?, bundle)? == record["app"]["pid"].as_u64().map(|n| n as u32) {
                        simctl(&["terminate", udid, bundle], Duration::from_secs(10))?;
                    }
                }
                // Staging is nested in a recorded tool-owned simulator. Refuse
                // any other path even if a damaged journal supplies one.
                if let Some(staging) = record["staging"].as_str() {
                    let path = Path::new(staging);
                    if path.starts_with(Path::new(&home)) && staging.contains("/Documents/.snapback4-witness/") { let _ = fs::remove_dir_all(path); }
                }
                simctl(&["shutdown", udid], Duration::from_secs(10))?;
            }
            }
        }
    }
    for entry in fs::read_dir(dir).map_err(|e| error("E_WITNESS_ARTIFACT", e))? {
        let entry = entry.map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.ends_with(".app") || name.ends_with(".xcresult") || name.ends_with(".tmp") || name == "preparation-tmp" {
            remove(&entry.path())?;
        }
    }
    write(&dir.join("finished.json"), &json!({ "finishedAt": now(), "abandoned": true, "recovered": true }))?;
    eprintln!("witness: recovered abandoned export {}", dir.display());
    Ok(true)
}
fn remove(path: &Path) -> Result<()> {
    let result = if path.is_dir() && !path.is_symlink() { fs::remove_dir_all(path) } else { fs::remove_file(path) };
    result.or_else(|e| if e.kind() == std::io::ErrorKind::NotFound { Ok(()) } else { Err(e) }).map_err(|e| error("E_WITNESS_ARTIFACT", e))
}
const RECEIPTS: &[&str] = &["smoke-ios-run.json", "smoke-ios-receipts.jsonl", "proof.json", "build.json", "installed.json", "preparation-failure.json", "native-base.json", "live.json"];
pub(super) fn cleanup(root: &Path, completed: Option<&Path>) -> Result<()> {
    fs::create_dir_all(root).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
    // Blocking OS lock: no PID-file takeover race, and SIGKILL releases it.
    let lock = OpenOptions::new().read(true).write(true).create(true).truncate(false).open(root.join("retention.lock")).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
    lock.lock().map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
    if let Some(dir) = completed { write(&dir.join("finished.json"), &json!({ "finishedAt": now() }))?; }
    let mut runs = Vec::new();
    for entry in fs::read_dir(root).map_err(|e| error("E_WITNESS_ARTIFACT", e))? {
        let entry = entry.map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if !entry.file_type().is_ok_and(|t| t.is_dir()) || !name.split_once('-').is_some_and(|(a,b)| a.parse::<u128>().is_ok() && b.parse::<u32>().is_ok()) { continue; }
        let dir = entry.path();
        let run = read(&dir.join("smoke-ios-run.json"));
        let finished = dir.join("finished.json").exists() || (read(&dir.join("live.json")).is_null() && run["exitStatus"].is_number() && (run["endedAt"].is_number() || run["finishedAt"].is_number()));
        // Even a finalized receipt may precede a driver's last cleanup/drop.
        if alive(&read(&dir.join("live.json"))["owner"]) && finished { continue; }
        if finished || recover(&dir)? { runs.push(dir); }
    }
    runs.sort_by_key(|p| std::cmp::Reverse(p.file_name().unwrap().to_string_lossy().split('-').next().unwrap().parse::<u128>().unwrap()));
    // Five full runs plus at most twenty compressed receipt sets. Pin the
    // current native producer separately in the cache (saveBase owns its copy).
    for (index, dir) in runs.iter().enumerate().skip(5) {
        let Ok(_run) = preparation::lease(&dir.join("run.lock")) else { continue; };
        if index >= 25 { remove(dir)?; continue; }
        if dir.join("retention.json").exists() { continue; }
        let mut retained = Vec::new(); let mut removed = Vec::new();
        for entry in fs::read_dir(dir).map_err(|e| error("E_WITNESS_ARTIFACT", e))? {
            let entry = entry.map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if ["finished.json", "run.lock"].contains(&name.as_str()) { continue; }
            if name.ends_with(".gz") && RECEIPTS.contains(&name.trim_end_matches(".gz")) { retained.push(name); continue; }
            if RECEIPTS.contains(&name.as_str()) && entry.file_type().is_ok_and(|t| t.is_file()) {
                let compressed = Command::new("gzip").args(["-n", "-c"]).arg(entry.path()).output().map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
                if !compressed.status.success() { return Err(error("E_WITNESS_ARTIFACT", "receipt compression failed")); }
                let target = dir.join(format!("{name}.gz"));
                let temporary = dir.join(format!("{name}.gz.tmp"));
                fs::write(&temporary, compressed.stdout).and_then(|_| fs::rename(temporary, target)).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
                retained.push(format!("{name}.gz"));
            } else { removed.push(name); }
            remove(&entry.path())?;
        }
        write(&dir.join("retention.json"), &json!({ "retained": retained, "removed": removed }))?;
    }
    Ok(())
}
pub(super) fn command(args: &[String]) -> i32 {
    let result = if args.len() == 1 || args.len() == 2 {
        cleanup(Path::new(&args[0]), args.get(1).map(Path::new))
    } else { Err(error("E_WITNESS_INPUT", "export-cleanup requires the export artifact root and optional completed run")) };
    match result { Ok(()) => 0, Err(e) => { eprintln!("witness: evidence cleanup deferred: {e}"); 1 } }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn abandoned_bulk_and_backend_wait_for_the_run_lease_and_reject_a_reused_pid() {
        let root = std::env::temp_dir().join(format!("sb4-abandoned-{}-{}", std::process::id(), now()));
        let dir = root.join("1-123"); fs::create_dir_all(dir.join("export.app")).unwrap();
        fs::create_dir_all(dir.join("build.xcresult")).unwrap();
        fs::create_dir_all(dir.join("preparation-tmp")).unwrap();
        let mut backend = Owned::spawn(Command::new("sleep").arg("60")).unwrap();
        let mut owner = identity(std::process::id()).unwrap(); owner["start"] = json!([0, 0]);
        write(&dir.join("live.json"), &json!({ "owner": owner, "children": { "backend": identity(backend.0.id()).unwrap() } })).unwrap();
        let lease = preparation::lease(&dir.join("run.lock")).unwrap();
        cleanup(&root, None).unwrap();
        assert!(dir.join("export.app").exists()); assert!(backend.status().unwrap().is_none());
        drop(lease);
        cleanup(&root, None).unwrap();
        assert!(!dir.join("export.app").exists()); assert!(!dir.join("build.xcresult").exists()); assert!(!dir.join("preparation-tmp").exists());
        assert_eq!(read(&dir.join("finished.json"))["abandoned"], true);
        assert!(backend.status().unwrap().is_some());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn pid_reuse_does_not_keep_an_abandoned_run_alive() {
        let mut id = identity(std::process::id()).unwrap();
        assert!(alive(&id)); id["start"] = json!([0, 0]); assert!(!alive(&id));
    }
}
