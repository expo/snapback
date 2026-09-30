//! Generated cold acquisition: allocation proportions, publication and restored rows.
//! The optional private capture exercises the exact browser commands on both stores.
mod common;
use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering::Relaxed};
use std::time::Instant;
use snapback4_device::{call::call_text, device::{Backend, Device}, memory::MemoryStore, store::DeviceStore};

struct Tracked;
static LIVE: AtomicUsize = AtomicUsize::new(0);
static PEAK: AtomicUsize = AtomicUsize::new(0);
static ALLOCATED: AtomicUsize = AtomicUsize::new(0);
fn add(bytes: usize) {
    let live = LIVE.fetch_add(bytes, Relaxed) + bytes;
    PEAK.fetch_max(live, Relaxed);
    ALLOCATED.fetch_add(bytes, Relaxed);
}
unsafe impl GlobalAlloc for Tracked {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let ptr = unsafe { System.alloc(layout) };
        if !ptr.is_null() { add(layout.size()); }
        ptr
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        unsafe { System.dealloc(ptr, layout) };
        LIVE.fetch_sub(layout.size(), Relaxed);
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, size: usize) -> *mut u8 {
        let result = unsafe { System.realloc(ptr, layout, size) };
        if !result.is_null() { LIVE.fetch_sub(layout.size(), Relaxed); add(size); }
        result
    }
}
#[global_allocator]
static ALLOCATOR: Tracked = Tracked;

fn phase<T>(label: &str, run: impl FnOnce() -> T) -> T {
    let start_live = LIVE.load(Relaxed);
    PEAK.store(start_live, Relaxed);
    let allocated = ALLOCATED.load(Relaxed);
    let start = Instant::now();
    let result = run();
    println!("{}", serde_json::json!({"phase":label,"ms":start.elapsed().as_secs_f64()*1000.,
        "start":start_live,"retained":LIVE.load(Relaxed),"peak":PEAK.load(Relaxed),
        "allocated":ALLOCATED.load(Relaxed)-allocated}));
    result
}

fn replay<S: DeviceStore>(mut device: Device<S>, commands: &[String], drain: impl Fn(&Device<S>)) {
    for (i, command) in commands.iter().enumerate() {
        let reply = phase(&format!("call-{i}"), || call_text(&mut device, command));
        assert!(reply.get("denied").is_none(), "{reply}");
        phase(&format!("drain-{i}"), || drain(&device));
    }
    assert!(device.sync_state_read().unwrap().acquired);
}

#[test]
fn heavy_acquisition() {
    if let Ok(path) = std::env::var("HV_CAPTURE") {
        #[derive(serde::Deserialize)]
        struct Capture { backend: Backend, commands: Vec<String> }
        let input = std::fs::read_to_string(path).unwrap();
        let capture: Capture = serde_json::from_str(&input).unwrap();
        drop(input);
        if let Ok(path) = std::env::var("HV_SERVER_STORE") {
            let mut store = snapback4_core::store::Store::open_read_only(std::path::Path::new(&path)).unwrap();
            let first: serde_json::Value = serde_json::from_str(capture.commands.iter().find(|c| c.contains("\"op\":\"apply\"")).unwrap()).unwrap();
            let now = first["page"]["now"].as_i64().unwrap();
            let mut cursor = None;
            let mut rows = 0;
            loop {
                let tx = store.read_transaction().unwrap();
                let page = phase("server-page", || snapback4_core::partition::snapshot_page(&tx,&capture.backend.schema,&std::env::var("HV_PRINCIPAL").expect("HV_PRINCIPAL names the fixture viewer"),cursor,10000,now).unwrap());
                rows += page.events.len(); cursor = page.next;
                if cursor.is_none() { break; }
            }
            assert_eq!(rows,105034);
            return;
        }
        if std::env::var_os("HV_NATIVE_ONLY").is_none() {
        let mut index_stats = std::collections::BTreeMap::<String, (u64,u64,u64,u64)>::new();
        let mut row_bytes = 0;
        let mut row_count = 0;
        for text in &capture.commands {
            let command: serde_json::Value = serde_json::from_str(text).unwrap();
            if command["op"] != "apply" { continue; }
            for event in command["page"]["events"].as_array().unwrap() {
                if event["kind"] != "put" { continue; }
                let name = event["table"].as_str().unwrap();
                let table = &capture.backend.schema.tables[name];
                let before = LIVE.load(Relaxed);
                let row = snapback4_core::wire::row_from_json(table, &event["data"]).unwrap();
                row_bytes += LIVE.load(Relaxed)-before;
                row_count += 1;
                let id = row.field("id").unwrap().as_str().unwrap();
                for (index_name,index) in &table.indexes {
                    let stat = index_stats.entry(format!("{name}.{index_name}")).or_default();
                    for key in snapback4_core::rows::stored_index_keys(table,index,&row,id) {
                        stat.0+=1;stat.1+=key.len() as u64;stat.2+=key.capacity() as u64;stat.3+=id.len() as u64;
                    }
                }
            }
        }
        println!("shape {}",serde_json::json!({"rows":row_count,"row_allocated":row_bytes,"indexes":index_stats}));
        let device = phase("memory-open", || Device::open_store(MemoryStore::new(), Some(capture.backend.clone())).unwrap());
        replay(device, &capture.commands, |device| {
            let bytes = phase("encode-drain-chunks", || {
                let mut bytes = 0;
                loop { let chunk = device.store().drain_chunk(); if chunk == "[]" { break; } bytes += chunk.len(); }
                bytes
            });
            println!("drain-bytes {bytes}");
        });
        }
        #[cfg(feature = "native")]
        {
            let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
            let dir = std::env::temp_dir().join(format!("hv-native-{}-{nonce}", std::process::id()));
            std::fs::create_dir(&dir).unwrap();
            let path = dir.join("store.sqlite");
            let device = phase("sqlite-open", || snapback4_device::native::Device::open(&path, Some(capture.backend)).unwrap());
            replay(device, &capture.commands, |_| {});
            std::fs::remove_dir_all(dir).unwrap();
        }
        return;
    }
    generated_regression();
}

fn generated_regression() {
    use snapback4_core::{Value, value::object};
    let (mut engine, backend) = common::compile(r#"
table rows:
  body: text <=2000
  author: text <=100
  scope: text <=100
  at: time
  ordinal: int
  edited: bool
  tombstone: bool
  extra: text <=100
  by byScope: scope, at, id
  by byAuthor: author, at, id
  search body
  public 'generated allocation regression'
  sync public
query all(c: cursor ?):
  return rows first 100 after c
query search(q: text <=100, c: cursor ?):
  return rows matching q last 20 by .at after c
query scoped(s: text <=100, q: text <=100, c: cursor ?):
  return rows where .scope = s matching q last 20 by .at after c
"#);
    const N: usize = 6000;
    let rows: Vec<_> = (0..N).map(|n| ("rows".into(), object([
        ("id", Value::Id(format!("row:{n:026}"))),
        ("body", Value::String(format!("message history acquisition bounded durable index row{n} {}", "z".repeat(160)))),
        ("author", Value::String(format!("author{:026}", n % 31))),
        ("scope", Value::String(format!("scope{:026}", n % 100))),
        ("at", Value::Int(n as i64)), ("ordinal", Value::Int(n as i64)),
        ("edited", Value::Bool(false)), ("tombstone", Value::Bool(false)),
        ("extra", Value::String("fixture".into())),
    ]))).collect();
    engine.seed(rows).unwrap();
    let pages = common::snapshot_pages(&mut engine, "dev:alice", 500);
    drop(engine);
    let mut device = Device::open_store(MemoryStore::new(), Some(backend.clone())).unwrap();
    device.store().drain();
    let base = LIVE.load(Relaxed);
    PEAK.store(base, Relaxed);
    let start = Instant::now();
    let mut bridge_max = 0;
    for (n, page) in pages.iter().enumerate() {
        device.apply(page, n == 0).unwrap();
        loop {
            let chunk = device.store().drain_chunk();
            bridge_max = bridge_max.max(chunk.len());
            if chunk == "[]" { break; }
        }
        assert_eq!(device.sync_state_read().unwrap().acquired, n + 1 == pages.len());
    }
    let peak = PEAK.load(Relaxed) - base;
    let retained = LIVE.load(Relaxed) - base;
    let apply_ms = start.elapsed().as_secs_f64() * 1000.;
    assert_eq!(device.store().witness_count("rows").unwrap(), N as u64);
    assert!(bridge_max < 512 * 1024, "bounded bridge, measured {bridge_max}");
    // Compare with the old retained representation, generated from the exact
    // same rows and keys. A proportion of allocations is independent of host
    // scheduling and catches the old per-row parse trees and duplicated ids.
    let oracle_start = LIVE.load(Relaxed);
    let mut old_rows = std::collections::BTreeMap::new();
    let mut old_keys = std::collections::BTreeMap::new();
    let table = &backend.schema.tables["rows"];
    for page in &pages { for event in &page.events {
        let Some(data) = &event.data else { continue; };
        let row = snapback4_core::wire::row_from_json(table, data).unwrap();
        let id = row.field("id").unwrap().as_str().unwrap().to_owned();
        for (name, index) in &table.indexes {
            let keys = old_keys.entry(name.clone()).or_insert_with(std::collections::BTreeMap::new);
            for key in snapback4_core::rows::stored_index_keys(table,index,&row,&id) { keys.insert(key,id.clone()); }
        }
        old_rows.insert(("rows".to_owned(), id), row);
    }}
    let old_retained = LIVE.load(Relaxed) - oracle_start;
    println!("generated {}",serde_json::json!({"rows":N,"apply_ms":apply_ms,"peak":peak,"retained":retained,"old_retained":old_retained,"bridge_max":bridge_max}));
    assert!(peak * 10 < old_retained * 9, "peak {peak} must stay below 90% of the old retained representation {old_retained}");
    std::hint::black_box((&old_rows, &old_keys));
    drop(old_rows); drop(old_keys);
    let exported = device.store().export();
    drop(device);
    let mut store = MemoryStore::new(); store.load(exported).unwrap();
    let mut restored = Device::open_store(store, None).unwrap();
    assert!(restored.sync_state_read().unwrap().acquired);
    assert_eq!(restored.store().witness_count("rows").unwrap(), N as u64);
    let (answer, unknown, _) = restored.query_with_coverage("all","dev:alice",&serde_json::json!({"c":null}),1);
    assert!(!unknown && answer.unwrap().complete);
}
