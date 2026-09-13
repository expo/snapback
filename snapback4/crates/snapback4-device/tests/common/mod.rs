//! What every device test needs: a chat server in memory, its pages as the
//! wire sends them, and the two hosts a device runs on — the core's
//! SQLite in a directory, and memory with the host keeping each commit's
//! changes, the way the web does — so one suite proves both.
#![allow(dead_code)]

use snapback4_core::engine::{Context, Engine};
use snapback4_core::error::RuntimeError;
use snapback4_core::value::Value;
use snapback4_device::device::{Backend, Device, StreamPage};
use snapback4_device::memory::{Change, MemoryStore};
use snapback4_device::store::DeviceStore;
use std::collections::BTreeMap;

pub const CHAT: &str = include_str!("../../../../apps/chat/snapback/schema.q");

pub fn id(s: &str) -> Value {
    Value::Id(s.into())
}

pub fn args(pairs: &[(&str, Value)]) -> BTreeMap<String, Value> {
    pairs.iter().map(|(k, v)| ((*k).to_owned(), v.clone())).collect()
}

pub fn compile(source: &str) -> (Engine, Backend) {
    let bound = snapback4_lang::compile(&[("schema.q".to_owned(), source.to_owned())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let engine = Engine::memory(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())).unwrap();
    let backend = Backend { generation: engine.generation(), schema: bound.schema, programs: bound.programs.into_iter().map(|p| p.program).collect() };
    (engine, backend)
}

/// The chat server with one conversation, two members, 120 messages.
pub fn server() -> (Engine, Backend) {
    let (mut engine, backend) = compile(CHAT);
    let mut rows = vec![("conversations".to_owned(), snapback4_core::value::object([("id", id("c1")), ("title", Value::String("General".into())), ("creatorId", id("dev:alice"))]))];
    for (n, member) in ["dev:alice", "dev:bob"].iter().enumerate() {
        rows.push(("memberships".to_owned(), snapback4_core::value::object([("id", id(&format!("m{n}"))), ("conversationId", id("c1")), ("principal", id(member)), ("role", Value::String(if n == 0 { "admin".into() } else { "member".into() })), ("joinedAt", Value::Int(n as i64))])));
    }
    for n in 0..120 {
        rows.push(("messages".to_owned(), snapback4_core::value::object([("id", id(&format!("msg{n:03}"))), ("conversationId", id("c1")), ("authorId", id(if n % 2 == 1 { "dev:alice" } else { "dev:bob" })), ("body", Value::String(format!("m{n}"))), ("at", Value::Int(1_000 + n))])));
    }
    engine.seed(rows).unwrap();
    let backend = Backend { generation: engine.generation(), ..backend };
    (engine, backend)
}

/// A `/sync` snapshot, as the wire sends it, from the engine.
pub fn snapshot_pages(engine: &mut Engine, principal: &str, limit: usize) -> Vec<StreamPage> {
    let mut pages = Vec::new();
    let mut after: Option<String> = None;
    loop {
        let (events, watermark, next) = engine.snapshot_page(principal, after.as_deref(), limit).unwrap();
        let more = next.is_some();
        pages.push(serde_json::from_value(serde_json::json!({
            "snapshot": true,
            "events": events.iter().map(|e| serde_json::json!({ "table": e.table, "kind": e.kind.word(), "id": e.id, "data": e.data.as_ref().map(snapback4_core::wire::to_json) })).collect::<Vec<_>>(),
            "watermark": watermark, "more": more, "next": next, "generation": engine.generation(),
        })).unwrap());
        match next {
            Some(next) => after = Some(next),
            None => return pages,
        }
    }
}

pub fn stream_page(engine: &mut Engine, principal: &str, watermark: u64) -> StreamPage {
    let page = engine.stream(principal, watermark, 1_000).unwrap();
    serde_json::from_value(serde_json::json!({
        "snapshot": false,
        "events": page.events.iter().map(|e| serde_json::json!({ "table": e.table, "kind": e.kind, "id": e.id, "data": e.data.as_ref().map(snapback4_core::wire::to_json) })).collect::<Vec<_>>(),
        "watermark": page.watermark, "more": page.more, "generation": engine.generation(),
    })).unwrap()
}

pub fn page_json(page: &StreamPage) -> serde_json::Value {
    serde_json::json!({ "snapshot": page.snapshot, "events": page.events.iter().map(|e| serde_json::json!({ "table": e.table, "kind": e.kind, "id": e.id, "data": e.data })).collect::<Vec<_>>(), "watermark": page.watermark, "more": page.more, "next": page.next, "generation": page.generation })
}

pub fn context(principal: &str, pairs: &[(&str, Value)]) -> Context {
    Context::new(principal, args(pairs))
}

/// A host: where devices live between opens. `open` gives a device on the
/// named store; `close` gives it back so the next `open` finds what it kept.
pub trait Host {
    type Store: DeviceStore;
    fn open(&mut self, name: &str, backend: Option<Backend>) -> Result<Device<Self::Store>, RuntimeError>;
    fn close(&mut self, name: &str, device: Device<Self::Store>);
    fn label(&self) -> &'static str;
}

/// The core's SQLite in a temporary directory.
pub struct Sqlite {
    pub dir: std::path::PathBuf,
}

impl Sqlite {
    pub fn new(tag: &str) -> Self {
        static OPENED: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let n = OPENED.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("sb4-device-{tag}-{}-{nonce}-{n}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        Self { dir }
    }
    pub fn path(&self, name: &str) -> std::path::PathBuf {
        self.dir.join(format!("{name}.sqlite"))
    }
}

impl Drop for Sqlite {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

impl Host for Sqlite {
    type Store = snapback4_core::store::Store;
    fn open(&mut self, name: &str, backend: Option<Backend>) -> Result<Device<Self::Store>, RuntimeError> {
        Device::open(&self.path(name), backend)
    }
    fn close(&mut self, _name: &str, device: Device<Self::Store>) {
        drop(device);
    }
    fn label(&self) -> &'static str {
        "sqlite"
    }
}

/// Memory, with the host keeping each commit's changes as the web does:
/// closing drains them into what it holds, opening hands them back.
#[derive(Default)]
pub struct Memory {
    kept: BTreeMap<String, Vec<Change>>,
}

impl Memory {
    pub fn new() -> Self {
        Self::default()
    }
    /// What the host holds for one store, folded: the latest value per key.
    pub fn held(&self, name: &str) -> BTreeMap<(char, String), Option<String>> {
        let mut folded = BTreeMap::new();
        for change in self.kept.get(name).into_iter().flatten() {
            folded.insert((change.s, change.k.clone()), change.v.clone());
        }
        folded
    }
}

impl Host for Memory {
    type Store = MemoryStore;
    fn open(&mut self, name: &str, backend: Option<Backend>) -> Result<Device<Self::Store>, RuntimeError> {
        let mut store = MemoryStore::new();
        store.load(self.kept.get(name).cloned().unwrap_or_default())?;
        Device::open_store(store, backend)
    }
    fn close(&mut self, name: &str, device: Device<Self::Store>) {
        self.kept.entry(name.to_owned()).or_default().extend(device.store().drain());
    }
    fn label(&self) -> &'static str {
        "memory"
    }
}

/// Persist what a memory device changed so far without closing it — what
/// the web host does after every call.
pub fn checkpoint(host: &mut Memory, name: &str, device: &Device<MemoryStore>) {
    host.kept.entry(name.to_owned()).or_default().extend(device.store().drain());
}
