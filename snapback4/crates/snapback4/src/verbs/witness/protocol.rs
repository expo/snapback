use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{fs, io::Read, net::{SocketAddr, TcpListener, TcpStream}, path::Path, time::{Duration, SystemTime, UNIX_EPOCH}};

pub type Result<T> = std::result::Result<T, String>;
pub fn error(code: &str, message: impl std::fmt::Display) -> String { format!("{code}: {message}") }
pub fn now() -> u128 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() }
pub fn platform(os: &str) -> Result<()> {
    if os == "macos" { Ok(()) } else { Err(error("E_WITNESS_PLATFORM", "witness ios requires macOS with Xcode and an installed iOS simulator")) }
}
pub fn name(value: &str) -> bool { !value.is_empty() && value.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') }

pub fn device(list: &Value, requested: Option<&str>) -> Result<(String, String)> {
    let mut booted = Vec::new();
    let runtimes = list["devices"].as_object().ok_or_else(|| error("E_WITNESS_SIMULATOR", "simctl returned no device list"))?;
    for (runtime, devices) in runtimes {
        for d in devices.as_array().into_iter().flatten() {
            if d["state"] == "Booted" && d["isAvailable"] != false && runtime.contains("iOS") {
                if let Some(id) = d["udid"].as_str() { booted.push((id.to_owned(), runtime.to_owned())); }
            }
        }
    }
    if let Some(id) = requested {
        return booted.into_iter().find(|(udid, _)| udid == id).ok_or_else(|| error("E_WITNESS_SIMULATOR", "--udid must select a booted, available iOS simulator; boot that device first"));
    }
    match booted.len() {
        1 => Ok(booted.remove(0)),
        0 => Err(error("E_WITNESS_SIMULATOR", "no booted iOS simulator; boot a dedicated simulator and pass --udid")),
        _ => Err(error("E_WITNESS_SIMULATOR", "more than one iOS simulator is booted; --udid is required")),
    }
}

pub fn address(port: u16) -> SocketAddr { ([127, 0, 0, 1], port).into() }
pub fn refused(port: u16) -> Result<bool> {
    match TcpStream::connect_timeout(&address(port), Duration::from_millis(200)) {
        Ok(_) => Ok(false),
        Err(e) if e.kind() == std::io::ErrorKind::ConnectionRefused => Ok(true),
        Err(_) => Err(error("E_WITNESS_BACKEND", "cannot verify connection refusal; check --port and loopback networking")),
    }
}
pub fn reserve(port: u16) -> Result<TcpListener> {
    #[cfg(test)]
    crate::host_limits::prepare_tests();
    TcpListener::bind(address(port)).map_err(|_| error("E_WITNESS_PORT", "--port is unavailable; choose a free loopback port; no existing process was stopped"))
}

/// Only complete lines are observed while the app may be appending. The
/// final artifact must end in a newline and every line must be a JSON object.
pub fn receipts(bytes: &[u8], final_file: bool) -> Result<Vec<Value>> {
    if final_file && (bytes.is_empty() || bytes.last() != Some(&b'\n')) {
        return Err(error("E_WITNESS_RECEIPT", "receipts are empty or end with an incomplete line"));
    }
    let mut rows = Vec::new();
    let mut lines = bytes.split(|b| *b == b'\n').peekable();
    while let Some(line) = lines.next() {
        if lines.peek().is_none() { break; }
        let row: Value = serde_json::from_slice(line).map_err(|_| error("E_WITNESS_RECEIPT", format!("receipt line {} is not JSON", rows.len() + 1)))?;
        if !row.is_object() { return Err(error("E_WITNESS_RECEIPT", format!("receipt line {} is not an object", rows.len() + 1))); }
        let envelope = row["witness"].as_object();
        if !envelope.is_some_and(|w| w.len() == 2 && w.get("at").and_then(Value::as_str).is_some_and(|at| timestamp(at))
            && w.get("step").and_then(Value::as_str).is_some_and(|step| name(step) || step.strip_suffix(":running").is_some_and(name) || step.strip_suffix(":failed").is_some_and(name))) {
            return Err(error("E_WITNESS_RECEIPT", format!("receipt line {} has an invalid witness envelope; expected witness: {{ at: ISO timestamp, step: name }}", rows.len() + 1)));
        }
        let step = row["witness"]["step"].as_str().unwrap();
        if step.ends_with(":failed") { return Err(error("E_WITNESS_STEP", "app step failed; check --segment and see receipts and device log")); }
        rows.push(row);
    }
    Ok(rows)
}

pub fn artifact(path: &Path) -> Result<Value> {
    let mut file = fs::File::open(path).map_err(|_| error("E_WITNESS_ARTIFACT", "missing artifact or unreadable file; check --artifacts and the recorded app outputs"))?;
    let mut digest = Sha256::new(); let mut bytes = 0_u64; let mut buffer = [0_u8; 65536];
    loop {
        let read = file.read(&mut buffer).map_err(|_| error("E_WITNESS_ARTIFACT", "cannot read artifact; check --artifacts and the recorded app outputs"))?;
        if read == 0 { break; } digest.update(&buffer[..read]); bytes += read as u64;
    }
    if bytes == 0 { return Err(error("E_WITNESS_ARTIFACT", "empty artifact; check --artifacts and the recorded app outputs")); }
    Ok(json!({ "path": path, "bytes": bytes, "sha256": format!("{:x}", digest.finalize()) }))
}


pub fn milestone(step: &str) -> bool { ["primed", "relaunch", "offline-done", "done"].contains(&step) }

// @ref LLP 3000.007#20.10 — terminal evidence is checked again after the app stops
pub fn sequence(rows: &[Value], expected: &[&str], final_file: bool) -> Result<()> {
    let mut next = 0;
    let mut done = false;
    for row in rows {
        let step = row["witness"]["step"].as_str().unwrap(); // receipts validated the envelope
        if done {
            // `between-steps` rows come only from receipt() calls, including an empty
            // receipt; any other step after `done` is a step change.
            if step != "between-steps" {
                return Err(error("E_WITNESS_STEP", "app changed step after done; check --segment protocol"));
            }
        } else if milestone(step) {
            if expected.get(next) != Some(&step) {
                return Err(error("E_WITNESS_STEP", "unexpected milestone; check --segment protocol"));
            }
            next += 1; done = step == "done";
        }
    }
    if final_file && next != expected.len() { return Err(error("E_WITNESS_STEP", "missing milestone in final receipts; check --segment protocol")); }
    Ok(())
}

pub const OUTPUTS: &[&str] = &["run.json", "screen.mp4", "receipts.jsonl", "device.log", "video.log", "launch.log", "backend.log", "backend-stdout.log", "log-stderr.log", "prime.png", "offline.png", "restart.png"];

// The marker stays with success and failure artifacts. Creating it, rather
// than checking for it, is the single winner operation across driver runs.
pub fn reserve_artifacts(dir: &Path, segment: &str) -> Result<()> {
    fs::create_dir_all(dir).map_err(|_| error("E_WITNESS_ARTIFACT", "cannot create --artifacts directory; check its parent and permissions"))?;
    let marker = dir.join(format!("{segment}-ios-reserved"));
    fs::OpenOptions::new().write(true).create_new(true).open(&marker)
        .map_err(|_| error("E_WITNESS_ARTIFACT", "cannot reserve outputs; choose a fresh writable --artifacts directory or --segment"))?;
    for suffix in OUTPUTS {
        if dir.join(format!("{segment}-ios-{suffix}")).symlink_metadata().is_ok() {
            return Err(error("E_WITNESS_ARTIFACT", "segment artifacts already exist; choose a fresh --artifacts directory or --segment"));
        }
    }
    Ok(())
}

pub fn app_pid(list: &str, bundle: &str) -> Result<Option<u32>> {
    let prefix = format!("UIKitApplication:{bundle}[");
    if !list.lines().next().is_some_and(|line| line.split_whitespace().eq(["PID", "Status", "Label"])) {
        return Err(error("E_WITNESS_APP", "cannot inspect running apps: invalid launchctl list output"));
    }
    let mut found = None;
    for line in list.lines().skip(1) {
        let fields: Vec<_> = line.split_whitespace().collect();
        if fields.len() != 3 { return Err(error("E_WITNESS_APP", "cannot inspect running apps: invalid launchctl row")); }
        if fields[2].starts_with(&prefix) && fields[0] != "-" {
            let pid = fields[0].parse::<u32>().ok().filter(|p| *p > 0).ok_or_else(|| error("E_WITNESS_APP", "invalid running app PID"))?;
            if found.replace(pid).is_some() { return Err(error("E_WITNESS_APP", "multiple running instances of the named app; quit them before starting the witness")); }
        }
    }
    Ok(found)
}


fn timestamp(at: &str) -> bool {
    let b = at.as_bytes();
    if b.len() != 24 || [4, 7, 10, 13, 16, 19, 23].into_iter().zip(b"--T::.Z").any(|(i, c)| b[i] != *c)
        || b.iter().enumerate().any(|(i, c)| ![4, 7, 10, 13, 16, 19, 23].contains(&i) && !c.is_ascii_digit()) { return false; }
    let n = |start, end| at[start..end].parse::<u32>().unwrap();
    let year = n(0, 4); let month = n(5, 7); let day = n(8, 10);
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = match month { 2 if leap => 29, 2 => 28, 4 | 6 | 9 | 11 => 30, 1 | 3 | 5 | 7 | 8 | 10 | 12 => 31, _ => 0 };
    day > 0 && day <= days && n(11, 13) < 24 && n(14, 16) < 60 && n(17, 19) < 60
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn runtime_device_refusal_names_flag_without_value() {
        let marker = "BN_PRIVATE_UDID";
        let list = json!({"devices": {"iOS": [{"udid": "ours", "state": "Booted"}]}});
        let message = device(&list, Some(marker)).unwrap_err();
        assert!(!message.contains(marker), "device refusal echoed --udid value");
        assert!(message.contains("--udid") && message.contains("booted"));
        assert_eq!(device(&list, Some("ours")).unwrap().0, "ours");
    }
    #[test]
    fn runtime_artifact_refusals_name_flags_without_values() {
        let marker = "BN_PRIVATE_ARTIFACT";
        let dir = std::env::temp_dir().join(format!("{marker}-{}", std::process::id()));
        let segment = "BN_PRIVATE_SEGMENT";
        fs::create_dir_all(&dir).unwrap();
        reserve_artifacts(&dir, segment).unwrap();
        let collision = reserve_artifacts(&dir, segment).unwrap_err();
        let missing = artifact(&dir.join(marker)).unwrap_err();
        fs::write(dir.join(marker), "").unwrap();
        let empty = artifact(&dir.join(marker)).unwrap_err();
        let invalid_dir = reserve_artifacts(&dir.join(marker), segment).unwrap_err();
        fs::remove_dir_all(&dir).unwrap();
        for message in [collision, missing, empty, invalid_dir] {
            assert!(!message.contains(marker) && !message.contains(segment), "artifact refusal echoed an argument value");
            assert!(message.contains("--artifacts"), "{message}");
        }
    }
    use serde_json::json;

    #[test]
    fn an_empty_receipt_after_done_is_accepted_and_a_step_change_is_not() {
        let rows = [json!({"witness": {"step": "offline-done"}}), json!({"witness": {"step": "done"}}), json!({"witness": {"step": "between-steps"}})];
        assert!(sequence(&rows, &["offline-done", "done"], true).is_ok());
        let changed = [json!({"witness": {"step": "offline-done"}}), json!({"witness": {"step": "done"}}), json!({"witness": {"step": "history:running"}})];
        assert!(sequence(&changed, &["offline-done", "done"], true).is_err());
    }
}
