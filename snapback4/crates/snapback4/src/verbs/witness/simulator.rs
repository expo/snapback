//! @ref LLP 3000.030#13 — automatic selection owns a name prefix, never `booted`.
use super::*;

const SETUP: &str = "native smoke needs Xcode and an iOS simulator runtime; install Xcode, open Settings > Components to install iOS, then retry (set DEVELOPER_DIR to Xcode.app/Contents/Developer if needed)";

fn list(kind: &str, timeout: Duration) -> Result<Value> {
    let output = simctl(&["list", kind, "--json"], timeout).map_err(|e| {
        if e.starts_with("E_WITNESS_INTERRUPTED") || e.starts_with("E_WITNESS_TIMEOUT") { e }
        else { error("E_WITNESS_PLATFORM", SETUP) }
    })?;
    serde_json::from_str(&output).map_err(|_| error("E_WITNESS_SIMULATOR", "simctl returned invalid JSON"))
}

pub(super) fn select(options: &Options) -> Result<Value> {
    let runtimes = list("runtimes", options.timeout)?;
    let available: Vec<_> = runtimes["runtimes"].as_array().into_iter().flatten()
        .filter(|r| r["isAvailable"] == true && r["identifier"].as_str().is_some_and(|id| id.starts_with("com.apple.CoreSimulator.SimRuntime.iOS-"))).collect();
    if available.is_empty() { return Err(error("E_WITNESS_PLATFORM", SETUP)); }
    let devices = list("devices", options.timeout)?;
    if let Some(id) = &options.udid {
        let (udid, runtime) = device(&devices, Some(id))?;
        if !available.iter().any(|r| r["identifier"] == runtime) { return Err(error("E_WITNESS_SIMULATOR", "the requested device's iOS runtime is unavailable")); }
        let d = devices["devices"][&runtime].as_array().unwrap().iter().find(|d| d["udid"] == udid).unwrap();
        return Ok(json!({ "udid": udid, "name": d["name"], "runtime": runtime, "selection": "explicit" }));
    }
    // A shared-host lane may opt into its own namespace. No unrelated device is
    // booted, installed, shut down or deleted by automatic selection.
    let prefix = std::env::var("SNAPBACK4_SMOKE_DEVICE_PREFIX").unwrap_or_else(|_| "snapback4-smoke-".into());
    if !name(&prefix) || !prefix.ends_with('-') { return Err(error("E_WITNESS_INPUT", "SNAPBACK4_SMOKE_DEVICE_PREFIX must be a nonempty name ending in '-'")); }
    if let Some(groups) = devices["devices"].as_object() {
        for (runtime, rows) in groups {
            if !available.iter().any(|r| r["identifier"] == *runtime) { continue; }
            for d in rows.as_array().into_iter().flatten() {
                if d["state"] == "Booted" && d["isAvailable"] == true
                    && d["udid"].as_str().is_some() && d["name"].as_str().is_some_and(|n| n.starts_with(&prefix)) {
                    return Ok(json!({ "udid": d["udid"], "name": d["name"], "runtime": runtime, "selection": "reused", "prefix": prefix }));
                }
            }
        }
    }
    let version = |r: &&Value| r["version"].as_str().unwrap_or_default().split('.').map(|p| p.parse::<u32>().unwrap_or(0)).collect::<Vec<_>>();
    let runtime = available.into_iter().max_by_key(version).unwrap();
    let types = list("devicetypes", options.timeout)?;
    let supported = runtime["supportedDeviceTypes"].as_array();
    let kind = types["devicetypes"].as_array().into_iter().flatten().rev().find(|d| {
        d["productFamily"] == "iPhone" && d["identifier"].as_str().is_some()
            && supported.is_none_or(|s| s.iter().any(|t| t["identifier"] == d["identifier"]))
    }).ok_or_else(|| error("E_WITNESS_PLATFORM", SETUP))?;
    let name = format!("{prefix}{}-{}", now(), std::process::id());
    let runtime = runtime["identifier"].as_str().unwrap();
    let udid = simctl(&["create", &name, kind["identifier"].as_str().unwrap(), runtime], options.timeout)?;
    if udid.is_empty() { return Err(error("E_WITNESS_SIMULATOR", "simctl create returned no device identifier")); }
    // Keep this identity visible even if boot fails. The tool retains its device
    // for later warm runs; callers may delete this exact UDID when finished.
    eprintln!("witness: created simulator {name} ({udid}), runtime {runtime}");
    simctl(&["boot", &udid], options.timeout)?;
    simctl(&["bootstatus", &udid, "-b"], options.timeout)?;
    Ok(json!({ "udid": udid, "name": name, "runtime": runtime, "selection": "created", "prefix": prefix }))
}
