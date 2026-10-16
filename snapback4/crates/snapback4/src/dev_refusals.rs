//! Local developer evidence, deliberately absent from all HTTP envelopes.
// @ref LLP 3000.015#2.1 — dev only; bounded asynchronous evidence scoped to one live store/instance.
use serde_json::{Value, json};
use std::{collections::{BTreeMap, VecDeque}, fs::{self, File}, io::Write, path::{Path, PathBuf}, sync::{Arc, atomic::{AtomicBool, AtomicUsize, AtomicU64, Ordering}, mpsc::{self, SyncSender}}, time::{Duration, Instant}};

#[path = "dev_refusal_response.rs"]
pub(super) mod response;
#[path = "dev_refusal_watermark.rs"]
mod watermark;
#[path = "dev_refusal_console.rs"]
mod console;
pub(super) type Sites = BTreeMap<(String, String), String>;

pub(crate) const DIRECTORY: &str = "dev-refusals";
const LIMIT: usize = 32;
const SHUTDOWN_WAIT: Duration = Duration::from_secs(2);
enum Message { Record(Value), Shutdown(SyncSender<()>) }
const SCOPE: &str = "Refusals of mutations, queries, asset requests and jobs. Visibility filtering in sync and reads is not recorded; inspect `snapback4 why TABLE` for read rules and sync residency, and `snapback4 guide rules`. Empty query results without a known cause are silent and unrecorded by default; dev --trace-empty records EMPTY_READ only in this stream, which does not prove denial. Inspect `snapback4 why EMPTY_READ`. Each record describes only its named operation and request or job at the recorded Unix time in milliseconds, not a later sync or read.";
#[derive(Default, Clone)]
pub(super) struct Recent {
    sender: Option<SyncSender<Message>>,
    closing: Arc<AtomicBool>,
    trace_empty: bool,
    dropped: Arc<AtomicUsize>,
    requests: Arc<AtomicU64>,
    watermark: Option<Arc<watermark::Watermark>>,
}
impl Recent {
    pub fn start(project: &Path, store: &str, address: std::net::SocketAddr, trace_empty: bool, detail: bool) -> Result<Self, String> {
        Self::start_with_console(project, store, address, trace_empty, detail, Instant::now, std::io::stderr())
    }
    pub(super) fn start_with_console(
        project: &Path, store: &str, address: std::net::SocketAddr, trace_empty: bool, detail: bool,
        clock: impl Fn() -> Instant + Send + 'static, mut output: impl Write + Send + 'static,
    ) -> Result<Self, String> {
        if !component(store) { return Err("invalid store identity for dev evidence".into()); }
        let now = snapback4_core::now_ms();
        let instance = snapback4_core::ids::mint(now, &mut snapback4_core::ids::Mint::default()).map_err(|e| e.to_string())?;
        let dir = project.join(".snapback4").join(DIRECTORY).join(store);
        snapback4_core::private_fs::directory(&dir).map_err(|e| e.to_string())?;
        let identity = json!({"storeId":store,"instance":instance,"pid":std::process::id(),"address":address.to_string(),"startedAt":now,"traceEmpty":trace_empty});
        let path = dir.join(format!("{instance}.json"));
        let watermark = Arc::new(watermark::Watermark::create(&path.with_extension("watermark")).map_err(|e| e.to_string())?);
        let mut active = private_file(&path.with_extension("lock")).map_err(|e| e.to_string())?;
        active.lock().map_err(|e| e.to_string())?;
        active.write_all(identity.to_string().as_bytes()).map_err(|e| e.to_string())?;
        save(&path, &identity, &VecDeque::new(), 0).map_err(|e| e.to_string())?;
        let (sender, receiver) = mpsc::sync_channel::<Message>(LIMIT);
        let dropped = Arc::new(AtomicUsize::new(0));
        let writer_dropped = dropped.clone();
        std::thread::Builder::new().name("dev-refusals".into()).spawn(move || {
            crate::thread_priority::background();
            // Holding this lock, not a PID or an old timestamp, proves liveness.
            let _active = active;
            let mut records = VecDeque::new();
            let mut console = console::Console::with_detail(detail);
            let mut shutdown = None;
            let mut remaining = LIMIT;
            loop {
                let now = clock();
                console.flush_due(now, &identity, &mut output);
                // The marker follows already accepted records. Drain any
                // racing handoffs too, bounded by the channel capacity; held
                // requests need not release their sender clones.
                let next = if shutdown.is_some() {
                    if remaining == 0 { Err(mpsc::RecvTimeoutError::Disconnected) }
                    else { remaining -= 1; receiver.try_recv().map_err(|_| mpsc::RecvTimeoutError::Disconnected) }
                } else { receiver.recv_timeout(console.wait(now)) };
                let record = match next {
                    Ok(Message::Record(record)) => record,
                    Ok(Message::Shutdown(done)) => { shutdown = Some(done); continue; },
                    Err(mpsc::RecvTimeoutError::Timeout) => continue,
                    Err(mpsc::RecvTimeoutError::Disconnected) => {
                        console.flush_all(&identity, &mut output);
                        break;
                    }
                };
                let at = records.iter().position(|r: &Value| r["responseSequence"].as_u64() > record["responseSequence"].as_u64()).unwrap_or(records.len());
                records.insert(at, record.clone());
                if records.len() > LIMIT { records.pop_front(); }
                if let Err(error) = save(&path, &identity, &records, writer_dropped.load(Ordering::Relaxed)) {
                    console.push_at(json!({"operation":"local evidence writer", "code":"save failed",
                        "clause":error.to_string()}), clock(), &identity, &mut output);
                }
                // EMPTY_READ is requested local evidence, never a refusal line.
                if record["emptyRead"] != true {
                    console.push_at(record, clock(), &identity, &mut output);
                }
            }
            // Acknowledgement means records and console groups have been
            // flushed and the live-instance lock released. No join or sender
            // disconnection is needed, even with an outstanding held poll.
            drop(_active);
            if let Some(done) = shutdown { let _ = done.send(()); }
        }).map_err(|e| e.to_string())?;
        Ok(Self { sender: Some(sender), closing: Default::default(), trace_empty, dropped, requests: Default::default(), watermark: Some(watermark) })
    }
    /// Only the server owner calls this after stopping admission. The single
    /// deadline covers both a full queue and a blocked disk/stderr writer.
    pub(super) fn shutdown(&self) -> bool {
        let Some(sender) = &self.sender else { return true; };
        self.closing.store(true, Ordering::Release);
        let deadline = Instant::now() + SHUTDOWN_WAIT;
        let (done, completed) = mpsc::sync_channel(1);
        let mut message = Message::Shutdown(done);
        loop {
            match sender.try_send(message) {
                Ok(()) => break,
                Err(mpsc::TrySendError::Disconnected(_)) => return false,
                Err(mpsc::TrySendError::Full(pending)) => message = pending,
            }
            if Instant::now() >= deadline { return false; }
            std::thread::sleep(Duration::from_millis(1));
        }
        completed.recv_timeout(deadline.saturating_duration_since(Instant::now())).is_ok()
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
            if self.closing.load(Ordering::Acquire) || sender.try_send(Message::Record(record)).is_err() { self.dropped.fetch_add(1, Ordering::Relaxed); }
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
    fn shutdown_deadline_covers_full_queue_and_missing_acknowledgement() {
        for full in [false, true] {
            let (sender, receiver) = mpsc::sync_channel(LIMIT);
            if full { for _ in 0..LIMIT { sender.try_send(Message::Record(Value::Null)).unwrap(); } }
            let stream = Recent { sender: Some(sender), ..Default::default() };
            let began = Instant::now();
            assert!(!stream.shutdown());
            assert!(began.elapsed() >= SHUTDOWN_WAIT);
            assert!(began.elapsed() < SHUTDOWN_WAIT + Duration::from_secs(1));
            // Receiver and sender remain alive throughout the bounded wait.
            drop(receiver);
        }
    }
    #[test]
    fn late_handoff_cannot_replace_a_newer_response() {
        let path = std::env::temp_dir().join(format!("sb4-response-order-{}-{}", std::process::id(), snapback4_core::now_ms()));
        fs::create_dir_all(&path).unwrap();
        let stream = Recent::start(&path, "store", "127.0.0.1:0".parse().unwrap(), false, false).unwrap();
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
        let held = stream.clone();
        assert!(stream.shutdown());
        assert!(recent(&path.join(".snapback4"), None, None).is_err());
        drop(held);
        fs::remove_dir_all(path).unwrap();
    }
}
