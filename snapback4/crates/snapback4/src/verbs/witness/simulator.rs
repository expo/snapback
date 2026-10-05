//! @ref LLP 3000.030#13 — automatic selection requires persisted creation evidence, never a name alone.
use super::*;

const SETUP: &str = "native smoke needs Xcode and an iOS simulator runtime; install Xcode, open Settings > Components to install iOS, then retry (set DEVELOPER_DIR to Xcode.app/Contents/Developer if needed)";

// Only failures of named environment operations earn a skip. Parsing, input,
// ownership persistence, leases and interrupts never enter this allowlist.
fn environment<T>(result: Result<T>, preparation: &mut Value, condition: &str) -> Result<T> {
    result.map_err(|e| {
        if ["E_WITNESS_PLATFORM:", "E_WITNESS_SIMULATOR:", "E_WITNESS_TIMEOUT:"].iter().any(|code| e.starts_with(code)) {
            preparation["environmentCondition"] = json!(condition);
        }
        e
    })
}
fn list(kind: &str, timeout: Duration, preparation: &mut Value) -> Result<Value> {
    let output = environment(simctl(&["list", kind, "--json"], timeout), preparation, "simulator-list").map_err(|e| {
        if e.starts_with("E_WITNESS_SIMULATOR:") || e.starts_with("E_WITNESS_PLATFORM:") { error("E_WITNESS_PLATFORM", SETUP) }
        else { e }
    })?;
    serde_json::from_str(&output).map_err(|_| error("E_WITNESS_SIMULATOR", "simctl returned invalid JSON"))
}

pub(super) fn created_udid(text: &str) -> Option<&str> {
    text.lines().map(str::trim).rev().find(|line| line.len() == 36 && line.bytes().enumerate().all(|(i, b)| {
        if [8, 13, 18, 23].contains(&i) { b == b'-' } else { b.is_ascii_hexdigit() }
    }))
}

// A durable, run-specific intent plus an exact name/runtime match establishes
// creation custody even if simctl buffered its UUID when it was killed.
pub(super) fn reconcile_created(intent: &Value) -> Result<Option<String>> {
    let prefix = intent["prefix"].as_str().unwrap_or_default();
    let wanted = intent["name"].as_str().unwrap_or_default();
    let runtime = intent["runtime"].as_str().unwrap_or_default();
    if intent["selection"] != "created" || intent["ready"] != false || !name(prefix) || !prefix.ends_with('-')
        || !wanted.starts_with(prefix) || wanted.len() <= prefix.len() || runtime.is_empty() {
        return Err(error("E_WITNESS_SIMULATOR", "missing valid run creation intent; cannot reconcile simulator"));
    }
    let interrupted = INTERRUPTED.swap(false, Ordering::Relaxed);
    let output = simctl(&["list", "devices", "--json"], Duration::from_secs(10));
    if interrupted { INTERRUPTED.store(true, Ordering::Relaxed); }
    let devices: Value = serde_json::from_str(&output?).map_err(|e| error("E_WITNESS_SIMULATOR", e))?;
    let matches: Vec<_> = devices["devices"][runtime].as_array().into_iter().flatten()
        .filter(|device| device["name"] == wanted).collect();
    if matches.len() > 1 { return Err(error("E_WITNESS_SIMULATOR", "ambiguous run creation intent; leaving devices untouched")); }
    Ok(matches.first().and_then(|device| device["udid"].as_str()).filter(|id| created_udid(id).is_some()).map(str::to_owned))
}

fn delete_created(udid: &str, _lease: &File, preparation: &mut Value) -> Result<()> {
    // Cancellation must not cancel rollback. Restore the flag for the caller.
    let was_interrupted = INTERRUPTED.swap(false, Ordering::Relaxed);
    let result = simctl(&["delete", udid], Duration::from_secs(10));
    if was_interrupted { INTERRUPTED.store(true, Ordering::Relaxed); }
    preparation["simulator"]["deleted"] = json!(result.is_ok());
    result.map(|_| ()).map_err(|_| error("E_WITNESS_SIMULATOR", format!("could not delete newly created simulator {udid}; delete this exact UDID manually")))
}

fn version(text: &str) -> Vec<u32> {
    text.split(['.', '-']).map(|p| p.parse().unwrap_or(0)).collect()
}

pub(super) fn owners() -> Result<PathBuf> {
    let root = std::env::var_os("XDG_STATE_HOME").map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/state")))
        .filter(|p| p.is_absolute())
        .ok_or_else(|| error("E_WITNESS_SIMULATOR", "set HOME or an absolute XDG_STATE_HOME to record owned simulators"))?;
    Ok(root.join("snapback4/witness/simulators"))
}

fn remember(preparation: &mut Value, selected: Value) -> Value {
    preparation["udid"] = selected["udid"].clone();
    preparation["runtime"] = selected["runtime"].clone();
    preparation["simulator"] = selected.clone();
    selected
}

fn iphone_rank(kind: &Value) -> Option<(u32, bool, bool, &str)> {
    let model = kind["identifier"].as_str()?.rsplit("iPhone-").next()?;
    let digits = &model[..model.bytes().take_while(|b| b.is_ascii_digit()).count()];
    Some((digits.parse().ok()?, model == digits, model[digits.len()..].starts_with("-Pro"), model))
}

// @ref LLP 3000.030#13 — numbered generations rank numerically; unnumbered models use runtime order.
fn device_type<'a>(types: &'a [Value], supported: Option<&[Value]>) -> Option<&'a Value> {
    let candidates: Vec<_> = types.iter().enumerate().filter_map(|(index, kind)| {
        if kind["productFamily"] != "iPhone" || kind["identifier"].as_str().is_none() { return None; }
        let order = match supported {
            Some(types) => types.iter().position(|t| t["identifier"] == kind["identifier"])?,
            None => index,
        };
        Some((order, kind))
    }).collect();
    let numbered = candidates.iter().filter_map(|&(order, kind)| iphone_rank(kind).map(|rank| (rank, order, kind)))
        .max_by_key(|(rank, _, _)| *rank).map(|(_, order, kind)| (order, kind));
    // Compare only the best numbered model with unnumbered models. Mixing
    // numeric and ordinal pairwise comparisons would not define a total order.
    numbered.into_iter().chain(candidates.into_iter().filter(|(_, kind)| iphone_rank(kind).is_none()))
        .max_by_key(|(order, _)| *order).map(|(_, kind)| kind)
}

pub(super) fn select(options: &Options, preparation: &mut Value) -> Result<(Value, File)> {
    let runtimes = list("runtimes", options.timeout, preparation)?;
    let mut available: Vec<_> = runtimes["runtimes"].as_array().into_iter().flatten()
        .filter(|r| r["isAvailable"] == true && r["identifier"].as_str().is_some_and(|id| id.starts_with("com.apple.CoreSimulator.SimRuntime.iOS-"))).collect();
    if available.is_empty() { return environment(Err(error("E_WITNESS_PLATFORM", SETUP)), preparation, "missing-runtime"); }
    available.sort_by_key(|r| std::cmp::Reverse(version(r["version"].as_str().unwrap_or_default())));
    let devices = list("devices", options.timeout, preparation)?;
    let mut owners = ownership::Records::open(owners()?);
    if let Some(id) = &options.udid {
        let (udid, runtime) = device(&devices, Some(id))?;
        if !available.iter().any(|r| r["identifier"] == runtime) { return Err(error("E_WITNESS_SIMULATOR", "the requested device's iOS runtime is unavailable")); }
        let d = devices["devices"][&runtime].as_array().unwrap().iter().find(|d| d["udid"] == udid).unwrap();
        let lease = owners.lease(&udid)?;
        return Ok((remember(preparation, json!({ "udid": udid, "name": d["name"], "runtime": runtime, "selection": "explicit" })), lease));
    }
    // A shared-host lane may opt into its own namespace. No unrelated device is
    // booted, installed, shut down or deleted by automatic selection.
    let prefix = std::env::var("SNAPBACK4_SMOKE_DEVICE_PREFIX").unwrap_or_else(|_| "snapback4-smoke-".into());
    if !name(&prefix) || !prefix.ends_with('-') { return Err(error("E_WITNESS_INPUT", "SNAPBACK4_SMOKE_DEVICE_PREFIX must be a nonempty name ending in '-'")); }
    for runtime in &available {
        if background::active() { break; }
        let runtime = runtime["identifier"].as_str().unwrap();
        for d in devices["devices"][runtime].as_array().into_iter().flatten() {
            let Some(udid) = d["udid"].as_str().filter(|id| name(id)) else { continue; };
            let owned = owners.read(udid);
            if d["state"] == "Booted" && d["isAvailable"] == true
                && d["name"].as_str().is_some_and(|n| n.starts_with(&prefix))
                && owned["udid"] == udid && owned["name"] == d["name"]
                && owned["runtime"] == runtime && owned["prefix"] == prefix && owned["ready"] == true {
                let lease = owners.lease(udid)?;
                // Re-read under the lease: boot/rollback may have changed the
                // creation record after the simulator list was sampled.
                let current = owners.read(udid);
                if current != owned || current["ready"] != true { continue; }
                return Ok((remember(preparation, json!({ "udid": udid, "name": d["name"], "runtime": runtime, "selection": "reused", "prefix": prefix })), lease));
            }
        }
    }
    let runtime = available[0];
    let types = list("devicetypes", options.timeout, preparation)?;
    let kind = environment(device_type(types["devicetypes"].as_array().map(Vec::as_slice).unwrap_or_default(),
        runtime["supportedDeviceTypes"].as_array().map(Vec::as_slice))
        .ok_or_else(|| error("E_WITNESS_PLATFORM", SETUP)), preparation, "missing-device-type")?;
    owners.prepare()?;
    let name = format!("{prefix}{}-{}", now(), std::process::id());
    let runtime = runtime["identifier"].as_str().unwrap();
    let intent = json!({ "name": name, "runtime": runtime, "prefix": prefix, "selection": "created", "ready": false });
    recovery::simulator(options, &intent)?;
    let (printed, created) = create(&["create", &name, kind["identifier"].as_str().unwrap(), runtime], options);
    let udid = match created_udid(&printed) { Some(id) => id.to_owned(), None => reconcile_created(&intent)?.unwrap_or_default() };
    if udid.is_empty() {
        // A timeout is never an environment skip, even without an identifier.
        created?;
        return Err(error("E_WITNESS_SIMULATOR", "simctl create returned no device identifier"));
    }
    let lease = owners.lease(&udid)?;
    let mut selected = remember(preparation, json!({ "udid": udid, "name": name, "runtime": runtime, "selection": "created", "prefix": prefix, "ready": false }));
    if let Err(problem) = recovery::simulator(options, &selected) {
        delete_created(&udid, &lease, preparation)?; return Err(problem);
    }
    if let Err(problem) = owners.write(&udid, &selected) {
        delete_created(&udid, &lease, preparation)?;
        return Err(problem);
    }
    eprintln!("witness: created simulator {name} ({udid}), runtime {runtime}");
    let boot = created.and_then(|_| interrupted()).and_then(|_| simctl(&["boot", &udid], options.timeout))
        .and_then(|_| simctl(&["bootstatus", &udid, "-b"], options.timeout));
    if let Err(problem) = boot {
        delete_created(&udid, &lease, preparation)?;
        owners.remove(&udid)?;
        // Only boot environment errors can skip. Create timeout/failure with a
        // printed identity and cancellation are failures, after rollback.
        if problem.contains("simctl create") { return Err(problem); }
        return environment(Err(problem), preparation, "simulator-boot");
    }
    selected["ready"] = json!(true);
    if let Err(problem) = owners.ready(&udid, &selected) {
        delete_created(&udid, &lease, preparation)?;
        owners.remove(&udid)?;
        return Err(problem);
    }
    remember(preparation, selected.clone());
    Ok((selected, lease))
}

// Creation is isolated from the terminal process group. Always collect its
// output, including after nonzero exit, timeout and cancellation, before rollback.
fn create(args: &[&str], options: &Options) -> (String, Result<()>) {
    use std::os::unix::process::CommandExt;
    let stdout = options.artifacts.join("simulator-create.stdout");
    let result = (|| -> Result<()> {
        let mut command = Command::new("xcrun");
        command.arg("simctl").args(args).stdin(Stdio::null())
            .stdout(File::create(&stdout).map_err(|e| error("E_WITNESS_ARTIFACT", e))?)
            .stderr(output(&options.artifacts.join("simulator-create.stderr"))?);
        if !background::active() { command.process_group(0); }
        let mut child = Owned::spawn(&mut command)?;
        recovery::child(options, "create", child.0.id())?;
        let end = Instant::now() + options.timeout;
        loop {
            if let Some(status) = child.status()? {
                if !status.success() { return Err(error("E_WITNESS_SIMULATOR", "simctl create failed; rolling back any printed device identifier")); }
                return Ok(());
            }
            if Instant::now() >= end {
                // Own this child's group, not the terminal's. Keep its leader
                // unreaped until the signal has been sent.
                let pid = child.0.id() as i32;
                unsafe { libc::kill(if background::active() { pid } else { -pid }, libc::SIGKILL); }
                let _ = child.0.wait();
                return Err(error("E_WITNESS_TIMEOUT", "simctl create timed out; rolling back any printed device identifier"));
            }
            sleep(Duration::from_millis(50));
        }
    })();
    (fs::read_to_string(stdout).unwrap_or_default(), result)
}
