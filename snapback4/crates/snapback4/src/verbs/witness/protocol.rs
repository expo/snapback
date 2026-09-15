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
        return booted.into_iter().find(|(udid, _)| udid == id).ok_or_else(|| error("E_WITNESS_SIMULATOR", format!("{id} is not a booted, available iOS simulator; boot that UDID first")));
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
        Err(e) => Err(error("E_WITNESS_BACKEND", format!("cannot verify port {port} refuses connections: {e}"))),
    }
}
pub fn reserve(port: u16) -> Result<TcpListener> {
    TcpListener::bind(address(port)).map_err(|e| error("E_WITNESS_PORT", format!("127.0.0.1:{port} is unavailable: {e}; choose a free --port; no existing process was stopped")))
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
        let row: Value = serde_json::from_slice(line).map_err(|e| error("E_WITNESS_RECEIPT", format!("receipt line {} is not JSON: {e}", rows.len() + 1)))?;
        if !row.is_object() { return Err(error("E_WITNESS_RECEIPT", format!("receipt line {} is not an object", rows.len() + 1))); }
        rows.push(row);
    }
    Ok(rows)
}

pub fn artifact(path: &Path) -> Result<Value> {
    let mut file = fs::File::open(path).map_err(|e| error("E_WITNESS_ARTIFACT", format!("missing artifact {}: {e}", path.display())))?;
    let mut digest = Sha256::new(); let mut bytes = 0_u64; let mut buffer = [0_u8; 65536];
    loop {
        let read = file.read(&mut buffer).map_err(|e| error("E_WITNESS_ARTIFACT", format!("{}: {e}", path.display())))?;
        if read == 0 { break; } digest.update(&buffer[..read]); bytes += read as u64;
    }
    if bytes == 0 { return Err(error("E_WITNESS_ARTIFACT", format!("empty artifact {}", path.display()))); }
    Ok(json!({ "path": path, "bytes": bytes, "sha256": format!("{:x}", digest.finalize()) }))
}
