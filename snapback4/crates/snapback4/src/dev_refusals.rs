//! Local developer evidence, deliberately absent from all HTTP envelopes.
// @ref LLP 3000.015#2.1 — dev only; bounded asynchronous evidence scoped to one live store/instance.
use super::{Shared, lock};
use snapback4_core::engine::refusal_trace::RefusalTrace;
use serde_json::{Value, json};
use std::{collections::{BTreeMap, VecDeque}, fs::{self, File}, io::Write, path::{Path, PathBuf}, sync::{Arc, atomic::{AtomicUsize, Ordering}, mpsc::{self, SyncSender}}};

pub(crate) const DIRECTORY: &str = "dev-refusals";
const LIMIT: usize = 32;
#[derive(Default)]
pub(super) struct Recent {
    sender: Option<SyncSender<Value>>,
    dropped: Arc<AtomicUsize>,
}
impl Recent {
    pub fn start(project: &Path, store: &str, address: std::net::SocketAddr) -> Result<Self, String> {
        if !component(store) { return Err("invalid store identity for dev evidence".into()); }
        let now = snapback4_core::now_ms();
        let instance = snapback4_core::ids::mint(now, &mut 0).map_err(|e| e.to_string())?;
        let dir = project.join(".snapback4").join(DIRECTORY).join(store);
        snapback4_core::private_fs::directory(&dir).map_err(|e| e.to_string())?;
        let identity = json!({"storeId":store,"instance":instance,"pid":std::process::id(),"address":address.to_string(),"startedAt":now});
        let path = dir.join(format!("{instance}.json"));
        let mut active = private_file(&path.with_extension("lock")).map_err(|e| e.to_string())?;
        active.lock().map_err(|e| e.to_string())?;
        active.write_all(identity.to_string().as_bytes()).map_err(|e| e.to_string())?;
        save(&path, &identity, &VecDeque::new(), 0).map_err(|e| e.to_string())?;
        let (sender, receiver) = mpsc::sync_channel(LIMIT);
        let dropped = Arc::new(AtomicUsize::new(0));
        let writer_dropped = dropped.clone();
        std::thread::Builder::new().name("dev-refusals".into()).spawn(move || {
            // Holding this lock, not a PID or an old timestamp, proves liveness.
            let _active = active;
            let mut records = VecDeque::new();
            for record in receiver {
                if records.len() == LIMIT { records.pop_front(); }
                records.push_back(record);
                if let Err(error) = save(&path, &identity, &records, writer_dropped.load(Ordering::Relaxed)) {
                    eprintln!("dev refusal: could not save local record: {error}");
                }
                let r = records.back().unwrap();
                eprintln!("dev refusal: {}: {} — {} at {}; execution site {}; store {}; instance {}; `snapback4 why recent --instance {}`",
                    r["operation"].as_str().unwrap_or(""), r["table"].as_str().unwrap_or(""), r["clause"].as_str().unwrap_or(""), r["site"].as_str().unwrap_or("<generated>"), r["executionSite"], identity["storeId"], identity["instance"], identity["instance"].as_str().unwrap());
            }
        }).map_err(|e| e.to_string())?;
        Ok(Self { sender: Some(sender), dropped })
    }
    fn submit(&self, record: Value) {
        if let Some(sender) = &self.sender {
            // A stalled disk or stderr must never stall a request or grow memory.
            if sender.try_send(record).is_err() { self.dropped.fetch_add(1, Ordering::Relaxed); }
        }
    }
}

pub(super) struct Capture<'a> {
    shared: &'a Shared,
    operation: &'a str,
    trace: RefusalTrace,
    sites: BTreeMap<(String, String), String>,
}
impl<'a> Capture<'a> {
    pub fn new(shared: &'a Shared, operation: &'a str) -> Option<Self> {
        if !shared.personas { return None; }
        let bound = lock(&shared.bound);
        Some(Self { shared, operation, trace: RefusalTrace::default(), sites: bound.refusal_sites.clone() })
    }
    pub fn context(&self, context: snapback4_core::Context) -> snapback4_core::Context { context.with_refusal_trace(self.trace.clone()) }
}
impl Drop for Capture<'_> {
    fn drop(&mut self) {
        let Some(cause) = self.trace.take() else { return };
        let site = self.sites.get(&(cause.table.clone(), cause.clause.clone()))
            .or_else(|| cause.clause.strip_prefix("authorization allowance (").and_then(|s| s.strip_suffix(')')).and_then(|effect| self.sites.get(&(cause.table.clone(), format!("{effect} rule")))))
            .or_else(|| self.sites.get(&(cause.table.clone(), "table".into())));
        let read_site = self.sites.get(&(cause.table.clone(), "read rule".into()));
        self.shared.refusals.submit(json!({"operation":self.operation, "table":cause.table, "clause":cause.clause,
            "site":site, "executionSite":cause.site, "readRuleSite":read_site, "generation":cause.generation,
            "at":snapback4_core::now_ms()}));
    }
}
fn private_file(path: &Path) -> std::io::Result<File> {
    let mut options = fs::OpenOptions::new(); options.write(true).read(true).create_new(true);
    #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
    options.open(path)
}
fn save(path: &Path, identity: &Value, records: &VecDeque<Value>, dropped: usize) -> std::io::Result<()> {
    let temp = path.with_extension("tmp");
    let mut file = private_file(&temp)?;
    let mut envelope = identity.clone();
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
    let envelope: Value = serde_json::from_reader(File::open(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let records = envelope["records"].as_array().ok_or("invalid dev refusal records")?;
    if !identity.as_object().ok_or("invalid dev identity")?.iter().all(|(key, value)| envelope.get(key) == Some(value))
        || records.len() > LIMIT || records.iter().any(|r| r["at"].as_i64().is_none_or(|t| t < identity["startedAt"].as_i64().unwrap_or(i64::MAX))) {
        return Err("stale or mismatched dev refusal records".into());
    }
    if !matches!(active.try_lock_shared(), Err(fs::TryLockError::WouldBlock)) { return Err("dev instance stopped while reading records".into()); }
    Ok(envelope)
}
