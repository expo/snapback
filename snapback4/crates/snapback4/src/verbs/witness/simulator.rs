//! @ref LLP 3000.030#13 — automatic selection requires persisted creation evidence, never a name alone.
use super::*;

const SETUP: &str = "native smoke needs Xcode and an iOS simulator runtime; install Xcode, open Settings > Components to install iOS, then retry (set DEVELOPER_DIR to Xcode.app/Contents/Developer if needed)";

fn list(kind: &str, timeout: Duration) -> Result<Value> {
    let output = simctl(&["list", kind, "--json"], timeout).map_err(|e| {
        if e.starts_with("E_WITNESS_INTERRUPTED") || e.starts_with("E_WITNESS_TIMEOUT") { e }
        else { error("E_WITNESS_PLATFORM", SETUP) }
    })?;
    serde_json::from_str(&output).map_err(|_| error("E_WITNESS_SIMULATOR", "simctl returned invalid JSON"))
}

fn version(text: &str) -> Vec<u32> {
    text.split(['.', '-']).map(|p| p.parse().unwrap_or(0)).collect()
}

fn owners() -> Result<PathBuf> {
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

pub(super) fn select(options: &Options, preparation: &mut Value) -> Result<Value> {
    let runtimes = list("runtimes", options.timeout)?;
    let mut available: Vec<_> = runtimes["runtimes"].as_array().into_iter().flatten()
        .filter(|r| r["isAvailable"] == true && r["identifier"].as_str().is_some_and(|id| id.starts_with("com.apple.CoreSimulator.SimRuntime.iOS-"))).collect();
    if available.is_empty() { return Err(error("E_WITNESS_PLATFORM", SETUP)); }
    available.sort_by_key(|r| std::cmp::Reverse(version(r["version"].as_str().unwrap_or_default())));
    let devices = list("devices", options.timeout)?;
    if let Some(id) = &options.udid {
        let (udid, runtime) = device(&devices, Some(id))?;
        if !available.iter().any(|r| r["identifier"] == runtime) { return Err(error("E_WITNESS_SIMULATOR", "the requested device's iOS runtime is unavailable")); }
        let d = devices["devices"][&runtime].as_array().unwrap().iter().find(|d| d["udid"] == udid).unwrap();
        return Ok(remember(preparation, json!({ "udid": udid, "name": d["name"], "runtime": runtime, "selection": "explicit" })));
    }
    // A shared-host lane may opt into its own namespace. No unrelated device is
    // booted, installed, shut down or deleted by automatic selection.
    let prefix = std::env::var("SNAPBACK4_SMOKE_DEVICE_PREFIX").unwrap_or_else(|_| "snapback4-smoke-".into());
    if !name(&prefix) || !prefix.ends_with('-') { return Err(error("E_WITNESS_INPUT", "SNAPBACK4_SMOKE_DEVICE_PREFIX must be a nonempty name ending in '-'")); }
    let mut owners = ownership::Records::open(owners()?);
    for runtime in &available {
        let runtime = runtime["identifier"].as_str().unwrap();
        for d in devices["devices"][runtime].as_array().into_iter().flatten() {
            let Some(udid) = d["udid"].as_str().filter(|id| name(id)) else { continue; };
            let owned = owners.read(udid);
            if d["state"] == "Booted" && d["isAvailable"] == true
                && d["name"].as_str().is_some_and(|n| n.starts_with(&prefix))
                && owned["udid"] == udid && owned["name"] == d["name"]
                && owned["runtime"] == runtime && owned["prefix"] == prefix {
                return Ok(remember(preparation, json!({ "udid": udid, "name": d["name"], "runtime": runtime, "selection": "reused", "prefix": prefix })));
            }
        }
    }
    let runtime = available[0];
    let types = list("devicetypes", options.timeout)?;
    let supported = runtime["supportedDeviceTypes"].as_array();
    let kind = types["devicetypes"].as_array().into_iter().flatten().filter(|d| {
        d["productFamily"] == "iPhone" && d["identifier"].as_str().is_some()
            && supported.is_none_or(|s| s.iter().any(|t| t["identifier"] == d["identifier"]))
    }).max_by_key(|d| {
        // Prefer the newest numbered standard iPhone, then its Pro variants;
        // simctl's list order is not a device-generation ordering.
        let model = d["identifier"].as_str().unwrap().rsplit("iPhone-").next().unwrap();
        let generation = model.split('-').next().unwrap().parse::<u32>().unwrap_or(0);
        (generation, model == generation.to_string(), model.to_owned())
    }).ok_or_else(|| error("E_WITNESS_PLATFORM", SETUP))?;
    owners.prepare()?;
    let name = format!("{prefix}{}-{}", now(), std::process::id());
    let runtime = runtime["identifier"].as_str().unwrap();
    let udid = simctl(&["create", &name, kind["identifier"].as_str().unwrap(), runtime], options.timeout)?;
    if !super::name(&udid) { return Err(error("E_WITNESS_SIMULATOR", "simctl create returned no device identifier")); }
    // Record structured cleanup identity before any fallible persistence/boot step.
    let selected = remember(preparation, json!({ "udid": udid, "name": name, "runtime": runtime, "selection": "created", "prefix": prefix }));
    owners.write(&udid, &selected)?;
    eprintln!("witness: created simulator {name} ({udid}), runtime {runtime}");
    simctl(&["boot", &udid], options.timeout)?;
    simctl(&["bootstatus", &udid, "-b"], options.timeout)?;
    Ok(selected)
}
