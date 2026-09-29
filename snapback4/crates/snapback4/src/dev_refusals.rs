//! Local developer evidence, deliberately absent from all HTTP envelopes.
// @ref LLP 3000.015#2.1 — dev only; bounded asynchronous evidence scoped to one live store/instance.
use serde_json::{Value, json};
use std::{collections::{BTreeMap, VecDeque}, fs::{self, File}, io::Write, path::{Path, PathBuf}, sync::{Arc, atomic::{AtomicUsize, AtomicU64, Ordering}, mpsc::{self, SyncSender}}};

#[path = "dev_refusal_response.rs"]
pub(super) mod response;
#[path = "dev_refusal_watermark.rs"]
mod watermark;
pub(super) type Sites = BTreeMap<(String, String), String>;

pub(crate) const DIRECTORY: &str = "dev-refusals";
const LIMIT: usize = 32;
const SCOPE: &str = "Refusals of mutations, queries, asset requests and jobs. Visibility filtering in sync and reads is not recorded; inspect `snapback4 why TABLE` for read rules and sync residency, and `snapback4 guide rules`. Proven no-candidate reads stay here silently unless dev --log-empty-reads is set. Other empty query results use EMPTY_READ cause=unrecorded: no probe miss and no rule cause were recorded. Neither proves denial. Each record describes only its named operation and request or job at the recorded Unix time in milliseconds, not a later sync or read.";
#[derive(Default, Clone)]
pub(super) struct Recent {
    sender: Option<SyncSender<Value>>,
    dropped: Arc<AtomicUsize>,
    requests: Arc<AtomicU64>,
    watermark: Option<Arc<watermark::Watermark>>,
}
impl Recent {
    pub fn start(project: &Path, store: &str, address: std::net::SocketAddr, log_empty_reads: bool) -> Result<Self, String> {
        if !component(store) { return Err("invalid store identity for dev evidence".into()); }
        let now = snapback4_core::now_ms();
        let instance = snapback4_core::ids::mint(now, &mut 0).map_err(|e| e.to_string())?;
        let dir = project.join(".snapback4").join(DIRECTORY).join(store);
        snapback4_core::private_fs::directory(&dir).map_err(|e| e.to_string())?;
        let identity = json!({"storeId":store,"instance":instance,"pid":std::process::id(),"address":address.to_string(),"startedAt":now});
        let path = dir.join(format!("{instance}.json"));
        let watermark = Arc::new(watermark::Watermark::create(&path.with_extension("watermark")).map_err(|e| e.to_string())?);
        let mut active = private_file(&path.with_extension("lock")).map_err(|e| e.to_string())?;
        active.lock().map_err(|e| e.to_string())?;
        active.write_all(identity.to_string().as_bytes()).map_err(|e| e.to_string())?;
        save(&path, &identity, &VecDeque::new(), 0).map_err(|e| e.to_string())?;
        let (sender, receiver) = mpsc::sync_channel::<Value>(LIMIT);
        let dropped = Arc::new(AtomicUsize::new(0));
        let writer_dropped = dropped.clone();
        std::thread::Builder::new().name("dev-refusals".into()).spawn(move || {
            // Holding this lock, not a PID or an old timestamp, proves liveness.
            let _active = active;
            let mut records = VecDeque::new();
            for record in receiver {
                let at = records.iter().position(|r: &Value| r["responseSequence"].as_u64() > record["responseSequence"].as_u64()).unwrap_or(records.len());
                records.insert(at, record.clone());
                if records.len() > LIMIT { records.pop_front(); }
                if let Err(error) = save(&path, &identity, &records, writer_dropped.load(Ordering::Relaxed)) {
                    let _ = writeln!(std::io::stderr().lock(), "dev refusal: could not save local record: {error}");
                }
                if record["cause"] == "no-candidate" && !log_empty_reads { continue; }
                let r = &record;
                let _ = writeln!(std::io::stderr().lock(), "dev refusal: {}: {} — {} at {}; execution site {}; store {}; instance {}; code {} cause={}; request {}; job {}; time {}; response {}; `snapback4 why recent --instance {}`",
                    r["operation"].as_str().unwrap_or(""), r["table"].as_str().unwrap_or(""), r["clause"].as_str().unwrap_or(""), r["site"].as_str().unwrap_or("<generated>"), r["executionSite"], identity["storeId"], identity["instance"], r["code"].as_str().unwrap_or(""), r["cause"].as_str().unwrap_or("rule"), r["requestId"], r["jobId"], r["at"], r["responseSequence"], identity["instance"].as_str().unwrap());
            }
        }).map_err(|e| e.to_string())?;
        Ok(Self { sender: Some(sender), dropped, requests: Default::default(), watermark: Some(watermark) })
    }
    fn sequence(&self, mut record: Value) -> Value {
        record["responseSequence"] = json!(self.watermark.as_ref().map_or(0, |w| w.next()));
        record
    }
    /// A parked chunk is a terminal refusal without an HTTP refusal envelope.
    /// Called only by dev maintenance after releasing the engine guard.
    pub(super) fn job(&self, run: &snapback4_core::JobRun) {
        if self.sender.is_none() { return; }
        let code = run.error.as_deref().unwrap_or("UNKNOWN").split(':').next().unwrap_or("UNKNOWN");
        self.submit(self.sequence(json!({"operation":run.name, "jobId":run.id,
            "code":code, "clause":"cause not instrumented", "at":snapback4_core::now_ms()})));
    }
    fn submit(&self, record: Value) {
        if let Some(sender) = &self.sender {
            // A stalled disk or stderr must never stall a request or grow memory.
            if sender.try_send(record).is_err() { self.dropped.fetch_add(1, Ordering::Relaxed); }
        }
    }
}

fn private_file(path: &Path) -> std::io::Result<File> {
    let mut options = fs::OpenOptions::new(); options.write(true).read(true).create_new(true);
    #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
    options.open(path)
}
fn save(path: &Path, identity: &Value, records: &VecDeque<Value>, dropped: usize) -> std::io::Result<()> {
    let temp = path.with_extension("tmp");
    // This instance has one writer. A leftover replacement must not wedge it;
    // unlinking also avoids following a stale symlink when opening the new file.
    match fs::remove_file(&temp) { Ok(()) => {}, Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}, Err(e) => return Err(e) }
    let mut file = private_file(&temp)?;
    let mut envelope = identity.clone();
    envelope["scope"] = json!(SCOPE);
    envelope["records"] = json!(records);
    envelope["dropped"] = json!(dropped);
    let result = (|| { file.write_all(serde_json::to_string_pretty(&envelope)?.as_bytes())?; fs::rename(&temp, path) })();
    if result.is_err() { let _ = fs::remove_file(temp); }
    result
}
fn component(s: &str) -> bool { !s.is_empty() && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') }

/// Only locked, identity-matching streams belong to a currently running dev.
/// Legacy project-global records and stopped processes are never selected.
pub(crate) fn recent(data: &Path, store: Option<&str>, instance: Option<&str>) -> Result<Value, String> {
    let root = data.join(DIRECTORY);
    let mut candidates: Vec<(PathBuf, Value, File)> = Vec::new();
    if root.is_dir() {
        for directory in fs::read_dir(root).map_err(|e| e.to_string())? {
            let directory = directory.map_err(|e| e.to_string())?;
            let store_id = directory.file_name().to_string_lossy().into_owned();
            if !component(&store_id) || store.is_some_and(|s| s != store_id) || !directory.path().is_dir() { continue; }
            for entry in fs::read_dir(directory.path()).map_err(|e| e.to_string())? {
                let path = entry.map_err(|e| e.to_string())?.path();
                if path.extension().and_then(|s| s.to_str()) != Some("lock") { continue; }
                let id = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
                if !component(id) || instance.is_some_and(|s| s != id) { continue; }
                let active = File::open(&path).map_err(|e| e.to_string())?;
                match active.try_lock_shared() {
                    Ok(()) => continue,
                    Err(fs::TryLockError::WouldBlock) => {},
                    Err(e) => return Err(e.to_string()),
                }
                let identity: Value = serde_json::from_reader(&active).map_err(|e| e.to_string())?;
                if identity["storeId"] != store_id || identity["instance"] != id { return Err("mismatched dev instance identity".into()); }
                candidates.push((path.with_extension("json"), identity, active));
            }
        }
    }
    if candidates.len() != 1 {
        return Err(if candidates.is_empty() { "No live matching dev instance. Run snapback4 dev and reproduce the refusal; stale records are not selected.".into() }
            else { format!("Multiple live dev instances; select `why recent --instance ID` (optionally --store ID): {}", candidates.iter().map(|(_,id,_)| id.to_string()).collect::<Vec<_>>().join(", ")) });
    }
    let (path, identity, active) = candidates.pop().unwrap();
    let envelope: Value = serde_json::from_reader(File::open(&path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let records = envelope["records"].as_array().ok_or("invalid dev refusal records")?;
    if !identity.as_object().ok_or("invalid dev identity")?.iter().all(|(key, value)| envelope.get(key) == Some(value))
        || records.len() > LIMIT || records.iter().any(|r| r["at"].as_i64().is_none_or(|t| t < identity["startedAt"].as_i64().unwrap_or(i64::MAX))) {
        return Err("stale or mismatched dev refusal records".into());
    }
    let latest = watermark::Watermark::open(&path.with_extension("watermark")).map_err(|e| e.to_string())?.load();
    let persisted = records.last().and_then(|r| r["responseSequence"].as_u64()).unwrap_or(0);
    if latest != persisted {
        return Err(format!("Latest refusal evidence pending or dropped (response {latest}, persisted {persisted}); older records are not its cause. Retry after the dev writer recovers or reproduce the request."));
    }
    if !matches!(active.try_lock_shared(), Err(fs::TryLockError::WouldBlock)) { return Err("dev instance stopped while reading records".into()); }
    Ok(envelope)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn late_handoff_cannot_replace_a_newer_response() {
        let path = std::env::temp_dir().join(format!("sb4-response-order-{}-{}", std::process::id(), snapback4_core::now_ms()));
        fs::create_dir_all(&path).unwrap();
        let stream = Recent::start(&path, "store", "127.0.0.1:0".parse().unwrap(), false).unwrap();
        let first = stream.watermark.as_ref().unwrap().next();
        let second = stream.watermark.as_ref().unwrap().next();
        for (sequence, operation) in [(second, "newer"), (first, "older")] {
            stream.submit(json!({"operation":operation,"code":"E_RULE","clause":"cause not instrumented","requestId":sequence,"responseSequence":sequence,"at":snapback4_core::now_ms()}));
        }
        let end = std::time::Instant::now() + std::time::Duration::from_secs(10);
        loop {
            if let Ok(snapshot) = recent(&path.join(".snapback4"), None, None)
                && snapshot["records"].as_array().unwrap().len() == 2 {
                assert_eq!(snapshot["records"][0]["operation"], "older");
                assert_eq!(snapshot["records"][1]["operation"], "newer");
                break;
            }
            assert!(std::time::Instant::now() < end);
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        drop(stream);
        fs::remove_dir_all(path).unwrap();
    }
}
